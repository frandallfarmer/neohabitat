package org.made.neohabitat;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.JSONLiteral;

/**
 * an Elko Habitat superclass to handle avatar walkable surfaces.
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 *
 */
public abstract class Walkable extends HabitatMod {
    
    /**
     * flat_type == GROUND_FLAT (2) means this is a valid target for a THROW
     * verb.
     */
    protected int flat_type = 0;
    
    public Walkable(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            int flat_type) {
        super(style, x, y, orientation, gr_state);
        this.flat_type = flat_type;
    }

    public Walkable(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger flat_type) {
        this(style, x, y, orientation, gr_state, flat_type.value(0));
    }

    public Walkable(int style, int x, int y, int orientation, int gr_state, int flat_type) {
        super(style, x, y, orientation, gr_state);
        this.flat_type = flat_type;
    }

    public JSONLiteral encodeWalkable(JSONLiteral result) {
        result = super.encodeCommon(result);
        if (0 != flat_type) {
            result.addParameter("flat_type", flat_type);
        }
        return result;
    }
    
}
