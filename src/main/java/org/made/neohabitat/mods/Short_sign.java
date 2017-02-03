package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Poster;

/**
 * Habitat Short_sign Mod (attached to an Elko Item.)
 * 
 * It's a little sign that displays text.
 * 
 * @author randy
 *
 */
public class Short_sign extends Poster {
    
    public int HabitatClass() {
        return CLASS_SHORT_SIGN;
    }
    
    public String HabitatModName() {
        return "Short_sign";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 10;
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
    public Short_sign(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptString text, int[] ascii) {
        super(style, x, y, orientation, gr_state, text, ascii, 10);
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodePoster(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
}