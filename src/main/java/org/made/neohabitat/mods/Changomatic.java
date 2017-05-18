package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Container;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Changomatic Mod
 *
 * A device that allows you to customize the pattern/colors on objects in your turf.
 *
 * @author randy
 */
public class Changomatic extends HabitatMod implements Copyable {

	public int HabitatClass() {
		return CLASS_CHANGOMATIC;
	}

	public String HabitatModName() {
		return "Changomatic";
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

	@JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted" })
	public Changomatic(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
			OptInteger gr_state, OptBoolean restricted) {
		super(style, x, y, orientation, gr_state, restricted);
	}

	public Changomatic(int style, int x, int y, int orientation, int gr_state, boolean restricted) {
		super(style, x, y, orientation, gr_state, restricted);
	}

	@Override
	public HabitatMod copyThisMod() {
		return new Changomatic(style, x, y, orientation, gr_state, restricted);
	}

	@Override
	public JSONLiteral encode(EncodeControl control) {
		JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
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

	@JSONMethod({ "targetNoid" })
	public void CHANGE(User from, int targetNoid) {
		Avatar     avatar 	= avatar(from);
		Region     region 	= current_region();
		HabitatMod target	= region.noids[targetNoid];
		int        back 	= (region.orientation + 3) % 4;

		if (((region.resident.equals(avatar.object().baseRef()) || region.obj_id().equals(avatar.turf))  && target.changeable()) ||
				(region.neighbors[back].equals(avatar.turf) && neighbor_changeable(target)) ) {
			int color_bits = target.orientation >> 3;
			color_bits = (color_bits + 1) % 0b11111;
			if (color_bits == 15) color_bits++;
			target.orientation = (color_bits << 3) | (target.orientation & 0b00000111);
			target.gen_flags[MODIFIED] = true;
			target.checkpoint_object(target);
			send_reply_msg(from, noid, "err", TRUE, "CHANGE_NEW_ORIENTATION", target.orientation);
			send_neighbor_msg(from, noid, "CHANGE$", "CHANGE_TARGET", targetNoid, "CHANGE_NEW_ORIENTATION", target.orientation);
		} else {
			object_say(from, "You can't change that here.");
			send_reply_error(from);
		}
	}

	public boolean neighbor_changeable(HabitatMod object) {
		return (object.HabitatClass() == CLASS_BUILDING);
	}


}
