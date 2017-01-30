package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Roof Mod
 *
 * This is a roof, meant to be placed atop building-like constructs.
 * Very similar to a Wall inasmuch as it can be styled and responds to HELP messages.
 *
 * @author steve
 */
public class Roof extends HabitatMod {

    public int HabitatClass() {
        return CLASS_ROOF;
    }

    public String HabitatModName() {
        return "Roof";
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

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state" })
    public Roof(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

}
