package org.made.neohabitat;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.server.context.User;
import org.elkoserver.json.JSONLiteral;

/**
 * an Elko Habitat superclass to handle massive state.
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 * There are no default verb methods here, as this field is simply interrogated
 * by other operations.
 */
public abstract class Massive extends HabitatMod {
    
    /** The weight of this object - only ever 1 (immobile) or 0 (portable) */
    protected int mass = 0;
    
    public Massive(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger mass) {
        super(style, x, y, orientation, gr_state);
        this.mass = mass.value(0);
    }
    
    public JSONLiteral encodeMassive(JSONLiteral result) {
        result = super.encodeCommon(result);
        
        result.addParameter("mass", mass);
        return result;
    }
    /**
     * Verb (Generic): Pick this item up.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void GET(User from) {
        generic_GET(from);
    }
    
    /**
     * Verb (Generic): Put this item into some container or on the ground.
     * 
     * @param from
     *            User representing the connection making the request.
     * @param containerNoid
     *            The Habitat Noid for the target container THE_REGION is
     *            default.
     * @param x
     *            If THE_REGION is the new container, the horizontal position.
     *            Otherwise ignored.
     * @param y
     *            If THE_REGION: the vertical position, otherwise the target
     *            container slot (e.g. HANDS/HEAD or other.)
     * @param orientation
     *            The new orientation for the object being PUT.
     */
    @JSONMethod({ "containerNoid", "x", "y", "orientation" })
    public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
        generic_PUT(from, containerNoid.value(THE_REGION), avatar(from).x, avatar(from).y, avatar(from).orientation);
    }
    
    /**
     * Verb (Generic): Throw this across the Region
     * 
     * @param from
     *            User representing the connection making the request.
     * @param x
     *            Destination horizontal position
     * @param y
     *            Destination vertical position (lower 7 bits)
     */
    @JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
        generic_THROW(from, target, x, y);
    }
}
