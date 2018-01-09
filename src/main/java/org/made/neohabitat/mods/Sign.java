package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Poster;

/**
 * Habitat Sign Mod (attached to an Elko Item.)
 * 
 * It's a sign that displays text.
 * 
 * @author randy
 *
 */
public class Sign extends Poster implements Copyable {
    
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
    
    public boolean  changeable       () { return true; }

    public boolean filler() {
        return false;
    }
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "text", "ascii"})
    public Sign(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptString text, int[] ascii) {
        super(style, x, y, orientation, gr_state, restricted, text, ascii, 40);
    }

    public Sign(int style, int x, int y, int orientation, int gr_state, boolean restricted, int[] ascii) {
        super(style, x, y, orientation, gr_state, restricted, ascii);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Sign(style, x, y, orientation, gr_state, restricted, ascii);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodePoster(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
}