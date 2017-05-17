
package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Magical;

/**
 * Habitat Gemstone Mod (attached to an Elko Item.)
 * 
 * The Gemstone is a potentially magical portable object
 * 
 * @author randy
 *
 */

public class Gemstone extends Magical implements Copyable {
    
    public int HabitatClass() {
        return CLASS_GEMSTONE;
    }
    
    public String HabitatModName() {
        return "Gemstone";
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
    
    /**
     * Constructor.
     * 
     * See the @see Magical constructor for documentation on state.
     * 
     * Gemstones have no additional state beyond being potentially magical.
     * 
     */
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "magic_type", "charges", "magic_data", "magic_data2",
            "magic_data3", "magic_data4", "magic_data5" })
    public Gemstone(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger magic_type, OptInteger charges, 
            OptInteger magic_data, OptInteger magic_data2, OptInteger magic_data3, OptInteger magic_data4, OptInteger magic_data5) {
        super(style, x, y, orientation, gr_state, restricted, magic_type, charges, magic_data, magic_data2, magic_data3,
                magic_data4, magic_data5);
    }

    public Gemstone(int style, int x, int y, int orientation, int gr_state, boolean restricted, 
    	int magic_type, int charges,
        int magic_data, int magic_data2, int magic_data3, int magic_data4, int magic_data5) {
        super(style, x, y, orientation, gr_state, restricted, magic_type, charges, magic_data, magic_data2, magic_data3,
                magic_data4, magic_data5);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Gemstone(style, x, y, orientation, gr_state, restricted,
        	magic_type, charges, magic_data, magic_data2, magic_data3, magic_data4, magic_data5);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeMagical(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @JSONMethod
    public void HELP(User from) {
        super.HELP(from);
    }

    @JSONMethod
    public void GET(User from) {
        generic_GET(from);
    }

    @JSONMethod({ "containerNoid", "x", "y", "orientation" })
    public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
        generic_PUT(from, containerNoid.value(THE_REGION), x.value(avatar(from).x), y.value(avatar(from).y),
                orientation.value(avatar(from).orientation));
    }

    @JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
        generic_THROW(from, target, x, y);
    }

    @JSONMethod({ "target" })
    public void MAGIC(User from, OptInteger target) {
        super.MAGIC(from, target);
    }
  }
