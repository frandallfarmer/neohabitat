package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat House Cat Mod
 *
 * Similar to Bush or Tree, the House Cat mod does not do much, responding to
 * HELP messages and generally being a cat.
 *
 * @author steve
 */
public class House_cat extends HabitatMod implements Copyable {

    public int HabitatClass() {
        return CLASS_HOUSE_CAT;
    }

    public String HabitatModName() {
        return "House_cat";
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
    public House_cat(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    public House_cat(int style, int x, int y, int orientation, int gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new House_cat(style, x, y, orientation, gr_state);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

}
