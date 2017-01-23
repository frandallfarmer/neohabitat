package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Massive;

/**
 * Habitat Rock Mod (attached to an Elko Item.)
 * 
 * Rock don't really do much. Responds to HELP messages. It *may* be portable
 * based on how Massive it is. Otherwise the client is supposed to be smart and
 * transform interface commands to *other* objects as needed.
 * 
 * @author randy
 *
 */
public class Rock extends Massive {
    
    public int HabitatClass() {
        return CLASS_ROCK;
    }
    
    public String HabitatModName() {
        return "Rock";
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "mass" })
    public Rock(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger mass) {
        super(style, x, y, orientation, gr_state, mass);
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeMassive(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
}
