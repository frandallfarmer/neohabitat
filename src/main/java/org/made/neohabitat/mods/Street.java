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
 * Habitat Street Mod (attached to an Elko Item.)
 * 
 * Streets are scenic on the ground and you can walk on then.
 * 
 * @author randy
 *
 */
public class Street extends HabitatMod implements Copyable {
    
    public int HabitatClass() {
        return CLASS_STREET;
    }
    
    public String HabitatModName() {
        return "Street";
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
    
    public boolean filler() {
        return false;
    }
    
    public int width;  
    public int height;
        
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted",  "width", "height" })
    public Street(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger width, OptInteger height) {
        super(style, x, y, orientation, gr_state, restricted);
        setStreetState(width.value(0), height.value(0));

    }

    public Street(int style, int x, int y, int orientation, int gr_state, boolean restricted, int width, int height) {
        super(style, x, y, orientation, gr_state, restricted);
        setStreetState(width, height);
    }
    
    protected void setStreetState(int width, int height) {
        this.width  = width;
        this.height = height;
    }
 
    @Override
    public HabitatMod copyThisMod() {
        return new Street(style, x, y, orientation, gr_state, restricted, width, height);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("width", width);
        result.addParameter("height", height);
        result.finish();
        return result;
    }
    
    @Override
    @JSONMethod
    public void HELP(User from) {
	   current_region().describeRegion(from, noid); 	        
    } 
}
