package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Walkable;

/**
 * Habitat Ground Mod (attached to an Elko Item)
 * 
 * Your Avatar walks on the Ground. Only responds to HELP messages. [The client
 * is supposed to be smart and transform interface commands to *other* objects
 * (usually the Region) as needed.]
 * 
 * @author randy
 *
 */

public class Ground extends Walkable implements Copyable {
    
    public int HabitatClass() {
        return CLASS_GROUND;
    }
    
    public String HabitatModName() {
        return "Ground";
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
    
    public boolean  changeable       () { return true; }
    
    public boolean opaque_container() {
        return false;
    }
    
    public boolean filler() {
        return false;
    }
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "flat_type" })
    public Ground(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger flat_type) {
        super(style, x, y, orientation, gr_state, restricted, flat_type.value(GROUND_FLAT));
    }

    public Ground(int style, int x, int y, int orientation, int gr_state, boolean restricted, int flat_type) {
        super(style, x, y, orientation, gr_state, restricted, flat_type);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Ground(style, x, y, orientation, gr_state, restricted, flat_type);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeWalkable(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
    
    
   @JSONMethod
    public void HELP(User from) {
       current_region().describeRegion(from, noid);             
    }    
}
