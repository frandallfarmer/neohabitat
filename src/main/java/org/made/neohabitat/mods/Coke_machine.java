package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Coinop;
import org.made.neohabitat.Massive;

/**
 * Habitat Coke_machine Mod (attached to an Elko Item.)
 * 
 * Coke_machine can get picked up and thrown. Responds to HELP messages. It *may* be portable
 * based on how Massive it is. Otherwise the client is supposed to be smart and
 * transform interface commands to *other* objects as needed.
 * 
 * @author randy
 *
 */
public class Coke_machine extends Coinop {
    
    public int HabitatClass() {
        return CLASS_COKE_MACHINE;
    }
    
    public String HabitatModName() {
        return "Coke_machine";
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "take" })
    public Coke_machine(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger take) {
        super(style, x, y, orientation, gr_state, take);
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCoinop(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
    
    static final int	COKE_COST	= 5;			// Coke costs a nickel.
    
    @JSONMethod
    public void PAY(User from) {
    	Avatar	avatar = (Avatar) from.getMod(Avatar.class);
    	int		success = Tokens.spend(from, COKE_COST);
    	if (success == TRUE) {
    		addToTake(COKE_COST);
    		send_neighbor_msg(from, noid, "PAY$", "amount_lo", COKE_COST, "amount_hi", 0);
    		send_neighbor_msg(from, avatar.noid, "POSTURE$", "new_posture", OPERATE);
    	} else {
    		object_say(from,  "You don't have enough money.  A Choke costs $" +  COKE_COST +  ".");
    	}
    	this.send_reply_msg(from, noid, "err", success, "amount_lo", COKE_COST, "amount_hi", 0);
    }
}
