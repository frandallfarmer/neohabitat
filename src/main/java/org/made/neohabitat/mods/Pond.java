package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Pond Mod (attached to an Elko Item.)
 * 
 * Ponds just hang around being wet - They only respond to HELP messages. [The client is
 * supposed to be smart and transform interface commands to *other* objects as
 * needed.]
 * 
 * @author matt
 *
 */
public class Pond extends HabitatMod implements Copyable {
    
    public int HabitatClass() {
        return CLASS_POND;
    }
    
    public String HabitatModName() {
        return "Pond";
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted" })
    public Pond(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    public Pond(int style, int x, int y, int orientation, int gr_state, boolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Pond(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
    
}
