package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.HabitatMod;


/**
 * Habitat Stun Gun Mod
 *
 * Stun guns will stun an Avatar, rendering them unable to use weapons
 * for a period of time.
 *
 * @author steve
 */
public class Stun_gun extends HabitatMod {

	public int HabitatClass() {
		return CLASS_STUN_GUN;
	}

	public String HabitatModName() {
		return "Stun_gun";
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

	@JSONMethod({ "style", "x", "y", "orientation", "gr_state" })
	public Stun_gun(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
					 OptInteger gr_state) {
		super(style, x, y, orientation, gr_state);
	}

	@Override
	public JSONLiteral encode(EncodeControl control) {
		JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
		result.finish();
		return result;
	}

	@JSONMethod
	public void HELP(User from) {
		generic_HELP(from);
	}

	@JSONMethod
	public void GET(User from) {
		generic_GET(from);
	}

	@JSONMethod({ "containerNoid", "x", "y", "orientation" })
	public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
		generic_PUT(from, containerNoid.value(THE_REGION), avatar(from).x, avatar(from).y, avatar(from).orientation);
	}

	@JSONMethod({ "target" })
	public void STUN(User from, int target) {
		HabitatMod targetMod = current_region().noids[target];
		Avatar avatar = avatar(from);
		if (holding(avatar, this) && targetMod.HabitatClass() == CLASS_AVATAR) {
			Avatar avatarTarget = (Avatar) targetMod;
			avatarTarget.stun_count = 3;
			send_neighbor_msg(from, avatar.noid, "ATTACK$",
				"ATTACK_TARGET", target,
				"ATTACK_DAMAGE", 0);
			send_reply_success(from);
		}
	}

}
