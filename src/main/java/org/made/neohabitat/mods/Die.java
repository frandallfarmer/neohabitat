package org.made.neohabitat.mods;

import java.util.Random;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Die Mod
 *
 * A six-sided die used for gambling and games.
 * The die is a simple object, like the compass, 
 * whose only real function is to display its own state.
 *
 * @author TheCarlSaganExpress
 */
public class Die extends HabitatMod {
    
    public int HabitatClass() {
        return CLASS_DIE;
    }
    
    public String HabitatModName() {
        return "Die";
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
    
	public int state = 6; //See struct_die.incl.pl1

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "state" })
    public Die(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, int state ) {
        super(style, x, y, orientation, gr_state);
        this.state = state;
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
    
    /*
     * Note for beginners:
     * For a greater understanding of this code please look at
     * class_die.pl1 and die_do.m in the original habitat code
     */
    @JSONMethod
	public void ROLL(User from) {
      gr_state = new Random().nextInt(state) + 1;
	  gen_flags[MODIFIED] = true;
	  send_neighbor_msg(from, THE_REGION, "PLAY_$", "sfx_number", sfx_number(128+0), "from_noid", noid);
	  send_neighbor_msg(from, noid, "ROLL$", "state", gr_state);
	  send_reply_msg(from, noid, "ROLL_STATE", gr_state);
    }

}
