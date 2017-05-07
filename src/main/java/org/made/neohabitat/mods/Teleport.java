package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.*;

/**
 * Habitat Teleport Mod (attached to an Elko Item.)
 * 
 * For a few tokens, teleports the avatar to any address in the teleport database.
 * 
 * @author randy
 *
 */
public class Teleport extends Teleporter implements Copyable {
    
    public int HabitatClass() {
        return CLASS_TELEPORT;
    }
    
    public String HabitatModName() {
        return "Teleport";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 1;
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "activeState", "take", "address"})
    public Teleport(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
	    OptInteger gr_state, OptBoolean restricted, OptInteger activeState,  OptInteger take,
		String address) {
        super(style, x, y, orientation, gr_state, restricted, activeState, take, address);
    }

	public Teleport(int style, int x, int y, int orientation, int gr_state, boolean restricted,
		int activeState, int take, String address) {
		super(style, x, y, orientation, gr_state, restricted, activeState, take, address);
	}

	@Override
	public HabitatMod copyThisMod() {
		return new Teleport(style, x, y, orientation, gr_state, restricted, activeState, take, address);
	}

    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeTeleporter(
			new JSONLiteral(HabitatModName(), control), control);
        result.finish();
        return result;
    }
    
    @Override
    @JSONMethod
    public void HELP(User from) {
    	send_reply_msg(from, "TELEPORT: PUT $" + TELEPORT_COST + " here to activate, point at booth and type desired destination address followed by RETURN.");
    	object_say(from, "This is TelePort \"" + address.trim() + "\"");
    }

    @JSONMethod
    public void PAY(User from) {
    	int success = FALSE;
    	if (activeState == PORT_READY) {
    		Avatar	avatar = (Avatar) from.getMod(Avatar.class);
    		success = Tokens.spend(from, TELEPORT_COST, Tokens.CLIENT_DESTROYS_TOKEN);		
    		if (success == TRUE) {
    			addToTake(TELEPORT_COST);
    			activeState			= PORT_ACTIVE;
    			gr_state			= PORT_ACTIVE;
    			gen_flags[MODIFIED]	= true;
    			send_fiddle_msg(THE_REGION, noid, C64_GR_STATE_OFFSET, PORT_ACTIVE);            
        		send_neighbor_msg(from, noid, "PAID$", "payer", avatar.noid, "amount_lo", TELEPORT_COST, "amount_hi", 0);
    		} else {
        		object_say(from,  "You don't have enough money.  Teleportation costs $" +  TELEPORT_COST +  ".");    			
    		}
    	}
    	this.send_reply_msg(from, noid, "err", success, "amount_lo", TELEPORT_COST, "amount_hi", 0);
    }
    
    @JSONMethod({"port_number"})
    public void ZAPTO(User from, String port_number) {
    	Avatar avatar = avatar(from);
    	port_number = squish(port_number);
    	if (port_number.equals("home")) {
    		activate_teleporter(from, avatar.turf, 72, 130);
    		return;
    	}
    	if (port_number.indexOf('-') == -1) {
    		port_number = area_code() + port_number;
    	}
    	activate_teleporter(from, lookupTeleportDestination(port_number));
    }


}
