package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Key Mod (attached to an Elko Item.)
 * 
 * A Key has a code-number that unlocks objects with the matching code. The only
 * way to use it is for the Avatar to be holding (slot:HANDS) and pointing at
 * the object and using the appropriate verb. Any lock/unlock operation will be
 * a side effect on the pointed object. For example, a Bag's OPENCONTAINER
 * operation will test any Key while attempting to open it.
 * 
 * @author randy
 *
 */

public class Key extends HabitatMod implements Copyable {
    
    public int HabitatClass() {
        return CLASS_KEY;
    }
    
    public String HabitatModName() {
        return "Key";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 2;
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
     * Least significant byte in a 16 bit value to match against a lock in order
     * to lock/unlock the item.
     */
    public int key_number_lo = 0;
    /**
     * Most significant byte in a 16 bit value to match against a lock in order
     * to lock/unlock the item.
     */
    public int key_number_hi = 0;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "key_number_lo", "key_number_hi" })
    public Key(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger key_number_lo, OptInteger key_number_hi) {
        super(style, x, y, orientation, gr_state, restricted);
        setKeyState (key_number_lo.value(0), key_number_hi.value(0));

    }

    public Key(int style, int x, int y, int orientation, int gr_state, boolean restricted, int key_number_lo, int key_number_hi) {
        super(style, x, y, orientation, gr_state, restricted);
        setKeyState (key_number_lo, key_number_hi);
    }
    
    protected void setKeyState (int key_number_lo, int key_number_hi) {
        this.key_number_lo = key_number_lo;
        this.key_number_hi = key_number_hi;
    }
    
    @Override
    public HabitatMod copyThisMod() {
        return new Key(style, x, y, orientation, gr_state, restricted, key_number_lo, key_number_hi);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        if (0 != key_number_lo) {
            result.addParameter("key_number_lo", key_number_lo);
        }
        if (0 != key_number_hi) {
            result.addParameter("key_number_hi", key_number_hi);
        }
        result.finish();
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
     * Return a string describing the key number.
     * 
     * @param key
     *            Key mod containing the key number.
     */
    public String key_vendo_info(Key key) {
        return ("Key #" + ( key.key_number_hi * 256 + key.key_number_lo ) + ".");
    }
}
