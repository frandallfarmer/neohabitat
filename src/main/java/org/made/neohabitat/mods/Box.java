package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Openable;

/**
 * Habitat Box Mod (attached to an Elko Item.)
 * 
 * A Box is a large container that can be open/closed and [un]locked.
 * 
 * @author randy
 *
 */

public class Box extends Openable implements Copyable {
    
    public int HabitatClass() {
        return CLASS_BOX;
    }
    
    public String HabitatModName() {
        return "Box";
    }
    
    public int capacity() {
        return 10;
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state","restricted", "open_flags", "key_lo", "key_hi" })
    public Box(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger open_flags, OptInteger key_lo, OptInteger key_hi) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
    }

    public Box(int style, int x, int y, int orientation, int gr_state, boolean restricted, boolean[] open_flags, int key_lo, int key_hi) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Box(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
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
        box_HELP(from);
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
     * Reply with HELP for Boxes
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void box_HELP(User from) {
        lock_HELP(from, "BOX", key_hi * 256 + key_lo, open_flags);
    }
}
