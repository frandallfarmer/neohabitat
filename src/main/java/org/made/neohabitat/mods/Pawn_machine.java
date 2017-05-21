package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Openable;

/**
 * Habitat Pawn_machine
 *
 * Recycles goods for tokens.
 *
 * @author Randy Farmer
 */
public class Pawn_machine extends Openable implements Copyable {

    public int HabitatClass() {
        return CLASS_PAWN_MACHINE;
    }

    public String HabitatModName() {
        return "Pawn_machine";
    }

    public int capacity() {
        return 1;
    }

    public int pc_state_bytes() {
        return 3;
    };

    public boolean known() {
        return true;
    }

    public boolean opaque_container() {
        return true;
    }
    
	public boolean  changeable		 () { return true; }

    public boolean filler() {
        return false;
    }
    
    public static final int[] pawn_values =
    		/*   0 */{    0,   0,   1,   0,   0,   0,  25,  10, 0,  0, /*   9 */
    		/*  10 */     1,  20,   5,  40,   0,   0, 100, 100, 0,  0, /*  19 */
    		/*  20 */ 30000,   0,   0,   0,   0,   5, 800,  20, 0,  0, /*  29 */
    		/*  30 */    11,  47,   0,   1,   0, 400,   0, 600, 0,  0, /*  39 */
    		/*  40 */     0,   0,   1,   1, 200,   0, 100,  30, 0,  1, /*  49 */
    		/*  50 */     0,   0,   5,   0,   0,   0,   0,   0, 1,  0, /*  59 */
    		/*  60 */     1,   1,   0, 800,  50,   0,   0,   0, 0,  0, /*  69 */
    		/*  70 */     0,   0,   0,   0,   0,   1,   0,   0, 0,  0, /*  79 */
    		/*  80 */     0,   0, 150,   0, 400,   0,   0,   0, 0, 75, /*  89 */
    		/*  90 */     0, 900,   0,   0,   0,  25,   0,   0, 0,  0, /*  99 */
    		/* 100 */     0,   0,   0,   0,   0,   0,   0,   0, 0,  0, /* 109 */
    		/* 110 */     0,   0,   0,   0,   0,   0,   0,   0, 0,  0, /* 119 */
    		/* 120 */     0,   0,   0,   0,   0,   0,   0,  10, 0, 400 }; /* 129 */
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "open_flags", "key_hi", "key_lo" })
    public Pawn_machine(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted, 
        OptInteger open_flags, OptInteger key_hi, OptInteger key_lo) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_hi, key_lo);
    }

    public Pawn_machine(int style, int x, int y, int orientation, int gr_state, boolean restricted,
    		boolean[] open_flags, int key_hi, int key_lo) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_hi, key_lo);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Pawn_machine(style, x, y, orientation, gr_state, restricted, open_flags, key_hi, key_lo);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
   
    @JSONMethod
    public void MUNCH(User from) {
    	HabitatMod recycle = contents(0);
    	if (adjacent(this) && recycle != null) {
    		if (TRUE == Tokens.pay_to(avatar(from), pawn_values[recycle.HabitatClass()])) {
    	        send_neighbor_msg(from, noid, "MUNCH$");
    	        destroy_contents();
    	        send_goaway_msg(recycle.noid);
    	        send_reply_success(from);
    	        return;
    		}
    		send_reply_err(from, noid, BOING_FAILURE);
    		return;
    	}
    	this.send_reply_error(from, noid);
    }

}
