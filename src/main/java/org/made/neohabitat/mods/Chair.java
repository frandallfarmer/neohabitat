package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Openable;
import org.made.neohabitat.Seating;

/**
 * Habitat Chair Mod
 *
 * A Chair is a container that can be open/closed but not [un]locked.
 *
 * @author steve
 */
public class Chair extends Seating {

    public int		HabitatClass 	 () { return CLASS_CHAIR; }
    public String	HabitatModName	 () { return "Chair"; }
    public int		capacity 		 () { return 1; }
    public int		pc_state_bytes 	 () { return 0; };
    public boolean	known 			 () { return true; }
    public boolean	opaque_container () { return false; }
    public boolean	filler 			 () { return false; }

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "open_flags"})
    public Chair(OptInteger style, OptInteger x, OptInteger y,
                 OptInteger orientation, OptInteger gr_state,
                 OptInteger open_flags) {
        super(style, x, y, orientation, gr_state, open_flags);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeSeating(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

}
