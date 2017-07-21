package org.made.neohabitat;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.server.context.User;
import org.elkoserver.util.trace.Trace;
import org.made.neohabitat.mods.Avatar;


/**
 * This is the base class for any ranged or non-ranged handheld weapon,
 * such as the Gun, Knife, or Club.
 *
 * @author steve
 */
public abstract class Weapon extends HabitatMod {

	public Weapon(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
		OptInteger gr_state, OptBoolean restricted) {
		super(style, x, y, orientation, gr_state, restricted);
	}

	public Weapon(int style, int x, int y, int orientation, int gr_state, boolean restricted) {
		super(style, x, y, orientation, gr_state, restricted);
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
		generic_PUT(from, containerNoid.value(THE_REGION), x.value(avatar(from).x), y.value(avatar(from).y),
				orientation.value(avatar(from).orientation));
	}
	
	@JSONMethod({ "pointed_noid" })
	public void ATTACK(User from, OptInteger pointed_noid) {
		generic_ATTACK(from, current_region().noids[pointed_noid.value(0)]);
	}
	
	public void generic_ATTACK(User from, HabitatMod target) {
		if (target == null) {
			send_reply_msg(from, FALSE);
			return;
		}
		int success = TRUE;
		Avatar fromAvatar = avatar(from);
		if (fromAvatar.stun_count > 0) {
			success = FALSE;
			send_private_msg(from, fromAvatar.noid, from, "SPEAK$",
				"I can't attack.  I am stunned.");
		} else if (current_region().nitty_bits[WEAPONS_FREE]) {
			success = FALSE;
			object_say(from,
				"This is a weapons-free zone.  Your weapon will not operate here.");
		} else if (adjacent(target) || is_ranged_weapon()) {
			HabitatMod damageableTarget = target;
			if (target.HabitatClass() == CLASS_HEAD) {
				// If the weapon is attacking an Avatar's head, set the target to the
				// Avatar which contains it.
				damageableTarget = target.container();
				trace_msg("Weapon target is head, container is: %s", damageableTarget.obj_id());
			}
			if (damageableTarget.HabitatClass() == CLASS_AVATAR) {
				Avatar damageableAvatar = (Avatar) damageableTarget;
				damageableAvatar.activity = SIT_GROUND;
				success = damage_avatar(damageableAvatar);
				trace_msg("Avatar %s damaged, health=%d, success=%d", damageableAvatar.obj_id(),
					damageableAvatar.health, success);
				send_neighbor_msg(from, fromAvatar.noid, "ATTACK$",
					"ATTACK_TARGET", damageableTarget.noid,
					"ATTACK_DAMAGE", success);
			} else {
				success = damage_object(damageableTarget);
				if (success == DESTROY) {
					trace_msg("Object %s destroyed by weapon", damageableTarget.obj_id());
				} else {
					trace_msg("Object %s NOT destroyed by weapon", damageableTarget.obj_id());
				}
				send_neighbor_msg(from, fromAvatar.noid, "BASH$",
					"BASH_TARGET", damageableTarget.noid,
					"BASH_SUCCESS", success);
			}
		} else {
			success = FALSE;
		}

		send_reply_msg(from, noid,
			"ATTACK_target", target.noid,
			"ATTACK_result", success);

		if (success == DEATH) {
			trace_msg("Killing Avatar %s...", target.obj_id());
			kill_avatar((Avatar) target);
			Avatar.inc_record(from, HS$kills);
		}
	}
}
