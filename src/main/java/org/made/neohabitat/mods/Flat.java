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
 * Habitat Flat Mod
 *
 * Flat is a very simple mod, representing a flat object, typically
 * used as part of the scenery in certain regions.
 *
 * @author steve
 */
public class Flat extends Walkable implements Copyable {

    public int HabitatClass() {
        return CLASS_FLAT;
    }

    public String HabitatModName() {
        return "Flat";
    }

    public int capacity() {
        return 0;
    }

    public int pc_state_bytes() {
        return 1;
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

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "flat_type" })
    public Flat(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptInteger flat_type) {
        super(style, x, y, orientation, gr_state, restricted, flat_type.value(0));
    }

    public Flat(int style, int x, int y, int orientation, int gr_state, boolean restricted, int flat_type) {
        super(style, x, y, orientation, gr_state, restricted, flat_type);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Flat(style, x, y, orientation, gr_state, restricted, flat_type);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeWalkable(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
    
    @Override
    @JSONMethod
    public void HELP(User from) {
       if (flat_type == GROUND_FLAT) {
    	   current_region().describeRegion(from, noid);
       } else {
    	   generic_HELP(from);
       }
    } 
}
