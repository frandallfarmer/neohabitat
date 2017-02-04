package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Openable;

/**
 * Glue is a (usually invisible) locked-open container that holds other objects into arbitrary positions.
 *
 * @author randy
 *
 */

public class Glue extends Openable {
    
    public int HabitatClass() {
        return CLASS_GLUE;
    }
    
    public String HabitatModName() {
        return "Glue";
    }
    
    public int capacity() {
        return 6;
    }
    
    public int pc_state_bytes() {
        return 15;
    };
    
    public boolean known() {
        return true;
    }
    
    public boolean opaque_container() {
        return true;
    }
    
    public boolean filler() {
        return false;
    }

    /** Offsets from the containers origin to display up to six contained objects */
    private int	x_offset_1, y_offset_1, x_offset_2, y_offset_2, x_offset_3, y_offset_3, x_offset_4, y_offset_4, x_offset_5, y_offset_5, x_offset_6, y_offset_6;
    
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "open_flags", "key_lo", "key_hi", "x_offset_1", "y_offset_1", "x_offset_2", "y_offset_2",  "x_offset_3", "y_offset_3",  "x_offset_4", "y_offset_4",  "x_offset_5", "y_offset_5",  "x_offset_6", "y_offset_6"  })
    public Glue(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger open_flags, OptInteger key_lo, OptInteger key_hi,
    	    OptInteger x_offset_1, OptInteger y_offset_1, OptInteger x_offset_2, OptInteger y_offset_2,
    	    OptInteger x_offset_3, OptInteger y_offset_3, OptInteger x_offset_4, OptInteger y_offset_4,
    	    OptInteger x_offset_5, OptInteger y_offset_5, OptInteger x_offset_6, OptInteger y_offset_6) {
        super(style, x, y, orientation, gr_state, open_flags, key_lo, key_hi);
        this.x_offset_1 = x_offset_1.value(0);
        this.y_offset_1 = y_offset_1.value(0);
        this.x_offset_2 = x_offset_2.value(0);
        this.y_offset_2 = y_offset_2.value(0);
        this.x_offset_3 = x_offset_3.value(0);
        this.y_offset_3 = y_offset_3.value(0);        
        this.x_offset_4 = x_offset_4.value(0);
        this.y_offset_4 = y_offset_4.value(0);
        this.x_offset_5 = x_offset_5.value(0);
        this.y_offset_5 = y_offset_5.value(0);
        this.x_offset_6 = x_offset_6.value(0);
        this.y_offset_6 = y_offset_6.value(0);
}
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
        result.addParameter("x_offset_1", x_offset_1);
        result.addParameter("y_offset_1", y_offset_1);
        result.addParameter("x_offset_2", x_offset_2);
        result.addParameter("y_offset_2", y_offset_2);
        result.addParameter("x_offset_3", x_offset_3);
        result.addParameter("y_offset_3", y_offset_3);
        result.addParameter("x_offset_4", x_offset_4);
        result.addParameter("y_offset_4", y_offset_4);
        result.addParameter("x_offset_5", x_offset_5);
        result.addParameter("y_offset_5", y_offset_5);
        result.addParameter("x_offset_6", x_offset_6);
        result.addParameter("y_offset_6", y_offset_6);
        result.finish();
        return result;
    }
    
    /** Disable from Openable: Glue can not be OPEN/CLOSE from the API */
    @Override
    public void OPEN(User from) {
        illegal(from, this.HabitatModName() + ".OPEN");
    }
    
    /** Disable from Openable: Glue can not be OPENCONTAINER/CLOSECONTAINER from the API */
    @Override
    public void OPENCONTAINER(User from) {
        illegal(from, this.HabitatModName() + ".OPENCONTAINER");
    }
    
    /** Disable from Openable: Glue can not be OPEN/CLOSE from the API */
    @Override
    public void CLOSE(User from) {
        illegal(from, this.HabitatModName() + ".CLOSE");
    }
    
    /** Disable from Openable: Glue can not be OPENCONTAINER/CLOSECONTAINER from the API */
    @Override
    public void CLOSECONTAINER(User from) {
        illegal(from, this.HabitatModName() + ".CLOSECONTAINER");
    }
    
}
