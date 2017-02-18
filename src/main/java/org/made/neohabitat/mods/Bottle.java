package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Bottle Mod
 *
 * A Bottle is a carryable object that may be filled with water, if
 * nearby a water source, and poured out.
 *
 * @author steve
 */
public class Bottle extends HabitatMod {

    public int HabitatClass() {
        return CLASS_BOTTLE;
    }

    public String HabitatModName() {
        return "Bottle";
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

    public int filled = FALSE;

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "filled" })
    public Bottle(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
        OptInteger gr_state, OptInteger filled) {
        super(style, x, y, orientation, gr_state);
        this.filled = filled.value(FALSE);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("filled", filled);
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
        generic_PUT(from, containerNoid.value(THE_REGION), avatar(from).x, avatar(from).y, avatar(from).orientation);
    }

    @JSONMethod
    public void FILL(User from) {
        bottle_FILL(from);
    }

    @JSONMethod
    public void POUR(User from) {
        bottle_POUR(from);
    }

    public void bottle_FILL(User from) {
        Avatar avatar = avatar(from);
        boolean success = holding(avatar, this) && filled == FALSE;
        if (success) {
            filled = TRUE;
            gr_state = TRUE;
            gen_flags[MODIFIED] = true;
            send_neighbor_msg(from, noid, "FILL$",
                "AVATAR_NOID", avatar.noid);
        }
        if (success) {
            send_reply_success(from);
        } else {
            send_reply_error(from);
        }
    }

    public void bottle_POUR(User from) {
        Avatar avatar = avatar(from);
        boolean success = holding(avatar, this) && filled == TRUE;
        if (success) {
            filled = FALSE;
            gr_state = FALSE;
            gen_flags[MODIFIED] = true;
            send_neighbor_msg(from, noid, "POUR$",
                "AVATAR_NOID", avatar.noid);
        }
        if (success) {
            send_reply_success(from);
        } else {
            send_reply_error(from);
        }
    }

}
