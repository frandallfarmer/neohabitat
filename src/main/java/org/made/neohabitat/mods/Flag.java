package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Massive;

/**
 * Habitat Flag Mod (attached to an Elko Item.)
 * 
 * Flags can get picked up and thrown. But not placed in containers. Responds to HELP messages. 
 * It *may* be portable based on how Massive it is. Otherwise the client is supposed to be smart and
 * transform interface commands to *other* objects as needed.
 * 
 * @author matt
 *
 */
public class Flag extends Massive implements Copyable {
    
    public int HabitatClass() {
        return CLASS_FLAG;
    }
    
    public String HabitatModName() {
        return "Flag";
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "mass" })
    public Flag(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptInteger mass) {
        super(style, x, y, orientation, gr_state, restricted, mass);
    }

    public Flag(int style, int x, int y, int orientation, int gr_state, boolean restricted, int mass) {
        super(style, x, y, orientation, gr_state, restricted, mass);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Flag(style, x, y, orientation, gr_state, restricted, mass);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeMassive(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

}
