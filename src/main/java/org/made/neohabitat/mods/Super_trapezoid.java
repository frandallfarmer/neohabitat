package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Polygonal;

/**
 * Habitat Rock Mod (attached to an Elko Item.)
 * 
 * The Super_trapezoid allows for the explicit of a 32 byte pattern to be placed on Trapezoid (Polygonal).
 * Responds only to HELP messages.
 * 
 * @author randy
 *
 */
public class Super_trapezoid extends Polygonal implements Copyable {
    
    public int HabitatClass() {
        return CLASS_SUPER_TRAPEZOID;
    }
    
    public String HabitatModName() {
        return "Super_trapezoid";
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

    /** The dimensions of the texture block and the EXACTLY 32 byte in the repeating texture for the client to render with */
    private int	pattern_x_size	= 4;
    private int	pattern_y_size	= 8;
    private int	pattern[] 		= { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "trapezoid_type",  "upper_left_x", "upper_right_x", "lower_left_x", "lower_right_x",  "height", "pattern_x_size", "pattern_y_size", "pattern"})    
    public Super_trapezoid(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
        OptInteger trapezoid_type, OptInteger upper_left_x,  OptInteger upper_right_x,
        OptInteger lower_left_x,   OptInteger lower_right_x, OptInteger height,
        OptInteger pattern_x_size, OptInteger pattern_y_size, int[] pattern) {
        super(style, x, y, orientation, gr_state, trapezoid_type, upper_left_x, upper_right_x, lower_left_x, lower_right_x, height);
        this.pattern_x_size = pattern_x_size.value(4);
        this.pattern_y_size = pattern_y_size.value(8);
        this.pattern = pattern;
    }

    public Super_trapezoid(int style, int x, int y, int orientation, int gr_state, int trapezoid_type,
        int upper_left_x, int upper_right_x, int lower_left_x, int lower_right_x, int height, int pattern_x_size,
        int pattern_y_size, int[] pattern) {
        super(style, x, y, orientation, gr_state, trapezoid_type, upper_left_x, upper_right_x, lower_left_x, lower_right_x, height);
        this.pattern_x_size = pattern_x_size;
        this.pattern_y_size = pattern_y_size;
        this.pattern = pattern;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Super_trapezoid(style, x, y, orientation, gr_state, trapezoid_type, upper_left_x, upper_right_x,
            lower_left_x, lower_right_x, height, pattern_x_size, pattern_y_size, pattern);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodePolygonal(new JSONLiteral(HabitatModName(), control));
        result.addParameter("pattern_x_size", pattern_x_size);
        result.addParameter("pattern_y_size", pattern_y_size);
        result.addParameter("pattern", pattern);
        result.finish();
        return result;
    }

}
