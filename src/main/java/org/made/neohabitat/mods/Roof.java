package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Roof Mod
 *
 * This is a roof, meant to be placed atop building-like constructs.
 * Very similar to a Wall inasmuch as it can be styled and responds to HELP messages.
 *
 * @author steve
 */
public class Roof extends HabitatMod implements Copyable {

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
    
    private	int	base	= 0;
    private int pattern	= 0;
   

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "base", "pattern" })
    public Roof(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
        OptInteger base, OptInteger pattern) {
        super(style, x, y, orientation, gr_state);
        this.base		= base.value(0);
        this.pattern	= pattern.value(0);
    }

    public Roof(int style, int x, int y, int orientation, int gr_state, int base, int pattern) {
        super(style, x, y, orientation, gr_state);
        this.base		= base;
        this.pattern	= pattern;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Roof(style, x, y, orientation, gr_state, base, pattern);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("base", base);
        result.addParameter("pattern", pattern);
        result.finish();
        return result;
    }

}
