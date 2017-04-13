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

	/* The total amount of damage to be rendered by an ATTACK. */
	public static final int DAMAGE_DECREMENT = 20;

	/* The activity ID of sitting on the ground */
	public static final int SIT_GROUND = 132;
	/* no effect, beep at player */
	public static final int MISS = 0;
	/* destroy object that is target */
	public static final int DESTROY = 1;
	/* keester avatar that is target */
	public static final int HIT = 2;
	/* kill avatar that is target */
	public static final int DEATH = 3;
	
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

	public int damage_avatar(Avatar who) {
		trace_msg("Damaging Avatar %s...", who.obj_id());
		who.health -= DAMAGE_DECREMENT;
		if (who.health <= 0) {
			// He's dead, Jim.
			trace_msg("Avatar %s has been killed", who.obj_id());
			return DEATH;
		} else {
			// Naw, he's only wounded.
			trace_msg("Avatar %s has been wounded", who.obj_id());
			return HIT;
		}
	}
	
	public int damage_object(HabitatMod object) {
		if (damageable(object)) {
			destroy_object(object);
			return DESTROY;
		} else {
			return FALSE;
		}
	}
	
	public boolean damageable(HabitatMod object) {
		return object.HabitatClass() == CLASS_MAILBOX;
	}
	
	public boolean is_ranged_weapon() {
		return HabitatClass() == CLASS_GUN;
	}

}
