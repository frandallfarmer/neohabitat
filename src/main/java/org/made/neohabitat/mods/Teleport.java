package org.made.neohabitat.mods;

import java.util.Map;

import javax.print.attribute.standard.Destination;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Coinop;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Massive;

/**
 * Habitat Teleport Mod (attached to an Elko Item.)
 * 
 * For a few tokens, teleports the avatar to any address in the teleport database.
 * 
 * @author randy
 *
 */
public class Teleport extends Coinop implements Copyable {
    
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
    
    static final int TELEPORT_COST		= 10;
    static final int PORT_READY			= 0;
    static final int PORT_ACTIVE		= 1;
    
    /** The (de)active state of the teleport [server + client]  was 'state' in struct_teleport */
    private int 	activeState = PORT_READY;
    
    /** The teleport address of this teleport [server only] */
    private String	address		= "";
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "activeState", "take", "address"})
    public Teleport(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
		OptInteger activeState,  OptInteger take, String address) {
        super(style, x, y, orientation, gr_state, restricted, take);
        setTeleportState(activeState.value(PORT_READY), address);
    }

	public Teleport(int style, int x, int y, int orientation, int gr_state, boolean restricted, int activeState, int take, String address) {
		super(style, x, y, orientation, gr_state, restricted, take);
		setTeleportState(activeState, address);
	}
	
	protected void setTeleportState(int activeState, String address) {
		this.activeState = activeState;
		this.address = address;
	}

	@Override
	public HabitatMod copyThisMod() {
		return new Teleport(style, x, y, orientation, gr_state, restricted, activeState, take, address);
	}

    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCoinop(new JSONLiteral(HabitatModName(), control));
        result.addParameter("activeState", activeState);
        if (control.toRepository()) {
        	result.addParameter("address", address);
        }
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
    
    @JSONMethod ({"port_number"})
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

    private void activate_teleporter(User from, String destination, int x, int y) {
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
    			// Moved arrival positioning logic to avatar.objectIsComplete
    			send_reply_success(from);
                avatar.inc_record(HS$teleports);
    			goto_new_region(avatar, destination, EAST, TELEPORT_ENTRY, x, y);
    			send_neighbor_msg(from, noid, "ZAPTO$");
    			if (HabitatClass() == CLASS_TELEPORT) {
    				activeState			= PORT_READY;
    				gr_state			= PORT_READY;
    				gen_flags[MODIFIED]	= true;
    				send_neighbor_fiddle_msg(from, THE_REGION, noid, C64_GR_STATE_OFFSET, PORT_READY);            
    			}
    			return;
    		}
    	}
    	send_reply_error(from);
    }
    
    private void activate_teleporter(User from, String destination) {
    	activate_teleporter(from, destination, 0, 0);
    }
    
    public String lookupTeleportDestination(String key) {
    	@SuppressWarnings("unchecked")
    	Map<String, String> directory = (Map<String, String>) context().getStaticObject("teleports");
    	return (String) directory.get(squish(key));
    }

   
    private String squish(String value) {
    	return value.toLowerCase().replaceAll("\\s","");
    }
    
    private String area_code(String value) {
    	value = squish(value);
    	int mark = value.indexOf('-');
    	if (mark == -1) {
    		return "pop-";
    	}
    	return value.substring(0, mark + 1);
    }
    
    private String area_code() {
    	return area_code(address);
    }


}
