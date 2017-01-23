package org.made.neohabitat;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;

/**
 * an Elko Habitat superclass to handle on/off states.
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 * Though the switch is attached specifically to items that effect lighting, it
 * is not a requirement.
 */
public abstract class Switch extends HabitatMod {
    
    /**
     * On-off state. Set using the integer constants: TRUE/FALSE *not* the
     * boolean: true/false
     */
    protected int on = FALSE;
    
    public Switch(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger on) {
        super(style, x, y, orientation, gr_state);
        this.on = on.value(FALSE);
    }
    
    /**
     * Change the state of a switch to OFF, and if it's a lighting source,
     * update the Region lighting level.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void generic_OFF(User from) {
        
        if (!elsewhere(this, from) && on == TRUE) {
            send_reply_success(from);
            on = FALSE;
            gen_flags[MODIFIED] = true;
            if (HabitatClass() == CLASS_FLASHLIGHT || HabitatClass() == CLASS_FLOOR_LAMP)
                current_region().lighting = current_region().lighting - 1;
            send_neighbor_msg(from, "OFF$");
            if (HabitatClass() == CLASS_FLASHLIGHT)
                gr_state = FALSE;
            checkpoint_object(this);
        } else {
            send_reply_error(from);
        }
    }
    
    /**
     * Change the state of a switch to ON, and if it's a lighting source, update
     * the Region lighting level.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void generic_ON(User from) {
        
        if (!elsewhere(this, from) && on == FALSE) {
            send_reply_success(from);
            on = TRUE;
            gen_flags[MODIFIED] = true;
            if (HabitatClass() == CLASS_FLASHLIGHT || HabitatClass() == CLASS_FLOOR_LAMP)
                current_region().lighting = current_region().lighting + 1;
            send_neighbor_msg(from, "ON$");
            if (HabitatClass() == CLASS_FLASHLIGHT)
                gr_state = TRUE;
            checkpoint_object(this);
        } else {
            send_reply_error(from);
        }
    }
    
    public JSONLiteral encodeLighting(JSONLiteral result) {
        result = super.encodeCommon(result);
        result.addParameter("on", on);
        return result;
    }
    
}
