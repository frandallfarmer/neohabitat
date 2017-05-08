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
 * Habitat Shovel Mod
 *
 * The Shovel mod allows Avatars to dig Holes if the Shovel is held
 * and the DIG method is called.
 *
 * @author steve
 */
public class Shovel extends HabitatMod implements Copyable {

    public int HabitatClass() {
        return CLASS_SHOVEL;
    }

    public String HabitatModName() {
        return "Shovel";
    }

    public int capacity() {
        return 0;
    }

    public int pc_state_bytes() {
        return 0;
    }

    public boolean known() {
        return true;
    }

    public boolean opaque_container() {
        return false;
    }

    public boolean filler() {
        return false;
    }

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted" })
    public Shovel(OptInteger style, OptInteger x, OptInteger y,
        OptInteger orientation, OptInteger gr_state, OptBoolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    public Shovel(int style, int x, int y, int orientation, int gr_state,
        boolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Shovel(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @JSONMethod
    public void DIG(User from) {
        Avatar avatar = avatar(from);
        if (holding(avatar, this)) {
            send_neighbor_msg(from, avatar.noid, "DIG$");
        }
        send_reply_success(from);
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

}
