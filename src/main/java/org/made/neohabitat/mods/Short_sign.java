package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Short_sign Mod (attached to an Elko Item.)
 * 
 * It's a little sign that displays text.
 * 
 * @author randy
 *
 */
public class Short_sign extends HabitatMod {
    
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
    
    /** The message to display on this short sign */
    public String text;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "text" })
    public Short_sign(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptString text) {
        super(style, x, y, orientation, gr_state);
        this.text = text.value("[Missing!]");
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("text", text);
        result.finish();
        return result;
    }
    
}
