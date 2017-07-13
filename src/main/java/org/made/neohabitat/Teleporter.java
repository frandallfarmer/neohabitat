package org.made.neohabitat;

import java.util.Map;

import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;

import org.made.neohabitat.mods.Avatar;
import org.made.neohabitat.mods.Region;


/**
 * Encapsulates logic common to classes which perform Avatar teleportation,
 * e.g. Teleport and Elevator.
 */
public abstract class Teleporter extends Coinop {

	public boolean changeable() { return true; }

    public static final int TELEPORT_COST = 10;
    public static final int PORT_READY    = 0;
    public static final int PORT_ACTIVE   = 1;

    /** The (de)active state of the teleport [server + client]  was 'state' in struct_teleport */
    protected int activeState = PORT_READY;

    /** The teleport address of this teleport [server only] */
    protected String address = "";

    public Teleporter(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
        OptInteger gr_state, OptBoolean restricted, OptInteger activeState, OptInteger take, String address) {
        super(style, x, y, orientation, gr_state, restricted, take);
        setTeleportState(activeState.value(PORT_READY), address);
    }

    public Teleporter(int style, int x, int y, int orientation, int gr_state,
        boolean restricted, int activeState, int take, String address) {
        super(style, x, y, orientation, gr_state, restricted, take);
        setTeleportState(activeState, address);
    }

    public JSONLiteral encodeTeleporter(JSONLiteral result, EncodeControl control) {
        super.encodeCoinop(result);
        result.addParameter("activeState", activeState);
        if (control.toRepository()) {
            result.addParameter("address", address);
        }
        return result;
    }

    protected void setTeleportState(int activeState, String address) {
        this.activeState = activeState;
        this.address = address;
    }

    protected void activate_teleporter(User from, String destination, int x, int y) {
        if (destination == null) {
            object_say(from,
                (HabitatClass() == CLASS_TELEPORT) ?
                    "There is no such place.  Please check the area code and address and try again." :
                    "There is no such floor.  Please check the number and try again.");
        } else if (destination.equals(context().ref())) {
            object_say(from, "Malfunction! You may not teleport to the same location.");
        } else {
            Avatar avatar = avatar(from);
            if (adjacent(avatar) &&
            		(activeState == PORT_ACTIVE || HabitatClass() == CLASS_ELEVATOR)) {
            	if (Region.IsRoomForMyAvatarIn(destination, from)) {
            		send_reply_success(from);
            		avatar.inc_record(HS$teleports);
                	// Moved arrival positioning logic to avatar.objectIsComplete
            		goto_new_region(avatar, destination, EAST, TELEPORT_ENTRY, x, y);
            		send_neighbor_msg(from, noid, "ZAPTO$");
            		if (HabitatClass() == CLASS_TELEPORT) {
            			activeState			= PORT_READY;
            			gr_state			= PORT_READY;
            			gen_flags[MODIFIED]	= true;
            			send_neighbor_fiddle_msg(from, THE_REGION, noid, C64_GR_STATE_OFFSET, PORT_READY);
            		}
            	} else {
            		object_say(from, "Flash crowd detected at that destination. Try a different location.");
                    send_reply_error(from);
            	}
            	return;
            }
        }
        send_reply_error(from);
    }

    protected void activate_teleporter(User from, String destination) {
        activate_teleporter(from, destination, 0, 0);
    }

    public String lookupTeleportDestination(String key) {
        @SuppressWarnings("unchecked")
        Map<String, String> directory = (Map<String, String>) context().getStaticObject("teleports");
        return (String) directory.get(squish(key));
    }

    protected String squish(String value) {
        return value.toLowerCase().replaceAll("\\s","");
    }

    protected String area_code(String value) {
        value = squish(value);
        int mark = value.indexOf('-');
        if (mark == -1) {
            return "pop-";
        }
        return value.substring(0, mark + 1);
    }

    protected String area_code() {
        return area_code(address);
    }

}
