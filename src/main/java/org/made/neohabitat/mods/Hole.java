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
 * Habitat Hole Mod
 *
 * A Hole is an opaque container that can only be opened and closed
 * by an accompanying Shovel mod.
 *
 * @author steve
 */
public class Hole extends Openable implements Copyable {

    public int HabitatClass() {
        return CLASS_HOLE;
    }

    public String HabitatModName() {
        return "Hole";
    }

    public int capacity() {
        return 10;
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

    public boolean filler() {
        return false;
    }

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "open_flags", "key_lo", "key_hi" })
    public Hole(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
        OptInteger gr_state, OptBoolean restricted, OptInteger open_flags, OptInteger key_lo,
        OptInteger key_hi) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
    }

    public Hole(int style, int x, int y, int orientation, int gr_state, boolean restricted,
        boolean[] open_flags, int key_lo, int key_hi) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Hole(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @Override
    @JSONMethod
    public void OPENCONTAINER(User from) {
        Avatar avatar = avatar(from);
        if (avatar.holding_class(CLASS_SHOVEL)) {
            super.OPENCONTAINER(from);
        } else {
            send_reply_error(from);
        }
    }

    @Override
    @JSONMethod
    public void CLOSECONTAINER(User from) {
        Avatar avatar = avatar(from);
        if (avatar.holding_class(CLASS_SHOVEL)) {
            super.CLOSECONTAINER(from);
        } else {
            send_reply_error(from);
        }
    }

}
