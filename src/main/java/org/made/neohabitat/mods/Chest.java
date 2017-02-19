package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Openable;

/**
 * Habitat Chest Mod
 *
 * A Chest is a very large container that can be open/closed and [un]locked,
 * but is not portable, like the Box.
 *
 * @author steve
 */
public class Chest extends Openable implements Copyable {

    public int HabitatClass() {
        return CLASS_CHEST;
    }

    public String HabitatModName() {
        return "Chest";
    }

    public int capacity() {
        return 20;
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

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "open_flags", "key_lo", "key_hi" })
    public Chest(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
                 OptInteger open_flags, OptInteger key_lo, OptInteger key_hi) {
        super(style, x, y, orientation, gr_state, open_flags, key_lo, key_hi);
    }

    public Chest(int style, int x, int y, int orientation, int gr_state, boolean[] open_flags, int key_lo, int key_hi) {
        super(style, x, y, orientation, gr_state, open_flags, key_lo, key_hi);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Chest(style, x, y, orientation, gr_state, open_flags, key_lo, key_hi);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    /**
     * Verb (Specific): Get HELP for this.
     *
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void HELP(User from) {
        chest_HELP(from);
    }

    /**
     * Reply with HELP for Chests
     *
     * @param from User representing the connection making the request.
     */
    public void chest_HELP(User from) {
        lock_HELP(from, "CHEST", key_hi * 256 + key_lo, open_flags);
    }

}
