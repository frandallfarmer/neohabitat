package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Ghost Mod (attached to an Elko Item.)
 * 
 * There is always a Ghost object in the region and it represents all
 * of the users that are in "observer only" mode - watching what
 * is happening in a region, but not appearing as an avatar.
 * 
 * This is, and always was, a colossal hack that I've always
 * been proud of: dozens of people are able to watch a performance
 * by others. Also see http://www.crockford.com/ec/anecdotes.html
 * for stories about Habitat ghosts.
 * 
 * @author randy
 *
 */
public class Ghost extends HabitatMod implements Copyable {
    
    public int HabitatClass() {
        return CLASS_GHOST;
    }
    
    public String HabitatModName() {
        return "Ghost";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 0;
    };
    
    public boolean known() {
        return true;
    }
    
    public boolean opaque_container() {
        return false;
    }
    
    public boolean filler() {
        return false;
    }
    
    /** Count of the number of connections represented by this ghost */
    public int total_ghosts = 0;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted" })
    public Ghost(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
        total_ghosts = 0;		// TODO Ideally, there should never be a ghost in the db, but just in case, make sure it has NO ghost users attached.
    }

    public Ghost(int style, int x, int y, int orientation, int gr_state, boolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Ghost(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        if (control.toRepository()) {
        	trace_msg("Why is ghost being persisted?");
        }
        return result;
    }
    
    /**
     * One ghost object represents multiple client connections - so many constants are 
     * involved in the multiplex rigging...     * 
     */
    public void objectIsComplete() {
    	Region region = current_region();
    	noid = GHOST_NOID;
        region.noids[noid] = this;
		note_object_creation(this);
    }
    
    @JSONMethod
    public void HELP(User from) {
    	send_reply_msg(from, (total_ghosts == 1) ? "There is 1 ghost here." : "There are " + total_ghosts + " ghosts here." );
    }
        
    /**
     * Verb (Specific): TODO Turn to/from being a ghost.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void CORPORATE(User from) {
    	Avatar avatar = avatar(from); 	// The user always has an Avatar-connection on the server side, it's just forgotten on the client side.
    	if (avatar.amAGhost) {
    		send_private_msg(from, THE_REGION, from, "PLAY_$", "sfx_number", 8, "from_noid", THE_REGION);
    		avatar.switch_to_avatar(from);
    		avatar.nitty_bits[INTENTIONAL_GHOST] = false;
    	} else {
    		trace_msg("Attempt to switch from ghost to avatar for a non-ghosted avatar.");
    		send_reply_error(from);
    	}
    }
    
    
	/**
	 * Verb (Specific): TODO Leave the region for another region.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod({ "direction", "passage_id" })
	public void NEWREGION(User from, OptInteger direction, OptInteger passage_id) {
		ghost_NEWREGION(from, direction.value(1), passage_id.value(0));
	}
	
	public void ghost_NEWREGION(User from, int direction, int passage_id ) {		
		Avatar		avatar			= avatar(from);
		Region      region          = current_region();
		String      new_region      = "";
		int			entry_type		= WALK_ENTRY;
		HabitatMod  passage         = region.noids[passage_id];
		int         direction_index = (direction + region.orientation + 2) % 4;
		

		if (direction != AUTO_TELEPORT_DIR && 
				passage_id != 0 &&
				passage.HabitatClass() == CLASS_DOOR || 
				passage.HabitatClass() == CLASS_BUILDING) {
			
			if (passage.HabitatClass() == CLASS_DOOR) {
				Door door = (Door) passage;
				if (!door.getOpenFlag(OPEN_BIT) || door.gen_flags[DOOR_AVATAR_RESTRICTED_BIT]) {
					send_reply_error(from);
					return;
				} else {
					new_region = door.connection;
				}
			} else {
				new_region = ((Building) passage).connection;
			}
		} else {
			if (direction >= 0 && direction < 4) {
				new_region = region.neighbors[direction_index]; // East,  West, North, South
			} else {     // direction == AUTO_TELEPORT_DIR 
				send_reply_error(from);
				new_region = avatar.to_region;
				entry_type = TELEPORT_ENTRY;
				direction  = WEST; // TODO Randy needs to revisit this little hack to prevent a loop..
			}
		}
		
		if (!new_region.isEmpty()) {
			send_reply_success(from);
			avatar.change_regions(new_region, direction, entry_type);
			return;
		}       
		object_say(from, "There is nowhere to go in that direction.");
		send_reply_error(from);     
	}    
}
