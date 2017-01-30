package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Openable;

/**
 * Habitat Chest Mod
 *
 * A Box is a very large container that can be open/closed and [un]locked.
 *
 * @author steve
 */
public class Chest extends Openable {

    public int HabitatClass() {
        return CLASS_CHEST;
    }

    public String HabitatModName() {
        return "Chest";
    }

    public int capacity() {
        return 20;
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
    public Chest(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
               OptInteger open_flags, OptInteger key_lo, OptInteger key_hi) {
        super(style, x, y, orientation, gr_state, open_flags, key_lo, key_hi);
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
        chest_HELP(from);
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
     * Reply with HELP for Chests
     *
     * @param from User representing the connection making the request.
     */
    public void chest_HELP(User from) {
        lock_HELP(from, "CHEST", key_hi * 256 + key_lo, open_flags);
    }

}
