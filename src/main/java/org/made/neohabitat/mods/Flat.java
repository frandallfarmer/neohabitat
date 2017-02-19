package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;


/**
 * Habitat Flat Mod
 *
 * Flat is a very simple mod, representing a flat object, typically
 * used as part of the scenery in certain regions.
 *
 * @author steve
 */
public class Flat extends HabitatMod implements Copyable {

    public int HabitatClass() {
        return CLASS_FLAT;
    }

    public String HabitatModName() {
        return "Flat";
    }

    public int capacity() {
        return 0;
    }

    public int pc_state_bytes() {
        return 1;
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

    protected int flat_type = 0;

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "flat_type" })
    public Flat(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
        OptInteger flat_type) {
        super(style, x, y, orientation, gr_state);
        this.flat_type = flat_type.value(0);
    }

    public Flat(int style, int x, int y, int orientation, int gr_state, int flat_type) {
        super(style, x, y, orientation, gr_state);
        this.flat_type = flat_type;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Flat(style, x, y, orientation, gr_state, flat_type);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("flat_type", this.flat_type);
        result.finish();
        return result;
    }

}
