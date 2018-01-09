package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Openable;
import org.made.neohabitat.Seating;

/**
 * Habitat Couch Mod
 *
 * A Couch is a container that can be open/closed but not [un]locked.
 *
 * @author steve
 */
public class Couch extends Seating implements Copyable {

    public int      HabitatClass     () { return CLASS_COUCH; }
    public String   HabitatModName   () { return "Couch"; }
    public int      capacity         () { return 2; }
    public int      pc_state_bytes   () { return 0; };
    public boolean  known            () { return true; }
    public boolean  opaque_container () { return false; }
    public boolean  changeable       () { return true; }
    public boolean  filler           () { return false; }

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "open_flags", "restricted"})
    public Couch(OptInteger style, OptInteger x, OptInteger y,  OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptInteger open_flags) {
        super(style, x, y, orientation, gr_state, restricted, open_flags);
    }

    public Couch(int style, int x, int y, int orientation, int gr_state, boolean restricted, boolean[] open_flags) {
        super(style, x, y, orientation, gr_state, restricted, open_flags);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Couch(style, x, y, orientation, gr_state, restricted, open_flags);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeSeating(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

}
