package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.BasicObject;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
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
public class Tokens extends HabitatMod implements Copyable {
    
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
    public int denom_lo = 0;
    public int denom_hi = 0;
    
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
    	gen_flags[MODIFIED] = true;
    	checkpoint_object(this);
    }
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "denom_lo", "denom_hi" })
    public Tokens(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, int denom_lo, int denom_hi) {
        super(style, x, y, orientation, gr_state);
        setTokensState(denom_lo, denom_hi);

    }
    
    public Tokens(int style, int x, int y, int orientation, int gr_state, int denom_lo, int denom_hi) {
        super(style, x, y, orientation, gr_state);
        setTokensState(denom_lo, denom_hi);
    }
    
    protected void setTokensState(int denom_lo, int denom_hi) {
        this.denom_lo = denom_lo;
        this.denom_hi = denom_hi;
    }
 
    @Override
    public HabitatMod copyThisMod() {
        return new Tokens(style, x, y, orientation, gr_state, denom_lo, denom_hi);
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
    	int			amount		= amount_lo + amount_hi * 256;
    	int			old_amount	= tget();
    	HabitatMod	target  	= current_region().noids[target_id];
    	if (target.HabitatClass() == CLASS_AVATAR) {
    		Avatar payer	= avatar(from);
    		Avatar other	= (Avatar) target;
    		if (this.empty_handed(other)) {
    			if (spend(amount) == TRUE) {
    				Tokens tokens = new Tokens(0, 0, HANDS, 0, 0, amount_lo, amount_hi);
    				Item item = create_object("money", tokens, other);
    				if (item == null) {
    					send_reply_err(from, noid, BOING_FAILURE);
    					return;
    				}
    				JSONLiteral itemLiteral = item.encode(EncodeControl.forClient);
    				// Tell the neighbors about the new tokens and how to deduct the giver
    				JSONLiteral msg = new_neighbor_msg(other.noid, "PAID$");
    				msg.addParameter("payer", 		payer.noid);
    		        msg.addParameter("amount_lo",	amount_lo);
    		        msg.addParameter("amount_hi",	amount_hi);
    		        msg.addParameter("container",   other.object().ref());
    		        msg.addParameter("object",		itemLiteral);
    		        msg.finish();
                    trace_msg("Sending new Tokens context to neighbors, context=%s, from=%s, msg=%s",
                        context(), from, msg);
    		        context().sendToNeighbors(from, msg);
    		        // Reply including the new tokens
    		        msg = new_reply_msg(noid);
    		        msg.addParameter("success",		TRUE);
    		        msg.addParameter("amount_lo",	amount_lo);
    		        msg.addParameter("amount_hi",	amount_hi);
    		        msg.addParameter("container",   other.object().ref());
    		        msg.addParameter("object",		itemLiteral);
    		        msg.finish();
    		        from.send(msg);
    				if (old_amount == amount) {
    					send_neighbor_msg(from, THE_REGION, "GOAWAY_$", "target", noid);
    					destroy_object(this);
    				}
    				return;
    			}
    		}
    	}
    	send_reply_error(from);
    } 

    @JSONMethod ({"amount_lo", "amount_hi"})
    public void SPLIT(User from, int amount_lo, int amount_hi) {
        Avatar avatar = avatar(from);

        // If the amount specified is greater than the total tokens, or if them
        // amount of tokens
        int amount = amount_lo + amount_hi*256;
        if (amount >= tget() || amount == 0) {
            send_reply_error(from);
            return;
        }

        // Looks for any Tokens the Avatar is holding.
        int pos_y = -1;
        int token_at = -1;
        for (int i=0;i < avatar.capacity() - 3; i++) {
            HabitatMod avatarMod = avatar.contents(i);
            if (avatarMod == null) {
                if (pos_y == -1) {
                    pos_y = i;
                }
            } else {
                if (avatarMod.HabitatClass() == CLASS_TOKENS) {
                    token_at = i;
                }
            }
        }

        // Handles the split logic, depending upon whether the Avatar is holding
        // Tokens or not.
        int big_denom;
        if (token_at != -1) {
            pos_y = token_at;
            Tokens avatarTokens = (Tokens) avatar.contents(pos_y);
            big_denom = avatarTokens.tget() + tget() - amount;
            if (big_denom > 65536) {
                send_reply_error(from);
                return;
            }
            avatarTokens.tset(big_denom);
            send_fiddle_msg(THE_REGION, avatarTokens.noid, C64_TOKEN_DENOM_OFFSET,
                new int[]{ avatarTokens.denom_lo, avatarTokens.denom_hi });
        } else {
            big_denom = tget() - amount;
            if (big_denom > 65536 || pos_y == -1) {
                send_reply_error(from);
                return;
            }
            Tokens tokens = new Tokens(0, 0, pos_y, 0, 0, big_denom % 256, big_denom / 256);
            Item item = create_object("money", tokens, avatar);
            if (item == null) {
                send_reply_error(from);
                return;
            }
            announce_object(item, avatar);
        }

        tset(amount);
        send_fiddle_msg(THE_REGION, noid, C64_TOKEN_DENOM_OFFSET,
            new int[]{ denom_lo, denom_hi });
        send_reply_success(from);
    }

    /** 
     * Spend some of this objects tokens.
     * 
     * @param amount The number of tokens to spend.
     * @return
     */
    public int spend(int amount) {
		int tvalue = tget();
		if (tvalue >= amount) {
			tvalue -= amount;
			tset(tvalue);
			if (tvalue == 0) {
				destroy_object(this);
			}
			return TRUE;
		}
		return FALSE;
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
    		return tokens.spend(amount);
    	}
    	return FALSE;    	
    }
}
