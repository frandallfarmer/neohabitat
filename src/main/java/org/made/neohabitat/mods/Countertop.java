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
 * Habitat Countertop Mod
 *
 * A Countertop is a medium-size container that can be open/closed.
 *
 * @author steve
 */
public class Countertop extends Openable implements Copyable {

    public int HabitatClass() {
        return CLASS_COUNTERTOP;
    }

    public String HabitatModName() {
        return "Countertop";
    }

    public int capacity() {
        return 5;
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

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "open_flags" })
    public Countertop(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
                 OptInteger open_flags) {
        super(style, x, y, orientation, gr_state, open_flags);
    }

    public Countertop(int style, int x, int y, int orientation, int gr_state, boolean[] open_flags) {
        super(style, x, y, orientation, gr_state, open_flags);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Countertop(style, x, y, orientation, gr_state, open_flags);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

}
