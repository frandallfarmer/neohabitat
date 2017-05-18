package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Polygonal;

/**
 * Habitat Rock Mod (attached to an Elko Item.)
 * 
 * Trapezoid is the simplest non-rectangular Polygonal for drawing backgrounds.
 * Responds only to HELP messages.
 * 
 * @author randy
 *
 */
public class Trapezoid extends Polygonal implements Copyable {
    
    public int HabitatClass() {
        return CLASS_TRAPEZOID;
    }
    
    public String HabitatModName() {
        return "Trapezoid";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 6;
    };
    
    public boolean known() {
        return true;
    }
    
    public boolean opaque_container() {
        return false;
    }
    
	public boolean  changeable		 () { return true; }

    public boolean filler() {
        return false;
    }
    
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "trapezoid_type",  "upper_left_x", "upper_right_x", "lower_left_x", "lower_right_x",  "height"})
    public Trapezoid(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptInteger trapezoid_type, OptInteger upper_left_x,  OptInteger upper_right_x,
        OptInteger lower_left_x,   OptInteger lower_right_x, OptInteger height) {
        super(style, x, y, orientation, gr_state, restricted, trapezoid_type, upper_left_x, upper_right_x, lower_left_x, lower_right_x, height);
    }

    public Trapezoid(int style, int x, int y, int orientation, int gr_state, boolean restricted, 
    		int trapezoid_type, int upper_left_x, int upper_right_x, int lower_left_x, int lower_right_x, int height) {
        super(style, x, y, orientation, gr_state, restricted, trapezoid_type, upper_left_x, upper_right_x, lower_left_x, lower_right_x, height);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Trapezoid(style, x, y, orientation, gr_state, restricted, trapezoid_type, upper_left_x, upper_right_x, lower_left_x, lower_right_x, height);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodePolygonal(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

}
