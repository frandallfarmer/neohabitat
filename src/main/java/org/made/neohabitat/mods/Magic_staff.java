
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
 * Habitat Magic_staff Mod (attached to an Elko Item.)
 * 
 * This is a magic item. 100% configured by state.
 * 
 * @author randy
 *
 */

public class Magic_staff extends Magical implements Copyable {
    
    public int HabitatClass() {
        return CLASS_MAGIC_STAFF;
    }
    
    public String HabitatModName() {
        return "Magic_staff";
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
    
    /**
     * Constructor.
     * 
     * See the @see Magical constructor for documentation on state.
     * 
     */
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "magic_type", "charges", "magic_data", "magic_data2",
            "magic_data3", "magic_data4", "magic_data5" })
    public Magic_staff(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger magic_type, OptInteger charges, 
            OptInteger magic_data, OptInteger magic_data2, OptInteger magic_data3, OptInteger magic_data4, OptInteger magic_data5) {
        super(style, x, y, orientation, gr_state, restricted, magic_type, charges, magic_data, magic_data2, magic_data3,
                magic_data4, magic_data5);
    }

    public Magic_staff(int style, int x, int y, int orientation, int gr_state, boolean restricted, 
    	int magic_type, int charges,
        int magic_data, int magic_data2, int magic_data3, int magic_data4, int magic_data5) {
        super(style, x, y, orientation, gr_state, restricted, magic_type, charges, magic_data, magic_data2, magic_data3,
                magic_data4, magic_data5);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Magic_staff(style, x, y, orientation, gr_state, restricted,
        	magic_type, charges, magic_data, magic_data2, magic_data3, magic_data4, magic_data5);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeMagical(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
    
    /**
     * Verb (Specific): Get HELP for this.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void HELP(User from) {
        super.HELP(from);
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
        generic_PUT(from, containerNoid.value(THE_REGION), x.value(avatar(from).x), y.value(avatar(from).y),
                orientation.value(avatar(from).orientation));
    }
    
    // Missing THROW verb is as originally coded in class_magic_staff.pl1
    
    /**
     * Verb (Magical): Magic activation
     * 
     * @param from
     *            User representing the connection making the request.
     * @param target
     *            The noid of the object being pointed at in case the magic
     *            effects it!
     */
    @JSONMethod({ "target" })
    public void MAGIC(User from, OptInteger target) {
        super.MAGIC(from, target);
    }
}
