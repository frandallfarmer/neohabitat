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
    private int	xo1, yo1, xo2, yo2, xo3, yo3, xo4, yo4, xo5, yo5, xo6, yo6;
    
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "open_flags", "key_lo", "key_hi", "xo1", "yo1", "xo2", "yo2",  "xo3", "yo3",  "xo4", "yo4",  "xo5", "yo5",  "xo6", "yo6"  })
    public Glue(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger open_flags, OptInteger key_lo, OptInteger key_hi,
    	    OptInteger xo1, OptInteger yo1, OptInteger xo2, OptInteger yo2,
    	    OptInteger xo3, OptInteger yo3, OptInteger xo4, OptInteger yo4,
    	    OptInteger xo5, OptInteger yo5, OptInteger xo6, OptInteger yo6) {
        super(style, x, y, orientation, gr_state, open_flags, key_lo, key_hi);
        this.xo1 = xo1.value(0);
        this.yo1 = yo1.value(0);
        this.xo2 = xo2.value(0);
        this.yo2 = yo2.value(0);
        this.xo3 = xo3.value(0);
        this.yo3 = yo3.value(0);        
        this.xo4 = xo4.value(0);
        this.yo4 = yo4.value(0);
        this.xo5 = xo5.value(0);
        this.yo5 = yo5.value(0);
        this.xo6 = xo6.value(0);
        this.yo6 = yo6.value(0);
}
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
        result.addParameter("xo1", xo1);
        result.addParameter("yo1", yo1);
        result.addParameter("xo2", xo2);
        result.addParameter("yo2", yo2);
        result.addParameter("xo3", xo3);
        result.addParameter("yo3", yo3);
        result.addParameter("xo4", xo4);
        result.addParameter("yo4", yo4);
        result.addParameter("xo5", xo5);
        result.addParameter("yo5", yo5);
        result.addParameter("xo6", xo6);
        result.addParameter("yo6", yo6);
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
