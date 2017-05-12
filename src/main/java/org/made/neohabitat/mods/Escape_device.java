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
 * Habitat Escape Device Mod
 *
 * The Escape Device mod, when activated upon an Avatar, will teleport
 * that avatar back to their turf, up to the number of available
 * charges.
 *
 * @author steve
 */
public class Escape_device extends HabitatMod implements Copyable {

    public int HabitatClass() {
        return CLASS_ESCAPE_DEV;
    }

    public String HabitatModName() {
        return "Escape_device";
    }

    public int capacity() {
        return 0;
    }

    public int pc_state_bytes() {
        return 1;
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

    private int charge = 3;

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "charge" })
    public Escape_device(OptInteger style, OptInteger x, OptInteger y,
        OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptInteger charge) {
        super(style, x, y, orientation, gr_state, restricted);
        this.charge = charge.value(5);
    }

    public Escape_device(int style, int x, int y, int orientation, int gr_state,
        boolean restricted, int charge) {
        super(style, x, y, orientation, gr_state, restricted);
        this.charge = charge;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Escape_device(style, x, y, orientation, gr_state, restricted, charge);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("charge", charge);
        result.finish();
        return result;
    }

    @JSONMethod
    public void BUGOUT(User from) {
    	Avatar avatar = avatar(from);
    	if (holding(avatar, this) && charge > 0) {
    		if (avatar.turf.equals(current_region().object().ref())) {
    			object_say(from, noid, "You're already home.");
    			send_reply_error(from);
    		} else if (!Region.IsRoomForMyAvatarIn(avatar.turf, from)) {
    			object_say(from, "My turf is full.");
    			send_reply_error(from); 
    		} else {
    			avatar.inc_record(HS$escapes);
    			avatar.markAsChanged();
    			send_reply_success(from);
    			send_neighbor_msg(from, avatar.noid, "BUGOUT$");
    			charge--;
    			avatar.x = SAFE_X;
    			avatar.y = SAFE_Y;
    			avatar.activity = STAND;
    			gen_flags[MODIFIED] = true;
    			checkpoint_object(this);
    			avatar.change_regions(avatar.turf, 0, 1);
    		}
    	} else {
    		object_say(from, noid, "Its charge is all used up.");
    		send_reply_error(from);
    	}
    }

    @JSONMethod
    public void HELP(User from) {
        if (charge > 0) {
            send_reply_msg(from,
                String.format("Choose DO to activate.  Available charge: %d units.", charge));
        } else {
            send_reply_msg(from, "This device has run out of charge.");
        }
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

}
