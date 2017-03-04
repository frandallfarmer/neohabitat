package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Die Mod
 *
 * The fake gun works like the real gun, except when you shoot
 * with it a flag that says "BANG!" comes out instead of actually
 * shooting somebody.
 *
 * @author TheCarlSaganExpress
 */
public class Fake_gun extends HabitatMod implements Copyable
{
	
	public int HabitatClass() {
		return CLASS_FAKE_GUN;
	}

	public String HabitatModName() {
		return "Fake_gun";
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
	
	public int state = 0; //See struct_fake_gun.incl.pl1
	public static final int FAKE_GUN_READY = 0; //Same as %replace FAKE_GUN_READY by 0;
	public static final int FAKE_GUN_FIRED = 1; //Same as %replace FAKE_GUN_FIRED by 1;
	public boolean success = false;
	
	@JSONMethod({ "style", "x", "y", "orientation", "gr_state", "state" })
	public Fake_gun(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, int state) {
		super(style, x, y, orientation, gr_state);
	    this.state = state;
	}
	
	public Fake_gun(int style, int x, int y, int orientation, int gr_state, int state) {
        super(style, x, y, orientation, gr_state);
        this.state = state;
	}
	
	@Override
	public HabitatMod copyThisMod() {
		return new Fake_gun(style, x, y, orientation, gr_state, state);
	}
	
	@Override
	public JSONLiteral encode(EncodeControl control) {
		JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
	    	result.addParameter("state", state);
	    	result.finish();
		return result;
	}
	
    @JSONMethod
    public void HELP(User from) {
    	generic_HELP(from);
    }
	

    @JSONMethod
    public void GET(User from) {
       	generic_GET(from);
    }


    @JSONMethod({ "containerNoid", "x", "y", "orientation" })
    public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
    	generic_PUT(from, containerNoid.value(THE_REGION), avatar(from).x, avatar(from).y, avatar(from).orientation);
   	}
    

    @JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
        generic_THROW(from, target, x, y);
    }
    
    @JSONMethod
    public void FAKESHOOT(User from) {
    	Avatar curAvatar = avatar(from);
    	if (holding(curAvatar, this) && (state == FAKE_GUN_READY)){
    		state = FAKE_GUN_FIRED;
    		gr_state = FAKE_GUN_FIRED;
    		gen_flags[MODIFIED] = true;
    		send_neighbor_msg(from, noid, "FAKESHOOT$", "state", state); //n_msg_0(selfptr, FAKESHOOT$);
    		success = true;
    	}
    	else
    		success = false;
    	send_reply_msg(from, noid, "FAKESHOOT_SUCCESS", (success) ? TRUE : FALSE); //r_msg_1(success); 
   	}
    
    @JSONMethod
    public void RESET(User from) {
    	Avatar curAvatar = avatar(from);
    	if (holding(curAvatar, this) && (state == FAKE_GUN_FIRED)){
    		state = FAKE_GUN_READY;
    		gr_state = FAKE_GUN_READY;
    		gen_flags[MODIFIED] = true;
    		send_neighbor_msg(from, noid, "RESET$", "state", state); //n_msg_0(selfptr, RESET$);
    		success = true;
    	}
    	else
    		success = false;
    	send_reply_msg(from, noid, "RESET_SUCCESS", (success) ? TRUE : FALSE); //call r_msg_1(success);
    }
}
