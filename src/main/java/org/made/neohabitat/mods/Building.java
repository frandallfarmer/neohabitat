package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Building Mod (attached to an Elko Item.)
 * 
 * Buildings provide portals to other regions.
 * It has no other feature than to hold a connection reference.
 * 
 * @author randy
 *
 */
public class Building extends HabitatMod {
    
    public int HabitatClass() {
        return CLASS_BUILDING;
    }
    
    public String HabitatModName() {
        return "Building";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 0;
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
    
    /** The region (context-ref) that this door leads to */
    public String connection;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state",  "connection" })
    public Building(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            String connection) {
        super(style, x, y, orientation, gr_state);
        this.connection = connection;
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        if (control.toRepository()) {
            result.addParameter("connection", connection);
        }
        result.finish();
        return result;
    }    
}
