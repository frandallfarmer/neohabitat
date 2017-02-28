package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;

import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Sex Changer Mod
 *
 * The Sex Changer mod allows an Avatar to change their sex in-game.
 * There is no cost for this change.
 *
 * @author steve
 */
public class Sex_changer extends HabitatMod implements Copyable {

    public int HabitatClass() {
        return CLASS_SEX_CHANGER;
    }

    public String HabitatModName() {
        return "Sex_changer";
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
    public Sex_changer(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    public Sex_changer(int style, int x, int y, int orientation, int gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Sex_changer(style, x, y, orientation, gr_state);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @JSONMethod
    public void SEXCHANGE(User from) {
        sex_changer_SEXCHANGE(from, avatar(from));
    }

    public void sex_changer_SEXCHANGE(User from, Avatar sexChangingAvatar) {
        if (adjacent(sexChangingAvatar)) {
            trace_msg("Avatar %s is adjacent to sex changer: %s", sexChangingAvatar.object().ref(), object().ref());
            if (test_bit(sexChangingAvatar.orientation, 8)) {
                trace_msg("Bit 8 is set on sex changing Avatar %s; clearing it", sexChangingAvatar.object().ref());
                sexChangingAvatar.orientation = clear_bit(sexChangingAvatar.orientation, 8);
            } else {
                trace_msg("Bit 8 is cleared on sex changing Avatar %s; setting it", sexChangingAvatar.object().ref());
                sexChangingAvatar.orientation = set_bit(sexChangingAvatar.orientation, 8);
            }
        }
        trace_msg("New sex-changed Avatar orientation: %d", sexChangingAvatar.orientation);
        sexChangingAvatar.gen_flags[MODIFIED] = true;
        sexChangingAvatar.checkpoint_object(sexChangingAvatar);
        send_neighbor_msg(from, noid, "SEXCHANGE$",
            "AVATAR_NOID", sexChangingAvatar.noid);
        send_reply_success(from);
    }

}
