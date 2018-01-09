package org.made.neohabitat;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.server.context.User;
import org.made.neohabitat.mods.Avatar;
import org.elkoserver.json.JSONLiteral;

/**
 * an Elko Habitat superclass for Oracular objects - you can talk to them!
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 */
public abstract class Oracular extends HabitatMod {

    /** The weight of this object - only ever 1 (immobile) or 0 (portable) */
    protected int live = 0;

    public Oracular(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger live) {
        super(style, x, y, orientation, gr_state, restricted);
        this.live = live.value(0);
    }

    public Oracular(int style, int x, int y, int orientation, int gr_state, boolean restricted, int live) {
        super(style, x, y, orientation, gr_state, restricted);
        this.live = live;
    }

    public JSONLiteral encodeOracular(JSONLiteral result) {
        result = super.encodeCommon(result);
        if (result.control().toRepository()) {
            result.addParameter("live", live);
        }
        return result;
    }

}
