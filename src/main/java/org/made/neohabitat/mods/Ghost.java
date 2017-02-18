package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Ghost Mod
 *
 * A Ghost is an avatar that has successfully called DISINCORPORATE.
 *
 * @author steve
 */
public class Ghost extends HabitatMod {

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

    private String     from_region		= "";
    private String     to_region		= "";

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state" })
    public Ghost(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        if (result.control().toRepository()) {
            result.addParameter("from_region", from_region);
            result.addParameter("to_region", to_region);
        }
        result.finish();
        return result;
    }

    @JSONMethod
    public void HELP(User from) {
        ghost_HELP(from);
    }

    public void ghost_HELP(User from) {
        int ghosts = current_region().ghost_count();
        if (ghosts == 1) {
            send_reply_msg(from, "There is 1 ghost here.");
        } else {
            send_reply_msg(from, String.format("There are %d ghosts here.", ghosts));
        }
    }

    /**
     * Verb (Specific): TODO Walk across the region.
     *
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod({ "x", "y", "how" })
    public void WALK(User from, OptInteger x, OptInteger y, OptInteger how) {
        ghost_WALK(from, x.value(0), y.value(0));
    }

    public void ghost_WALK(User from, int x, int y) {
        send_reply_msg(from, noid,
            "x", x,
            "y", y);
    }

    /**
     * Verb (Specific): TODO Leave the region for another region.
     *
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod({ "direction", "passage_id" })
    public void NEWREGION(User from, OptInteger direction, OptInteger passage_id) {
        ghost_NEWREGION(from, direction.value(0), passage_id.value(0));
    }

    public void ghost_NEWREGION(User from, int direction, int passage_id) {
        Region      region          = current_region();
        String      new_region      = "";
        int			entry_type		= WALK_ENTRY;
        HabitatMod  passage         = region.noids[passage_id];
        int         direction_index = (direction + region.orientation + 2) % 4;

        if (direction != AUTO_TELEPORT_DIR && passage_id != 0 &&
            passage.HabitatClass() == CLASS_DOOR ||
            passage.HabitatClass() == CLASS_BUILDING) {
            if (passage.HabitatClass() == CLASS_DOOR) {
                Door door = (Door) passage;
                if (!door.getOpenFlag(OPEN_BIT) ||
                        door.gen_flags[DOOR_AVATAR_RESTRICTED_BIT]) {
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
                new_region = to_region;
                entry_type = TELEPORT_ENTRY;
                direction  = WEST; // TODO Randy needs to revisit this little hack to prevent a loop..
            }
        }

        if (!new_region.isEmpty()) {
            send_reply_success(from);
            change_regions(new_region, direction, entry_type);
            return;
        }
        ghost_say(from, THE_REGION, "There is nowhere to go in that direction.");
        send_reply_error(from);
    }

    public void change_regions(String contextRef, int direction, int type) {
        Region	region		= current_region();
        User	who			= (User) this.object();

        trace_msg("Ghost %s changing regions to context=%s, direction=%d, type=%d", obj_id(),
            contextRef, direction, type);

        // TODO change_regions exceptions! see region.pl1

        to_region			= contextRef;
        from_region         = region.obj_id();     // Save exit information in avatar for use on arrival.
        gen_flags[MODIFIED] = true;
        checkpoint_object(this);

        if (direction == AUTO_TELEPORT_DIR) {
            send_private_msg(who, THE_REGION, who, "AUTO_TELEPORT_$", "direction", direction);
        } else {
            JSONLiteral msg = new JSONLiteral("changeContext", EncodeControl.forClient);
            msg.addParameter("context", contextRef);
            msg.finish();
            who.send(msg);
        }
    }

}
