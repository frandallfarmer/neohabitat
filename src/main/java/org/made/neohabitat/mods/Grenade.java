package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Weapon;

/**
 * Habitat Grenade Mod 
 * 
 * A little bomb that goes boom.
 * 
 * @author TheCarlSaganExpress
 * 
 */

public class Grenade extends Weapon implements Copyable {

	@Override
	public int HabitatClass() {
		return CLASS_GRENADE;
	}

	@Override
	public String HabitatModName() {
		return "Grenade";
	}

	@Override
	public int capacity() {
		return 0;
	}

	@Override
	public int pc_state_bytes() {
		return 1;
	}

	@Override
	public boolean known() {
		return true;
	}

	@Override
	public boolean opaque_container() {
		return false;
	}

	@Override
	public boolean filler() {
		return false;
	}
	
	public int success;
	public int pinpulled = FALSE;
	HabitatMod grenadeObj;
	Avatar curAvatar;
	
	@JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "pinpulled" })
    public Grenade(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted, 
    		OptInteger pinpulled) {
        super(style, x, y, orientation, gr_state, restricted);
        this.pinpulled = pinpulled.value(0);
	}
	
	public Grenade(int style, int x, int y, int orientation, int gr_state, boolean restricted, int pinpulled) {
        super(style, x, y, orientation, gr_state, restricted);
        this.pinpulled = pinpulled;
    }
	
	@Override
	public HabitatMod copyThisMod() {
        return new Grenade(style, x, y, orientation, gr_state, restricted, pinpulled);
	}

	@Override
	public JSONLiteral encode(EncodeControl control) {
	    JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
	    result.addParameter("pinpulled", pinpulled);
	    result.finish();
        return result;
	}
	
	@JSONMethod
	public void HELP(User from) {
		grenade_HELP(from);
	}


	@JSONMethod
	public void GET(User from) {
		generic_GET(from);
	}


	@JSONMethod({ "containerNoid", "x", "y", "orientation" })
	public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
		generic_PUT(from, containerNoid.value(THE_REGION), x.value(avatar(from).x), y.value(avatar(from).y),
				orientation.value(avatar(from).orientation));
	}
	
	@JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
		generic_THROW(from, target, x, y);
        
    }
	
	@JSONMethod
    public void PULLPIN(User from) {
		curAvatar = avatar(from);
		grenadeObj = curAvatar.contents(HANDS);
		checkpoint_object(grenadeObj);
        if(current_region().nitty_bits[WEAPONS_FREE]){
        	success = FALSE;
        	object_say(from, noid, "This is a weapons-free zone. Your grenade will not operate here.");
        }
        else if(holding(curAvatar, this) && pinpulled == FALSE){
        	pinpulled = TRUE;
        	gen_flags[MODIFIED] = true;
        	success = TRUE;
        	object_broadcast(noid, "Sproing!!!");
        	curAvatar.checkpoint_object(this); 
        	checkpoint_object(this); 
			new Thread(Grenade_Timer).start(); 
        }
        else
        	success = FALSE;
    	send_reply_msg(from, noid, "PULLPIN_SUCCESS", success);
    }

	protected Runnable Grenade_Timer = new Runnable() {
	    	@Override
	    	public void run() {
	    		try {
	    			Thread.sleep(GRENADE_FUSE_DELAY * 1000);
	    			int result;
	    			send_broadcast_msg(noid, "EXPLODE_$", "pinpulled", pinpulled);
	    				for(int i = 1; i <= 255; i++){
	    					HabitatMod obj = current_region().noids[i];
	    					if(obj != null && obj.HabitatClass() == CLASS_AVATAR){
	    						Avatar damageableAvatar = (Avatar) obj;
	    						checkpoint_object(damageableAvatar);
	    						result = damage_avatar(damageableAvatar, 180);
	    						trace_msg("Avatar %s damaged, health=%d, success=%d", damageableAvatar.obj_id(),damageableAvatar.health, result);
	    						if(result > 0){
	    							send_broadcast_msg(damageableAvatar.noid, "POSTURE$", "new_posture",   GET_SHOT_POSTURE);
	    						}
	    						if(result == DEATH){
	    							trace_msg("Killing Avatar %s...", damageableAvatar.obj_id());
	    							kill_avatar(damageableAvatar);
	    						}
								send_reply_msg(curAvatar.elko_user(), noid, "PULLPIN_SUCCESS", success);
	    					}
	    				}
	    				curAvatar.checkpoint_object(grenadeObj);
	    				if(curAvatar.holding_class(CLASS_GRENADE)){
							destroy_object(heldObject(curAvatar));
				    	}
				    	else
				    		((Item) grenadeObj.object()).delete(); 
	    		} 
				catch (Exception e) {
	    			trace_msg("Grenade thread interrupted.");
	    		}
	    	}
	};

	public void grenade_HELP(User from) {
		if(pinpulled != TRUE){
			send_reply_msg(from, "Grenade: Select DO (while holding) to pull pin, then throw to ground and leave the region quickly.");
		}
		else
			send_reply_msg(from, "Grenade: Pin pulled! Run away now!!!");
	}
}
