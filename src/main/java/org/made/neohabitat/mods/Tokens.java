package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Tokens Mod (attached to an Elko Item.)
 * 
 * Tokens are the basic currency of Habitat. They are objects with arbitrary denominations.
 * They can be created (atm/money tree), split, merged (in containers), and spent.
 * 
 * @author Randy
 *
 */
public class Tokens extends HabitatMod {
    
    public int HabitatClass() {
        return CLASS_TOKENS;
    }
    
    public String HabitatModName() {
        return "Tokens";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 2;
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
    

    /** denom_hi * 256 + denom_lo is the value of this token., 0 value tokens will self-destruct */
    private	int	denom_lo	= 0;
    private int denom_hi	= 0;
    
    /**
     * Get the value of the token.
     * 
     * @param token
     * @return
     */
    public int tget() {
    	return denom_hi * 256 + denom_lo;
    }
    
    public void tset(int amount) {
    	denom_lo = amount % 256;
    	denom_hi = (amount - denom_lo) / 256 ;
    }
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "denom_lo", "denom_hi" })
    public Tokens(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, int denom_lo, int denom_hi) {
        super(style, x, y, orientation, gr_state);
        this.denom_lo = denom_lo;
        this.denom_hi = denom_hi;
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("denom_lo", denom_lo);
        result.addParameter("denom_hi", denom_hi);
        result.finish();
        return result;
    }
    
    @JSONMethod
    public void HELP(User from) {
    	this.send_reply_msg(from, "$" + tget() + " token.  Choose DO to make change (remainder will be put back in your pocket)." );
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
    
    @JSONMethod ({"target_id", "amount_lo", "amount_hi" })
    public void PAYTO(User from, int target_id, int amount_lo, int amount_hi) {
		object_say(from,  "Unimplemented functionality. Join us to get this finished!");
    	this.send_reply_error(from);
    } 
    
    @JSONMethod ({"amount_lo", "amount_hi"})
    public void SPLIT(User from, int amount_lo, int amount_hi) {
		object_say(from,  "Unimplemented functionality. Join us to get this finished!");
    	this.send_reply_error(from);
    }
    
    /** 
     * Spend some of a user's hard-earned tokens - assuming he's holding them and has enough.
     * Call as as Static method: Tokens.spend()
     * 
     * @param from The user spending the tokens (and waiting for an answer)
     * @param amount The number of tokens to spend.
     * @return
     */
    public static int spend(User from, int amount) {
    	Avatar avatar = (Avatar) from.getMod(Avatar.class);
    	HabitatMod held = avatar.heldObject();
    	if (held.HabitatClass() == CLASS_TOKENS) {
    		Tokens tokens= (Tokens) held;
    		int tvalue = tokens.tget();
    		if (tvalue >= amount) {
    			tvalue -= amount;
    			tokens.tset(tvalue);
    			if (tvalue == 0) {
    				tokens.destroy_object(tokens);
    			}
    			return TRUE;
    		}
    	}
    	return FALSE;    	
    }
}
