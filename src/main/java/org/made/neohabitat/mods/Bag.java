package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Openable;

/**
 * Habitat Bag Mod (attached to an Elko Item.)
 * 
 * A Bag is a small container that can be open/closed and [un]locked.
 * 
 * @author randy
 *
 */

public class Bag extends Openable implements Copyable {
    
    public int HabitatClass() {
        return CLASS_BAG;
    }
    
    public String HabitatModName() {
        return "Bag";
    }
    
    public int capacity() {
        return 5;
    }
    
    public int pc_state_bytes() {
        return 3;
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "open_flags", "key_lo", "key_hi" })
    public Bag(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger open_flags, OptInteger key_lo, OptInteger key_hi) {
        super(style, x, y, orientation, gr_state, open_flags, key_lo, key_hi);
    }

    public Bag(int style, int x, int y, int orientation, int gr_state, boolean[] open_flags, int key_lo, int key_hi) {
        super(style, x, y, orientation, gr_state, open_flags, key_lo, key_hi);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Bag(style, x, y, orientation, gr_state, open_flags, key_lo, key_hi);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
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
        bag_HELP(from);
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
    
    /**
     * Reply with HELP for Bags
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void bag_HELP(User from) {
        lock_HELP(from, "BAG", key_hi * 256 + key_lo, open_flags);
    }
}
