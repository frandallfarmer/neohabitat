package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Poster;

/**
 * Habitat Sign Mod (attached to an Elko Item.)
 * 
 * It's a sign that displays text.
 * 
 * @author randy
 *
 */
public class Sign extends Poster {
    
    public int HabitatClass() {
        return CLASS_SIGN;
    }
    
    public String HabitatModName() {
        return "Sign";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 40;
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "text", "ascii"})
    public Sign(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptString text, int[] ascii) {
        super(style, x, y, orientation, gr_state, text, ascii, 40);
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodePoster(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
}