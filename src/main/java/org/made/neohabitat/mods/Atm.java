package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Atm mod
 *
 * An Atm allows for the deposit/withdrawal of tokens into/from an Avatar's
 * bank account.
 *
 * @author steve
 */
public class Atm extends HabitatMod implements Copyable {

    public int HabitatClass() {
        return CLASS_ATM;
    }

    public String HabitatModName() {
        return "Atm";
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

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state" })
    public Atm(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    public Atm(int style, int x, int y, int orientation, int gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Atm(style, x, y, orientation, gr_state);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @JSONMethod({ "token_noid" })
    public void DEPOSIT(User from, int token_noid) {
        atm_DEPOSIT(from, current_region().noids[token_noid]);
    }

    @JSONMethod({ "amount_lo", "amount_hi" })
    public void WITHDRAW(User from, int amount_lo, int amount_hi) {
        int withdrawal = amount_lo + amount_hi*256;
        atm_WITHDRAW(from, withdrawal);
    }

    public void atm_DEPOSIT(User from, HabitatMod mod) {
        Avatar avatar = avatar(from);
        trace_msg("Avatar %s attempting to deposit mod: %s", from.ref(), mod);
        int success;
        if (holding(avatar, mod) && mod.HabitatClass() == CLASS_TOKENS) {
            Tokens tokens = (Tokens) mod;
            avatar.bankBalance += tokens.tget();
            avatar.gen_flags[MODIFIED] = true;
            avatar.checkpoint_object(avatar);
            send_neighbor_goaway_msg(from, tokens.noid);
            destroy_object(tokens);
            send_neighbor_msg(from, avatar.noid, "POSTURE$",
                "new_posture", OPERATE);
            success = TRUE;
        } else {
            object_say(from, "You aren't holding any money.");
            success = FALSE;
        }
        if (success == TRUE) {
            trace_msg("Avatar %s successfully deposited mod: %s", from.ref(), mod);
            send_reply_success(from);
        } else {
            trace_msg("Avatar %s unsuccessfully deposited mod: %s", from.ref(), mod);
            send_reply_error(from);
        }
    }

    public void atm_WITHDRAW(User from, int withdrawal) {
        Avatar avatar = avatar(from);
        int actual_withdrawal;
        int result_code = TRUE;
        if (avatar.bankBalance >= withdrawal) {
            actual_withdrawal = withdrawal;
        } else {
            actual_withdrawal = avatar.bankBalance;
        }
        if (actual_withdrawal <= 0) {
            result_code = FALSE;
        } else if (pay_to(avatar, actual_withdrawal) == FALSE) {
            trace_msg("FAILED to pay_to Avatar %s", avatar.obj_id());
            actual_withdrawal = 0;
            result_code = BOING_FAILURE;
        }
        send_neighbor_msg(from, avatar.noid, "POSTURE$",
            "new_posture", OPERATE);
        avatar.bankBalance -= actual_withdrawal;
        if (actual_withdrawal != 0) {
            // TODO(steve): When HoR is implemented, add code to update Avatar wealth.
        }
        send_reply_msg(from, noid,
            "amount_lo", actual_withdrawal % 256,
            "amount_hi", actual_withdrawal / 256,
            "result_code", result_code);
    }

}
