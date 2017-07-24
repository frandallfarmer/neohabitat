package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Bridge Mod 
 * 
 * Your basic small foot or highway bridge
 * 
 * @author TheCarlSaganExpress
 *
 */
public class Bridge extends HabitatMod implements Copyable {
    
    public int HabitatClass() {
        return CLASS_BRIDGE;
    }
    
    public String HabitatModName() {
        return "Bridge";
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
    
    public boolean changeable() { 
        return true;
    }

    public boolean filler() {
        return false;
    }
    
    public int width;  
    public int length;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "width", "length" })
    public Bridge(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
             OptInteger width, OptInteger length) {
        super(style, x, y, orientation, gr_state, restricted);
        this.width = width.value(0);
        this.length = length.value(0);
    }

    public Bridge(int style, int x, int y, int orientation, int gr_state, boolean restricted, int width, int length) {
        super(style, x, y, orientation, gr_state, restricted);
        this.width = width;
        this.length = width;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Bridge(style, x, y, orientation, gr_state, restricted, width, length);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("width", width);
        result.addParameter("length", length);
        result.finish();
        return result;
    }
    
}
