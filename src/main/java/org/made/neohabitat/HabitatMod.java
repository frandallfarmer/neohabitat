package org.made.neohabitat;

import org.elkoserver.server.context.BasicObject;
import org.elkoserver.server.context.Context;
import org.elkoserver.server.context.Contextor;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.Mod;
import org.elkoserver.server.context.Msg;
import org.elkoserver.server.context.ObjectCompletionWatcher;
import org.elkoserver.server.context.Position;

import java.math.BigInteger;
import java.util.Random;
import java.util.UUID;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.server.context.User;
import org.elkoserver.util.trace.Trace;
import org.made.neohabitat.mods.Avatar;
import org.made.neohabitat.mods.Compass;
import org.made.neohabitat.mods.Flashlight;
import org.made.neohabitat.mods.Region;
import org.made.neohabitat.mods.Tokens;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;

// TODO CHIP? Should we assureSameContext (and other elko patterns) assuming ill behaving clients? If so, how and when?

/**
 * This is the master superclass of the Habitat Elko project.
 * 
 * All of the game-specific behavior is either in this class or in one of it's
 * descendants. It implements defaults for all the required verbs, the common
 * state that every habitat object has, and lots of generic behavior.
 * 
 * The Elko Open Source project provides a replacement for all of the critical
 * services provided by Q-Link/AOL. It also provides all of the connection
 * management, object database, and message dispatching services that were part
 * of Habitat's server core (non-game logic).
 * 
 * ALL of the original source that is ported here was written in a 1980's flavor
 * of Stratus PL1. PL1 was all about globals, pass by reference, and no support
 * for classes. 30 years ago, Chip Morningstar wrote the bulk of the Habitat
 * game-logic code, simulating structures, classes, and a form of class
 * inheritance by concatenating include files and careful management of
 * procedure references.
 * 
 * The game-logic port of PL1 Habitat to Elko Habitat [Java] focuses on clarity
 * of checking that the translated code is correct and visibly similar to the
 * original code.
 * 
 * This means that some of the coding practices evolved over the last three
 * decades have been set aside. For example - naming conventions about
 * mixed-caps and underscores have been "rolled back" to 1988 - at least in
 * terms of the behavior code. Any 100% new Java code may use modern naming
 * conventions are used (For example, the Habitat mod names are all start with a
 * capital letter.)
 * 
 * The non-static constant globals present a different problem and have been
 * replaced with public state that is accessed by getter functions. So the PL1
 * contents array has been replaced with contents(). Likewise bit-flags are now
 * boolean arrays in memory and they are [un]packed for storage/transmission as
 * needed. And simple dereference functions such as avatar(), container(),
 * current_region(), and position() are provided where globals once were.
 * 
 * @author randy
 *
 */
public abstract class HabitatMod extends Mod implements HabitatVerbs, ObjectCompletionWatcher {

	/* Instance Variables shared by all Habitat objects */

	// public int avatarslot = 0; Obsolete, the connection is clearly
	// represented by the User
	// public int obj_id = 0; Replaced with item.ref() getter
	/**
	 * 0-255. Ephemeral Numeric Object ID: The client's world model of region
	 * contents, 0 = THE_REGION.
	 */
	public int     noid        = 0;
	/**
	 * 0-255 Each Habitat Class has a 0-based table mapping to a global 0-255
	 * space of graphics.
	 */
	public int     style       = 0;
	/** The horizontal position, if the container is THE_REGION */
	public int     x           = 0;
	/**
	 * 0-127 If in THE_REGION, the vertical position (+128 if foreground),
	 * otherwise the offset within the container.
	 */
	public int     y           = 0;
	/** Each graphic resource has multiple views (orientations) */
	public int     orientation;
	// public int position = 0; position always == this.y, so replaced with a
	// getter.
	public int     gr_state    = 0;
	// public int container = 0; containership is managed by Elko - use it's
	// understanding to access the objects
	public int     gr_width    = 0;
	public boolean gen_flags[] = new boolean[33];

	/**
	 * Replaces original global 'position'
	 * 
	 * @return this.y which is a synonym for position within a container.
	 */
	public int position() {
		return y;
	}

	/**
	 * Replaces original global 'obj_id'
	 * 
	 * NOTE: Changes it's type from originally numeric to string.
	 * 
	 * @return The unique object database identity for the object
	 */
	public String obj_id() {
		return this.object().ref();
	}

	/**
	 * Replaces globals avatar/avatarptr
	 * 
	 * @param user
	 *            Who you want to get the Avatar Mod for.
	 * @return Gets the avatar mod for a user
	 */
	public Avatar avatar(User user) {
		return (Avatar) (user.getMod(Avatar.class));
	}

	/**
	 * Replaces global current_region
	 * 
	 * @return The Region mod attached to the current Elko context.
	 */
	public Region current_region() {
		return (Region) context().getMod(Region.class);
	}

	/**
	 * Replaces global container
	 * 
	 * @param obj
	 *            The habitat mod that wants to find it's container.
	 * @return The container mod for the item containing the obj.
	 */
	public Container container(HabitatMod obj) {
		return (Container) obj.object().container().getMod(Container.class);
	}

	/**
	 * Replaces global container (altenate interface)
	 * 
	 * @return The container mod for the item containing 'this'.
	 */
	public Container container() {
		return container(this);
	}

	/**
	 * Constructor.
	 * 
	 * This is an abstract class, and the constructor is only ever called by the
	 * actual habitat objects
	 * 
	 * @param style
	 *            style offset to choose the presentation image default:0
	 * @param x
	 *            horizontal screen position default: 0
	 * @param y
	 *            vertical screen position/z-depth default: 0
	 * @param orientation
	 *            graphic image orientation default: 0
	 * @param gr_state
	 *            animation/graphic state default:0
	 */

	public HabitatMod(int style, int x, int y, int orientation, int gr_state) {
		this.style 			= style;
		this.x				= x;
		this.y 				= y;
		this.orientation 	= orientation;
		this.gr_state 		= gr_state;
	}

	public HabitatMod(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state) {
		this(style.value(0), x.value(0), y.value(0), orientation.value(0), gr_state.value(0));
	}

	public void objectIsComplete() {
		Region.addToNoids(this);
	}

	public JSONLiteral encodeCommon(JSONLiteral result) {
		if (result.control().toClient()) {
			result.addParameter("noid", noid);
		}
		result.addParameter("style", style);
		result.addParameter("x", x);
		result.addParameter("y", y);
		result.addParameter("orientation", orientation);
		result.addParameter("gr_state", gr_state);
		/*
		 * Do not do result.finsh() here. Each Habitat Class does the final
		 * assembly.
		 */
		return result;
	}

	/**
	 * Dump a trace message that an illegal request was received into the log.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	public void illegal(User from) {
		illegal(from, "unspecified");
	}

	/**
	 * Dump a trace message that an illegal request was received into the log.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param request
	 *            The string describing the rejected request.
	 */
	public void illegal(User from, String request) {
		send_reply_error(from);
		trace_msg("Illegal request:'" + request + "' from: " + from.ref());
		object_say(from, noid, "Illegal command request. This has been logged.");
	}

	/**
	 * Verb (Debug): Test rigging for Elko Habitat developers to write trace
	 * messages into the log without actually doing anything
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void TEST(User from) {
		trace_msg("This.getClass().getName(): " + this.getClass().getName());
	}

	/**
	 * Verb (Generic): Get HELP for this.
	 * 
	 * Unlike most verbs, HELP has a useful default implementation that applies
	 * to all classes that don't choose to override it.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void HELP(User from) {
		generic_HELP(from);
	}

	/**
	 * Verb (Illegal): This shouldn't get here. Log it.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod ({"text"})
	public void ASK(User from, OptString text) {
		illegal(from, this.HabitatModName() + ".ASK");
	}

	/**
	 * Verb (Illegal): This shouldn't get here. Log it.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void DO(User from) {
		illegal(from, this.HabitatModName() + ".DO");
	}

	/**
	 * Verb (Illegal): This shouldn't get here. Log it.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void RDO(User from) {
		illegal(from, this.HabitatModName() + ".RDO");
	}

	/**
	 * Verb (Generic): Pick this item up.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void GET(User from) {
		illegal(from, this.HabitatModName() + ".GET");
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
		illegal(from, this.getClass().getName() + ".PUT");
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
		illegal(from, this.getClass().getName() + ".THROW");
	}

	/**
	 * Almost all efforts to GET a Habitat object go through this code. It has
	 * lots of special cases.
	 * 
	 * Various ways GET can fail: the Avatar is already holding something OR the
	 * object is not getable OR the object is not accessible OR the object is an
	 * open container OR the object is in glue or some other permanent container
	 * OR the object is in another Avatar's pockets OR the object is in another
	 * Avatar's hands and can't be grabbed OR the Avatar holding the object is
	 * offline OR the object is in a display case and belongs to the case's
	 * owner OR there's just not enough room here to hold the object!
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	public void generic_GET(User from) {

		HabitatMod cont = container();
		int selfClass = this.HabitatClass();
		int contClass = cont.HabitatClass();

		final int FROM_POCKET = 1;
		final int FROM_GROUND = 0;

		if (!empty_handed(avatar(from)) || !getable(this) || (!accessable(this) && selfClass != CLASS_GAME_PIECE)
				|| contClass == CLASS_BUREAUCRAT || contClass == CLASS_VENDO_FRONT || contClass == CLASS_VENDO_INSIDE
				|| contClass == CLASS_GLUE) {
			send_reply_error(from);
			return;
		}

		if ((selfClass == CLASS_BOX || selfClass == CLASS_BAG) && ((Openable) this).open_flags[OPEN_BIT]) {
			send_reply_error(from);
			return;
		}
		if ((position() != HANDS || !grabable(this)) && (contClass == CLASS_AVATAR && cont.noid != avatar(from).noid)) {
			send_reply_error(from);
			return;
		}

		/*
		 * OBSOLETE CODE: An Elko User == Connection, so there is no Turned to
		 * Stone state. And since a Elko Habitat Avatar is attached 1:1 to a
		 * Elko User, this code can never be true in this server.
		 * 
		 * if (contClass == CLASS_AVATAR &&
		 * ^UserList(cont.avatarslot)->u.online) { send_reply_error(from);
		 * return; }
		 */

		String avatar_userid = from.ref();
		if (contClass == CLASS_DISPLAY_CASE) {
			if (/* TODO DisplayCase dcont.locked(self.position+1)&dcont.owner */ "" != avatar_userid) {
				object_say(from, cont.noid, "You are not the shopkeeper.  You cannot pick this item up.");
				send_reply_error(from);
				return;
			}
		}

		/*
		 * All the preemptive tests have passed, we can really try to pick this
		 * item up!
		 */

		/* Where object is gotten from determines the choreography required */
		int how;

		if (cont.noid == avatar(from).noid)
			how = FROM_POCKET;
		else
			how = FROM_GROUND;

		/*
		 * int original_position = position() + 1; Original dead code that is
		 * never referenced. FRF
		 */

		if (!change_containers(this, (Container) avatar(from), HANDS, true)) {
			send_reply_error(from);
			return;
		}

		/*
		 * If getting a switched on flashlight from an opaque container, turn up
		 * the lights.
		 */
		if (selfClass == CLASS_FLASHLIGHT) {
			if (((Flashlight) this).on == TRUE) {
				if (container_is_opaque(cont,
						y)) { /* TODO should y be position() here? FRF */
					current_region().lighting = current_region().lighting + 1;
					send_broadcast_msg(noid, "CHANGELIGHT_$", "state", 1);
				}
			}
		}

		/* If Tome Of Wealth And Fame, Notify Sysop */
		if (this.object().ref() == "The Tome of Wealth And Fame")
			message_to_god(this, avatar(from), "Tome Recovered!");

		/* If getting a compass, match its orientation to the current region */
		if (selfClass == CLASS_COMPASS) {
			this.gr_state = current_region().orientation;
			this.send_fiddle_msg(THE_REGION, noid, C64_GR_STATE_OFFSET, current_region().orientation);            
		}
		send_reply_success(from); // Yes, your GET request succeeded.
		send_neighbor_msg(from, avatar(from).noid, "GET$", "target", noid, "how", how); // Animate
		// the
		// picking
		// up
		// for
		// other
		// folks
		// here.

		// TODO THIS IS WRONG? Deal with at change_containers
		/*
		 * if (Avatar.getConnectionType() == CONNECTION_JSON &&
		 * container_is_opaque(cont, y)) { context().sendToNeighbors(from,
		 * Msg.msgDelete(this.object())); }
		 */
	}

	/**
	 * Simple 0-parameter PUT version provided to allow for JSON interface
	 * testing. Drops the item at the avatar's feet.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	public void generic_PUT(User from) {
		generic_PUT(from, (Container) current_region(), avatar(from).x, avatar(from).y, avatar(from).orientation);
	}

	/**
	 * Put this into a new container specified by noid.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param containerNoid
	 *            The noid of the new container for this.
	 * @param x
	 *            The new horizontal position of the object (if the container is
	 *            THE_REGION)
	 * @param y
	 *            The new vertical position in THE_REGION or slot number in the
	 *            new container.
	 * @param orientation
	 *            The new orientation for this once transfered.
	 */
	// TODO @deprecate containerNoid/ObjList?
	public void generic_PUT(User from, int containerNoid, int x, int y, int orientation) {
		Region region = current_region();
		Container target = region;
		if (containerNoid != THE_REGION) {
			if (region.noids[containerNoid] instanceof Container) {
				target = (Container) region.noids[containerNoid];
			} else {
				trace_msg("Class " + region.noids[containerNoid].object().ref() + " is not a container.");
				return;
			}
		}
		generic_PUT(from, target, x, y, orientation);
	}

	/**
	 * Most attempt to PUT an item go through this code. There are lots of
	 * special cases.
	 * 
	 * Various ways PUT can fail: the container noid specified by the C64 is
	 * invalid OR it's trying to put down a magic lamp in the genie state OR the
	 * Avatar is not holding the object OR the target location is not available
	 * (already occupied) OR it's putting a restricted object into a
	 * non-restricted container OR it's trying to put a flag into a container
	 * (not allowed) OR the call to change_containers fails because there is not
	 * enough room (this should never happen, since the object is already out,
	 * but we check just in case)
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param cont
	 *            The noid of the new container for this.
	 * @param pos_x
	 *            The new horizontal position of the object (if the container is
	 *            THE_REGION)
	 * @param pos_y
	 *            The new vertical position in THE_REGION or slot number in the
	 *            new container.
	 * @param obj_orient
	 *            The new orientation for this once transfered.
	 */
	public void generic_PUT(User from, Container cont, int pos_x, int pos_y, int obj_orient) {

		final int TO_AVATAR = 1;
		final int TO_GROUND = 0;

		HabitatMod oldContainer = this.container();
		int oldY = y;

		if (this.container() == null) {
			send_reply_error(from);
			return;
		}
		if (!holding(avatar(from), this)) {
			send_reply_error(from);
			return;
		}

		Item item = (Item) this.object();
		int selfClass = this.HabitatClass();
		int contClass = cont.HabitatClass();
		// boolean put_success = false; /* TODO FIX THIS ORIGINAL GLOBAL */
		/*
		 * Check to see of the object being PUT (this) is a container and it's
		 * open
		 */

		if (this instanceof Openable && ((Openable) this).open_flags[OPEN_BIT]) {
			trace_msg("PUT WHILE OPEN: " + from.ref() + " attempted to put " + item.ref() + " into containter "
					+ cont.object().ref());
			send_reply_error(from);
			return;
		}

		if (cont.noid != THE_REGION) {
			if (contClass != CLASS_AVATAR && cont instanceof Openable && !((Openable) cont).open_flags[OPEN_BIT]) {
				send_reply_error(from); // Tried to put into a CLOSED container
				return;
			}
			pos_y = -1;
			int token_at = -1;
			int j = cont.capacity();
			if (contClass == CLASS_AVATAR) {
				j = j - 3;
			}
			for (int i = 0; i < j; i++) {
				HabitatMod obj = cont.contents(i);
				if (obj == null) {
					if (pos_y == -1)
						pos_y = i;
				} else {
					if (obj.HabitatClass() == CLASS_TOKENS) {
						token_at = i;
					}
				}
			}
			if (selfClass == CLASS_TOKENS && token_at != -1) {
				Tokens inHand      = (Tokens) this;
				Tokens inContainer = (Tokens) cont.contents(token_at); 
				int	   newDenom  = inHand.tget() + inContainer.tget();
				if (newDenom > 65535)  {
					send_reply_error(from);
					return;
				}
				inContainer.tset(newDenom);
				inContainer.gen_flags[MODIFIED] = true;
				checkpoint_object(inContainer);
				send_fiddle_msg(THE_REGION, inContainer.noid, C64_TOKEN_DENOM_OFFSET, new int []{newDenom % 256, newDenom/256});
				send_goaway_msg(inHand.noid);
				inHand.destroy_object(inHand);
				send_reply_error(from);			// Well, a merge isn't really a failure, but the client doesn't understand otherwise;				
				return;
			}
			if (pos_y == -1) {
				if (selfClass != CLASS_PAPER) {
					send_reply_error(from);
					return;
				}
				send_reply_error(from);
				// put_success = true;
				return;
			}
		}
		if (!available(cont, pos_x, pos_y)) {
			object_say(from, cont.noid, "The container is full.");
			send_reply_error(from);
			return;
		}
		if (this.gen_flags[RESTRICTED] && !cont.gen_flags[RESTRICTED] && cont.noid != THE_REGION) {
			object_say(from, cont.noid, "You can't put that in there.");
			send_reply_error(from);
			return;
		}
		if (selfClass == CLASS_MAGIC_LAMP && this.gr_state == MAGIC_LAMP_GENIE) {
			object_say(from, noid, "You can't put down a Genie!");
			send_reply_error(from);
			return;
		}
		if (selfClass == CLASS_FLAG && cont.noid != THE_REGION) {
			send_reply_error(from);
			return;
		}
		if (cont.noid == THE_REGION && pos_y < 128) {
			send_reply_error(from);
			return;
		}
		if (cont.noid == THE_REGION && (pos_x < 8 || pos_x > 152)) {
			send_reply_error(from);
			return;
		}

		/* Preemptive tests complete! We're ready to change containers! */

		if (!change_containers(this, cont, pos_y, false)) {
			send_reply_error(from);
			return;
		}

		/* Now for the side effects... */

		boolean going_away_flag = false;

		/* If putting down blank paper, it might disappear. Check. */

		/*
		 * TODO CLASS_PAPER if (selfClass == CLASS_PAPER) going_away_flag =
		 * ((Writable) this).text_id == NULL;
		 */

		/* If putting to the region, set the (x, y) coordinates */
		if (cont.noid == THE_REGION) {
			if (selfClass == CLASS_GAME_PIECE) {
				this.orientation = clear_bit(pos_y, 8);
				send_broadcast_msg(noid, "PLAY_$", "orient", 128 + 0, "piece", noid);
			}
			this.x = pos_x;
			this.y = pos_y;
			if (obj_orient == 1)
				this.orientation = set_bit(this.orientation, 1);
			else
				this.orientation = clear_bit(this.orientation, 1);
		}

		/* If putting into a display case, adjust the locked bit */
		if (contClass == CLASS_DISPLAY_CASE && !going_away_flag) {
			/*
			 * TODO DisplayCase DisplayCase case = (DisplayCase) this;
			 * case.locked[this.position() + 1] = (from.name() == case.owner);
			 * case.gen_flags[MODIFIED] = true;
			 */
		}

		/*
		 * If the object is a switched on flashlight and is being put into an
		 * opaque container, turn down the lights.
		 */
		if (contClass == CLASS_FLASHLIGHT) {
			if (((Flashlight) this).on == TRUE) {
				if (container_is_opaque(cont, pos_y)) {
					current_region().lighting = current_region().lighting - 1;
					send_broadcast_msg(noid, "CHANGELIGHT_$", "change", -1);
				}
			}
		}

		/* If the object is a head, set its gr_state to the dormant mode */
		if (selfClass == CLASS_HEAD && cont.noid != avatar(from).noid)
			gr_state = HEAD_GROUND_STATE;

		/* Where an object is put determines the choreography required */
		int how = TO_GROUND;
		if (cont.noid == avatar(from).noid)
			how = TO_AVATAR;

		/* Inform the world! */
		gen_flags[MODIFIED] = true;
		checkpoint_object(this);
		// put_success = true;

		if (Avatar.getConnectionType() == CONNECTION_JSON) {
			if (container_is_opaque(oldContainer, oldY) && !container_is_opaque(cont, y)) {
				item.sendObjectDescription(context().neighbors(from), context());
			}
		}

		JSONLiteral msg = new_neighbor_msg(avatar(from).noid, "PUT$");
		msg.addParameter("obj", this.noid);
		msg.addParameter("cont", cont.noid);
		msg.addParameter("x", this.x);
		msg.addParameter("y", this.y);
		msg.addParameter("how", how);
		msg.addParameter("orient", this.orientation);
		msg.finish();
		context().sendToNeighbors(from, msg);

		/* TODO Opaque container handling        
        if (Avatar.getConnectionType() == CONNECTION_JSON) {
            if (!container_is_opaque(oldContainer, oldY) && container_is_opaque(cont, y)) {
                context().sendToNeighbors(from, Msg.msgDelete(this.object()));
            }
        }
		 */       
		send_reply_msg(from, noid, "err", TRUE, "pos", this.y);

		/* If putting into a pawn machine, announce the value of the object */
		if (contClass == CLASS_PAWN_MACHINE)
			object_say(from, cont.noid, "Item value: $" + item_value(this));
	}

	/**
	 * Throw this across the room, onto some kind of surface, by noid.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param target
	 *            The noid of the new container for this.
	 * @param target_x
	 *            The new horizontal position for this.
	 * @param target_y
	 *            The new vertical position for this.
	 */
	// TODO @deprecate target/ObjList?
	public void generic_THROW(User from, int target, int target_x, int target_y) {
		generic_THROW(from, current_region().noids[target], target_x, target_y);
	}

	/**
	 * Throw this across the room, onto some kind of surface.
	 *
	 * Various ways THROW can fail: the target noid specified by the C64 is
	 * invalid OR it's trying to throw a magic lamp in the genie state OR the
	 * Avatar is not holding the object OR the target class specified by the C64
	 * is not allowed OR the call to change_containers fails because there is
	 * not enough room (this should never happen, since the object is already
	 * out, but we check just in case)
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param target
	 *            The new container
	 * @param target_x
	 *            The new horizontal position for this.
	 * @param target_y
	 *            The new vertical position for this.
	 */
	public void generic_THROW(User from, HabitatMod target, int target_x, int target_y) {

		int new_x = target_x;
		int new_y = target_y;
		int selfClass = this.HabitatClass();
		int targetClass = target.HabitatClass();
		HabitatMod oldContainer = this.container();
		Avatar avatar = (Avatar) avatar(from);
		int oldY = this.y;
		Item item = (Item) this.object();
		// boolean throw_success = false; /* TODO FIX THIS ORIGINAL GLOBAL */

		/*
		 * DEAD CODE if (target == null) { r_msg_4(from, target.noid, this.x,
		 * this.y, FALSE); return; }
		 */

		if (!holding(avatar, this)) {
			send_throw_reply(from, noid, target.noid, this.x, this.y, FALSE);
			return;
		}

		if (selfClass == CLASS_MAGIC_LAMP && this.gr_state == MAGIC_LAMP_GENIE) {
			object_say(from, noid, "You can''t throw a Genie!");
			send_throw_reply(from, noid, target.noid, this.x, this.y, FALSE);
			return;
		}
		/* If target isn't open ground, object doesn't move */
		if (targetClass != CLASS_STREET && targetClass != CLASS_GROUND) {
			if (targetClass != CLASS_FLAT && targetClass != CLASS_TRAPEZOID && targetClass != CLASS_SUPER_TRAPEZOID) {
				send_throw_reply(from, noid, target.noid, this.x, this.y, FALSE);
				return;
			}
			if (((Walkable) target).flat_type != GROUND_FLAT) {
				send_throw_reply(from, noid, target.noid, this.x, this.y, FALSE);
				return;
			}
		}

		if (target_x > 152 || target_x < 8) {
			send_throw_reply(from, noid, target.noid, this.x, this.y, FALSE);
			return;
		}

		/* Hook for collision detection */
		/*
		 * call check_path(target_id, target_x, target_y, new_x, new_y, dummy);
		 */ // ORIGINAL NEVER IMPLEMENTED

		/* This check says, simply, "did it go where it was aimed?" */
		if (new_x != target_x | new_y != target_y) { // This is dead code TODO
			// Review to Remove
			send_throw_reply(from, noid, target.noid, this.x, this.y, FALSE);
			return;
		}
		/*
		 * Preflight complete! Lets throw the item into the region at the
		 * supplied coordinates
		 */

		if (!change_containers(this, current_region(), 0, false)) {
			trace_msg("*ERR* change_containers fails: generic_THROW");
			send_reply_msg(from, noid, "target", target.noid, "x", this.x, "y", this.y, "err", FALSE);
			return;
		}

		/* Clamp y-coord at region depth */
		new_y = clear_bit(new_y, 8);

		if (new_y > current_region().depth)
			new_y = current_region().depth;

		if (selfClass != CLASS_GAME_PIECE)
			new_y = set_bit(new_y, 8);
		else
			send_broadcast_msg(noid, "PLAY_$", "orient", 128 + 0, "piece", noid);

		/* Put the object there */

		this.x = new_x;
		this.y = new_y;
		this.orientation = clear_bit(this.orientation, 1);

		/* If it's a head, set its gr_state to the ground mode */
		if (selfClass == CLASS_HEAD)
			this.gr_state = HEAD_GROUND_STATE;

		this.gen_flags[MODIFIED] = true;
		checkpoint_object(this);

		/* Tell all the world */
		if (Avatar.getConnectionType() == CONNECTION_JSON) {
			if (container_is_opaque(oldContainer, oldY) && !container_is_opaque(target, y)) {
				item.sendObjectDescription(context().neighbors(from), context());
			}
		}

		send_neighbor_msg(from, avatar.noid, "THROW$", "obj", noid, "x", new_x, "y", new_y, "hit", TRUE);

		/* TODO Opaque container handling        

        if (Avatar.getConnectionType() == CONNECTION_JSON) {
            if (!container_is_opaque(oldContainer, oldY) && container_is_opaque(target, y)) {
                context().sendToNeighbors(from, Msg.msgDelete(this.object()));
            }
        }
		 */

		send_throw_reply(from, noid, target.noid, new_x, new_y, TRUE);

		/* throw_success is a global interrogated by others */
		// throw_success = true;
	}

	private void send_throw_reply(User from, int noid, int target, int x, int y, int err) {
		send_reply_msg(from, noid, "target", target, "x", x, "y", y, "err", err);
	}

	/**
	 * Most of the Habitat classes only need simple strings for their HELP
	 * messages, so this generic implementation provides that. If no override is
	 * specified, this is is the HELP message handler.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	public void generic_HELP(User from) {
		final String help_messages[] = { "i", /* 0 -- region */
				"i", /* 1 -- avatar */
				"i", /* 2 -- amulet */
				"-", /* 3 */
				"ATM: DO displays account balance.  GET withdraws tokens.  PUT deposits tokens into your account.", /*
				 * 4
				 * --
				 * atm
				 */
				"i", /* 5 -- game piece */
				"i", /* 6 -- bag */
				"Recommended for ages 3 through adult.", /* 7 -- ball */
				"-", /* 8 */
				"-", /* 9 */
				"i", /* 10 -- book */
				"Do not use in enclosed spaces.", /* 11 -- boomerang */
				"BOTTLE: GET from water source to fill.  PUT at target to pour.", /*
				 * 12
				 * --
				 * bottle
				 */
				"i", /* 13 -- box */
				"-", /* 14 */
				"-", /* 15 */
				"User assumes all responsibility for consequences of use.", /*
				 * 16
				 * --
				 * club
				 */
				"COMPASS: Arrow points towards West Pole.", /* 17 -- compass */
				"Acme Countertop Co.", /* 18 -- countertop */
				"-", /* 19 */
				"Fragile, do not drop.", /* 20 -- crystal ball */
				"DIE: DO rolls the die", /* 21 -- die */
				"Acme Display Case Co., Fnelia", /* 22 -- display case */
				"i", /* 23 -- door */
				"Don't ever antagonize the horn.", /* 24 -- dropbox */
				"Take only as directed.  Select DO to consume.", /*
				 * 25 -- drugs
				 */
				"Select DO to activate.", /* 26 -- escape device */
				"Use with care.", /* 27 -- fake gun */
				"i", /* 28 -- elevator */
				"\"Soldier ask not, now or ever, where to war your banners go...\"", /*
				 * 29
				 * --
				 * flag
				 */
				"i", /* 30 -- flashlight */
				"Do not use near powerlines.", /* 31 -- frisbee */
				"GARBAGE CAN: DO flushes contents.", /* 32 -- garbage can */
				"i", /* 33 -- gemstone */
				"-", /* 34 */
				"i", /* 35 -- grenade */
				"s", /* 36 -- ground */
				"Use with care.", /* 37 -- gun */
				"How dare you!", /* 38 -- hand of god */
				"i", /* 39 -- hat */
				"Add water to activate.", /* 40 -- instant object pill */
				"i", /* 41 -- jacket */
				"KEY: Hold while opening or closing door or container, if key matches lock, it will lock or unlock it.", /*
				 * 42
				 * --
				 * key
				 */
				"i", /* 43 -- knick knack */
				"Point sharp end towards victim.", /* 44 -- knife */
				"MAGIC LAMP: DO rubs lamp and calls Genie.  TALK to Genie to make wish.  Phrase your wish *carefully*!", /*
				 * 45
				 * --
				 * magic
				 * lamp
				 */
				"i", /* 46 -- magic staff */
				"i", /* 47 -- magic wand */
				"We Await Silent Tristero's Empire", /* 48 -- mailbox */
				"You too can be a highly paid universe designer.  Contact... (the rest is illegible, I'm afraid)", /*
				 * 49
				 * --
				 * matchbook
				 */
				"-", /* 50 */
				"-", /* 51 */
				"Select DO to turn on or off.", /* 52 -- movie camera */
				"-", /* 53 */
				"PAPER: Select DO to read from or write on paper.", /*
				 * 54 --
				 * paper
				 */
				"i", /* 55 */
				"What's the matter?  Can't you read?", /* 56 -- short sign */
				"What's the matter?  Can't you read?", /* 57 -- sign */
				"Acme Landscaping Company", /* 58 -- plant */
				"-", /* 59 */
				"i", /* 60 -- ring */
				"Acme Quarries, Ltd.", /* 61 -- rock */
				"-", /* 62 */
				"Select DO to turn on or off.", /* 63 -- security device */
				"i", /* 64 -- sensor */
				"-", /* 65 */
				"-", /* 66 */
				"-", /* 67 */
				"-", /* 68 */
				"s", /* 69 -- sky */
				"u", /* 70 -- stereo */
				"u", /* 71 -- tape */
				"-", /* 72 */
				"-", /* 73 */
				"i", /* 74 -- teleport booth */
				"i", /* 75 -- ticket */
				"TOKENS: DO displays denomination.", /* 76 -- tokens */
				"-", /* 77 */
				"-", /* 78 */
				"-", /* 79 */
				"s", /* 80 -- wall */
				"-", /* 81 */
				"Select DO to wind.", /* 82 -- windup toy */
				"-", /* 83 */
				"CHANGE-O-MATIC: Point at wall or furniture, then select DO.  Works only in your Turf.", /*
				 * 84
				 * --
				 * changomatic
				 */
				"VENDO: DO displays next selection.  PUT tokens here to purchase item on display.", /*
				 * 85
				 * --
				 * vendo
				 * front
				 */
				"i", /* 86 -- vendo inside */
				"s", /* 87 -- trapezoid */
				"s", /* 88 -- hole */
				"SHOVEL: Point at ground and select DO to dig.", /*
				 * 89 -- shovel
				 */
				"CHANGE MACHINE: Select DO for change.", /* 90 -- sex changer */
				"STUN GUN: do not overuse.", /* 91 -- stun gun */
				"s", /* 92 -- super trapezoid */
				"s", /* 93 -- flat */
				"This is a test.  Had this been an actual object this message would have meaningful content.", /*
				 * 94
				 * --
				 * test
				 */
				"BODY SPRAYER: Point at desired limb, then select DO to color that limb.", /*
				 * 95
				 * --
				 * spray
				 * can
				 */
				"PAWN MACHINE: PUT item inside, then DO to receive tokens in exchange for item", /*
				 * 96
				 * --
				 * pawn
				 * machine
				 */
				"i", /* 97 -- switch / immobile magic */
				"s", /* 98 -- "glue" */
				"-", /* 99 */
				"-", /* 100 */
				"-", /* 101 */
				"-", /* 102 */
				"-", /* 103 */
				"-", /* 104 */
				"-", /* 105 */
				"-", /* 106 */
				"-", /* 107 */
				"-", /* 108 */
				"-", /* 109 */
				"-", /* 110 */
				"-", /* 111 */
				"-", /* 112 */
				"-", /* 113 */
				"-", /* 114 */
				"-", /* 115 */
				"-", /* 116 */
				"-", /* 117 */
				"-", /* 118 */
				"-", /* 119 */
				"-", /* 120 */
				"-", /* 121 */
				"-", /* 122 */
				"-", /* 123 */
				"-", /* 124 */
				"-", /* 125 */
				"-", /* 126 */
				"i", /* 127 -- head */
				"-", /* 128 */
				"Glub, glub.  Two fish in a tub.", /* 129 -- aquarium */
				"BED: If standing by bed, point at it and select GO to sit.  If sitting, point at bed and GO to stand again.", /*
				 * 130
				 * --
				 * bed
				 */
				"\"Beware of troll\"", /* 131 -- bridge */
				"\"An Avatar's Turf is his castle.\"", /* 132 -- building */
				"Acme Landscaping Co.", /* 133 -- bush */
				"CHAIR: If standing by chair, point at it and select GO to sit.  If sitting, point at chair and GO to stand again.", /*
				 * 134
				 * --
				 * chair
				 */
				"i", /* 135 -- chest */
				"\"Have A Choke!\"  Insert coin.", /* 136 -- coke machine */
				"COUCH: If standing by couch, point at it and select GO to sit.  If sitting, point at couch and GO to stand again.", /*
				 * 137
				 * --
				 * couch
				 */
				"Acme Fence Co.", /* 138 -- fence */
				"i", /* 139 -- floor lamp */
				"PUT tokens for significant message.", /*
				 * 140 -- fortune machine
				 */
				"FOUNTAIN: TALK sends message to the Oracle.  Phrase your question or request *carefully*!", /*
				 * 141
				 * --
				 * fountain
				 */
				"-", /* 142 */
				"\"Meow!\"", /* 143 -- house cat */
				"Acme Hot Tub Co., Marin, California", /* 144 -- hot tub */
				"u", /* 145 -- jukebox */
				"-", /* 146 */
				"s", /* 147 -- pond */
				"s", /* 148 -- river */
				"i", /* 149 -- roof */
				"i", /* 150 -- safe */
				"-", /* 151 */
				"What's the matter?  You blind?  It's a picture.", /*
				 * 152 --
				 * picture
				 */
				"s", /* 153 -- street */
				"Acme Streetlamp Co.", /* 154 -- streetlamp */
				"Acme Table Co.", /* 155 -- table */
				"Acme Landscaping Co.", /* 156 -- tree */
				"Acme Window Co.", /* 157 -- window */
		"BUREAUCRAT: TALK sends your request to the bureaucracy.  Please be sure this is the right bureaucrat." };

		String the_message = help_messages[HabitatClass()];
		if (the_message == "-") { /* non-existent objects */
			the_message = "This object does not exist.";
		} else if (the_message == "s") { /* background scenic objects */
			the_message = "For HELP, point at an object and press the F7 key.";
		} else if (the_message == "u") { /* unimplemented help features */
			the_message = "Sorry, no help here yet.";
		} else if (the_message == "i") { /* impossible to get messages */
			trace_msg("Impossible help request, class " + this.getClass().getSimpleName()
					+ ". Missing HELP implementation?");
			the_message = "How did you do that?";
		}
		send_reply_msg(from, the_message);
	}

	/**
	 * @param packedBits
	 *            The bits unpacked into a boolean array. NOTE: PL1 arrays uses
	 *            1-based arrays, so historically all the bit offset constants
	 *            are as well. We lose the high bit, but we never use it.
	 *
	 * @return boolean array of unpacked bits
	 */
	public boolean[] unpackBits(int packedBits) {
		boolean bits[] = new boolean[32];
		for (int i = 0; i < 31; i++) {
			bits[i + 1] = ((packedBits & (1 << i)) != 0);
		}
		return bits;
	}

	/**
	 * NOTE: PL1 arrays uses 1-based arrays, so historically all the bit offset
	 * constants are as well. We lose the high bit, but we never use it.
	 * 
	 * @param bits
	 *            The boolean array to pack into an int.
	 * @return an int made of the the bits
	 */
	public int packBits(boolean[] bits) {
		int result = 0;
		for (int i = 0; i < 31; ++i) {
			if (bits[i + 1]) {
				result = result | (1 << i);
			}
		}
		return result;
	}

	/**
	 * Used in pawn machines to set the buy-back value of a Habitat object.
	 * 
	 * @param item
	 *            The thing being priced.
	 * @return The price in tokens.
	 */
	public int item_value(HabitatMod item) {
		/* TODO item_value placeholder */
		return 2;
	}

	/**
	 * This is a special-case visibility check. You see, the avatar is both
	 * transparent AND opaque.
	 * 
	 * @param cont
	 *            The container being tested
	 * @param pos
	 *            The position being tested
	 * @return Is this slot, of this container, visible to the region?
	 */
	public boolean container_is_opaque(HabitatMod cont, int pos) {
		if (cont.HabitatClass() == CLASS_AVATAR)
			if (pos == HANDS || pos == HEAD)
				return (false);
			else
				return (true);
		return this.opaque_container(); /* TODO Discuss with Chip */
	}

	/**
	 * Visibility check.
	 * 
	 * @param cont
	 *            The container being tested
	 * @return Is this slot, of this container, visible to the region?
	 */
	// TODO @depracate Is this ever used properly? It would be bad to call this
	// if CLASS_AVATAR
	public boolean container_is_opaque(HabitatMod cont) {
		return container_is_opaque(cont, 0);
	}

	/**
	 * empty_handed -- Return true iff 'who' is not holding anything.
	 * 
	 * @param who
	 *            The avatar being tested.
	 * @return Is the avatar empty handed?
	 */
	public boolean empty_handed(Avatar who) {
		return (who.contents(HANDS) == null);
	}

	/**
	 * holding -- Return true iff the avatar is holding a given object.
	 * 
	 * @param avatar
	 *            The avatar being tested.
	 * @param object
	 *            The object being tested.
	 * @return Is the object in the avatar's hands?
	 */

	public boolean holding(Avatar avatar, HabitatMod object) {
		HabitatMod inHands = avatar.contents(HANDS);
		return (null != inHands && inHands.noid == object.noid);
	}


	/**
	 * Returns the HabitatMod of the item held in the avatar's hand.
	 * 
	 * @param avatar
	 * @return
	 */
	public HabitatMod heldObject(Avatar avatar) {
		return avatar.contents(HANDS);
	}


	/**
	 * Returns the HabitatMod of the item held in the user's avatar's hand.
	 * 
	 * @param from
	 * @return
	 */
	public HabitatMod heldObject(User from) {
		return heldObject(avatar(from));
	}

	/**
	 * Returns the HabitatMod of the item held in *this* avatar object.
	 * 
	 * @return
	 */
	public HabitatMod heldObject() {
		return heldObject((Avatar) this);
	}

	/**
	 * wearing -- Return true iff the avatar is wearing (head slot) a given
	 * object.
	 * 
	 * @param avatar
	 *            The avatar being tested.
	 * @param object
	 *            The object being tested.
	 * @return Is the object being worn by the avatar?
	 */
	public boolean wearing(Avatar avatar, HabitatMod object) {
		HabitatMod onShoulders = avatar.contents(HEAD);
		return (null != onShoulders && onShoulders.noid == object.noid);
	}

	/**
	 * getable -- Return true iff a given object can be picked up by an avatar.
	 *
	 * @param object
	 *            The object being tested.
	 * @return Is the object portable?
	 */
	public boolean getable(HabitatMod object) {
		if (object.HabitatClass() == CLASS_ROCK 
				|| object.HabitatClass() == CLASS_FLAG 
				|| object.HabitatClass() == CLASS_PLANT) {
			return (((Massive) object).mass == 0);
		}
		return (true);
	}

	/**
	 * grabable -- Return true iff a given object can be grabbed from an
	 * avatar's hand.
	 * 
	 * NOTE: Tests the region to see if it is STEAL_FREE.
	 *
	 * @param object
	 *            The object being tested.
	 * @return Is the object grabable?
	 */
	public boolean grabable(HabitatMod object) {

		if (current_region().nitty_bits[STEAL_FREE] || object.HabitatClass() == CLASS_PAPER
				|| object.HabitatClass() == CLASS_BOOK || object.HabitatClass() == CLASS_TOKENS
				|| (object.HabitatClass() == CLASS_MAGIC_LAMP && object.gr_state == MAGIC_LAMP_GENIE)) {
			return false;
		}
		return true;
	}

	/**
	 * Is the specified position available to be filled?
	 * 
	 * @param container
	 *            The target container;
	 * @param x
	 *            The horizontal position (not considered. Should be deprecated)
	 * @param y
	 *            The slot/vertical position
	 * @return Is it OK to put the item at this position?
	 */
	public boolean available(HabitatMod container, int x, int y) {
		if (container == null)
			return false;
		if (container.noid == THE_REGION)
			return true;
		if (!(container instanceof Container))
			return false;
		return ((Container) container).contents(y) == null;
	}

	/**
	 * accessable -- Return true iff a given object can be reached by the
	 * avatar.
	 * 
	 * @param object
	 *            The object being tested.
	 * @return Can we access this object given container nesting??
	 */
	public boolean accessable(HabitatMod object) {
		if (container(object).noid == THE_REGION)
			return (adjacent(object));
		else
			/*
			 * return(accessable(ObjList(object.container))); TODO Placeholder
			 * Recursive container walk
			 */
			return true;
	}

	/**
	 * elsewhere -- Return true iff the object is not near the Avatar (i.e., not
	 * adjacent and not in hand).
	 * 
	 * @param object
	 *            The object being tested.
	 * @param user
	 *            The User-avatar
	 * @return Is our avatar standing in the right place to manipulate this
	 *         object?
	 */
	public boolean elsewhere(HabitatMod object, User user) {
		return (container(object) != (Container) avatar(user) && !adjacent(object));
	}

	/**
	 * here -- Return true iff the given object is exactly where the Avatar is.
	 * 
	 * @param object
	 *            The object being tested.
	 * @param user
	 *            The User-avatar
	 * @return Is our avatar standing exactly on the object?
	 */
	public boolean here(HabitatMod object, User user) {
		return (container(object).noid == THE_REGION && object.x == avatar(user).x && object.y == avatar(user).y);
	}

	/**
	 * goto_new_region -- Transfer the avatar to someplace else.
	 * 
	 * Provided as syntactic sugar for easy class migration.
	 * 
	 * @param avatar The avatar mod of the user that is being sent someplace else
	 * @param contextRef The elko ref for the new region
	 * @param direction	WEST, EAST, NORTH, SOUTH, AUTO_TELEPORT_DIR
	 * @param transition_type WALK_ENTRY, TELEPORT_ENTRY, DEATH_ENTRY
	 */

	public void goto_new_region(Avatar avatar, String contextRef, int direction, int transition_type) {
		// This used to be more complicated - Elko's ever-context-change-is-a-new-connection makes this easy.
		// We just ask the bridge to call us back for a new region.
		avatar.change_regions(contextRef, direction, transition_type);
	}

	/**
	 * Are we standing next to the object so we can manipulate it properly?
	 * 
	 * @param object
	 *            The object being tested.
	 * @return Is our avatar standing next to the object?
	 */
	public boolean adjacent(HabitatMod object) {
		/* TODO Implement a real adjacent test */
		/* TODO Mising parameter? */
		return true;
	}


	/**
	 * change_containers -- Move an object from one container to another.
	 * 
	 * @param obj
	 *            The object being moved
	 * @param new_container
	 *            The target container
	 * @param new_position
	 *            The new position (slot)
	 * @param cp
	 *            Checkpoint flag
	 * @return success
	 */

	public boolean change_containers(HabitatMod obj, Container new_container, int new_position, boolean cp) {

		if (obj.noid == THE_REGION) {
			trace_msg("*ERR* Attempt to contain region: " + obj.object().ref());
			return false;
		}

		if (!heap_space_available(obj, new_container))
			return false;

		/*
		 * Every check has passed. Proceed with container change (which should
		 * not fail.)
		 */

		((Item) obj.object()).setContainer(new_container.object()); // TODO Talk
		// to Chip
		// about
		// neighbors
		// not
		// deleting
		// picked up
		// items and
		// also
		// HANDS/HEAD
		// slots.
		// FRF

		obj.y = new_position;
		obj.gen_flags[MODIFIED] = true;
		if (cp)
			checkpoint_object(this);

		return true;

	}

	/**
	 * Test to see if the client will have room for the resources changed by an
	 * upcoming container change. This can be a problem when an object comes out
	 * of an opaque container.
	 * 
	 * @param obj
	 *            Object being moved
	 * @param new_container
	 *            The new container.
	 * @return Will the container change work on the client, considering limited
	 *         memory?
	 */

	boolean heap_space_available(HabitatMod obj, Container new_container) {
		return true;
	}
	/*
	 * TODO This is a placeholder implementation. Client Storage is NOT
	 * currently managed FRF
	 */
	/*
	 * heap_space_available: procedure (dmy) returns (bit(1) aligned); declare
	 * dmy bin(15);
	 * 
	 * if (container_is_opaque (old_container.class,obj.position)) then call
	 * note_instance_deletion (obj.class,obj.style); else call
	 * note_object_deletion (obj.class,obj.style); if (container_is_opaque
	 * (new_container.class,new_position)) then call note_instance_creation
	 * (obj.class,obj.style); else call note_object_creation
	 * (obj.class,obj.style);
	 * 
	 * if (mem_checks_ok (obj.class)) then return (true);
	 * 
	 * if (container_is_opaque (new_container.class,new_position)) then call
	 * note_instance_deletion (obj.class,obj.style); else call
	 * note_object_deletion (obj.class,obj.style); if (container_is_opaque
	 * (old_container.class,obj.position)) then call note_instance_creation
	 * (obj.class,obj.style); else call note_object_creation
	 * (obj.class,obj.style);
	 * 
	 * return (false);
	 * 
	 * end heap_space_available;
	 */

	/**
	 * Dump a string to the debugging server log.
	 * 
	 * @param msg
	 *            The message to log.
	 */
	public void trace_msg(String msg) {
		Trace.trace("habitat").warningm(msg);
	}

	/**
	 * Message from a Habitat user that is meant to be logged in a special
	 * Oracle/Moderator log file. Often a message about a special (hard coded)
	 * event or speaking with the Oracle Fountain.
	 * 
	 * @param obj
	 *            The object that is logging the message (e.g. Oracle Fountain.)
	 * @param avatar
	 *            The avatar that took the action to trigger the message.
	 * @param msg
	 *            The message to be logged.
	 */
	public void message_to_god(HabitatMod obj, HabitatMod avatar, String msg) {
		Trace.trace(msg + " by " + avatar.object().ref() + " via " + obj.object().ref());
		/*
		 * TODO Placeholder implementation by FRF - full implementation when
		 * CLASS_ORACLE is ported.
		 */
	}

	/**
	 * An object sends a string message to a specific user
	 * 
	 * @param to
	 *            User the message is going to.
	 * @param noid
	 *            The object speaking to the user.
	 * @param text
	 *            What the object wants to say.
	 */
	public void object_say(User to, int noid, String text) {
		JSONLiteral msg = new_private_msg(THE_REGION, "OBJECTSPEAK_$");
		msg.addParameter("text", text);
		msg.addParameter("speaker", noid);
		msg.finish();
		to.send(msg);
	}

	/**
	 * An object sends a string message to a specific user
	 * 
	 * @param to
	 *            User the message is going to.
	 * @param text
	 *            What the object wants to say.
	 */
	public void object_say(User to, String text) {
		object_say(to, this.noid, text);
	}

	/**
	 * An object sends a string message to everyone
	 * 
	 * @param noid
	 *            The object speaking to the region.
	 * @param text
	 *            What the object wants to say.
	 */

	public void object_broadcast(int noid, String text) {
		JSONLiteral msg = new_broadcast_msg(THE_REGION, "OBJECTSPEAK_$");
		msg.addParameter("text", text);
		msg.addParameter("speaker", noid);
		msg.finish();
		context().send(msg);
	}

	/**
	 * An object sends a string message to everyone
	 * 
	 * @param text
	 *            What the object wants to say.
	 */
	public void object_broadcast(String text) {
		object_broadcast(this.noid, text);
	}

	/**
	 * Send a fiddle message to the entire region. The client does all the work.
	 *
	 * @param noid
	 * @param args
	 */
	public void send_fiddle_msg(int noid, int target, int offset, int[] args) {
		JSONLiteral msg = new_broadcast_msg(noid, "FIDDLE_$");
		msg.addParameter("target", target);
		msg.addParameter("offset", offset);
		msg.addParameter("argCount", args.length);
		if (args.length > 1) {
			msg.addParameter("value", args);
		} else {
			msg.addParameter("value", args[0]);
		}
		msg.finish();
		context().send(msg);
	}


	/**
	 * Fiddle message with only a single arg...
	 * 
	 * @param noid
	 * @param target
	 * @param offset
	 * @param arg
	 */
	public void send_fiddle_msg(int noid, int target, int offset, int arg) {
		send_fiddle_msg(noid, target, offset, new int[]{ arg });
	}

	/**
	 * Tells the region to get rid of an object at the provided noid.
	 *
	 * @param noid
	 */
	public void send_goaway_msg(int noid) {
		JSONLiteral msg = new_broadcast_msg(THE_REGION, "GOAWAY_$");
		msg.addParameter("target", noid);
		msg.finish();
		context().send(msg);
	}

	/**
	 * Temporary scaffolding for incremental development of the server. Call
	 * this to say "not ready yet!" and reply with an error code. Hopefully the
	 * client will accept the result and proceed.
	 * 
	 * @param from
	 *            The connection for this user.
	 * @param noid
	 *            The noid that sent the request that is being unceremoniously
	 *            terminated.
	 * @param text
	 *            This error message text will be sent to the client of the user
	 *            that issued the unsupported command.
	 */
	public void unsupported_reply(User from, int noid, String text) {
		object_say(from, text);
		send_reply_error(from, noid); // TODO Remove This last ditch attempt to
		// keep the client running after a
		// unsupported command arrives.
	}

	/**
	 * Create a JSONLiteral initialized with the minimum arguments for broadcast
	 * from the Habitat/Elko server.
	 * 
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request. In the PL/1 source
	 *            this was a numeric constant, not a string. i.e PL/1: SPEAK$
	 *            Elko: "SPEAK$". The lookup now occurs in the Client/Server
	 *            bridge.
	 * @return message ready to add more parameters, finish(), and send.
	 */
	public JSONLiteral new_broadcast_msg(int noid, String op) {
		JSONLiteral msg = new JSONLiteral("broadcast", EncodeControl.forClient);
		msg.addParameter("noid", noid);
		msg.addParameter("op", op);
		return msg;
	}

	/**
	 * Create a JSONLiteral initialized with the minimum arguments needed for
	 * the Habitat/Elko server. Assumes this.noid is the object of interest.
	 * 
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request. In the PL/1 source
	 *            this was a numeric constant, not a string. i.e PL/1: SPEAK$
	 *            Elko: "SPEAK$". The lookup now occurs in the Client/Server
	 *            bridge.
	 * @return message ready to add more parameters, finish(), and send.
	 */
	public JSONLiteral new_broadcast_msg(String op) {
		return new_broadcast_msg(this.noid, op);
	}

	/**
	 * Sends a ASYNCHRONOUS broadcast message to all the
	 * connections/users/avatars in a region.
	 * 
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_broadcast_msg)
	 */
	public void send_broadcast_msg(int noid, String op) {
		JSONLiteral msg = new_broadcast_msg(noid, op);
		msg.finish();
		context().send(msg);
	}

	/**
	 * Sends a ASYNCHRONOUS broadcast message to all the
	 * connections/users/avatars in a region.
	 * 
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_broadcast_msg)
	 * @param text
	 *            A string to send, will have attribute name "text"
	 */
	public void send_broadcast_msg(int noid, String op, String text) {
		JSONLiteral msg = new_broadcast_msg(noid, op);
		msg.addParameter("text", text);
		msg.finish();
		context().send(msg);
	}

	/**
	 * Sends a ASYNCHRONOUS broadcast message to all the
	 * connections/users/avatars in a region.
	 * 
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_broadcast_msg)
	 * @param attrib
	 *            The attribute name to be added to the message
	 * @param value
	 *            The value of the attribute.
	 */
	public void send_broadcast_msg(int noid, String op, String attrib, int value) {
		JSONLiteral msg = new_broadcast_msg(noid, op);
		msg.addParameter(attrib, value);
		msg.finish();
		context().send(msg);
	}

	/**
	 * Sends a ASYNCHRONOUS broadcast message to all the
	 * connections/users/avatars in a region.
	 * 
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_broadcast_msg)
	 * @param attrib
	 *            The attribute name to be added to the message
	 * @param value
	 *            The string value of the attribute.
	 */
	public void send_broadcast_msg(int noid, String op, String attrib, String value) {
		JSONLiteral msg = new_broadcast_msg(noid, op);
		msg.addParameter(attrib, value);
		msg.finish();
		context().send(msg);
	}

	/**
	 * Sends a ASYNCHRONOUS broadcast message to all the
	 * connections/users/avatars in a region.
	 * 
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_broadcast_msg)
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 */
	public void send_broadcast_msg(int noid, String op, String a1, int v1, String a2, int v2) {
		JSONLiteral msg = new_broadcast_msg(noid, op);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.finish();
		context().send(msg);
	}

	/**
	 * Sends a ASYNCHRONOUS broadcast message to all the
	 * connections/users/avatars in a region.
	 * 
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_broadcast_msg)
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 * @param a3
	 *            Third attribute to add
	 * @param v3
	 *            Third value to add
	 */
	public void send_broadcast_msg(int noid, String op, String a1, int v1, String a2, int v2, String a3, int v3) {
		JSONLiteral msg = new_broadcast_msg(noid, op);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.addParameter(a3, v3);
		msg.finish();
		context().send(msg);
	}

	/**
	 * Sends a ASYNCHRONOUS broadcast message to all the
	 * connections/users/avatars in a region.
	 * 
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_broadcast_msg)
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 * @param a3
	 *            Third attribute to add
	 * @param v3
	 *            Third value to add
	 * @param a4
	 *            Fourth attribute to add
	 * @param v4
	 *            Fourth value to add
	 */
	public void send_broadcast_msg(int noid, String op, String a1, int v1, String a2, int v2, String a3, int v3,
			String a4, int v4) {
		JSONLiteral msg = new_broadcast_msg(noid, op);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.addParameter(a3, v3);
		msg.addParameter(a4, v4);
		msg.finish();
		context().send(msg);
	}

	/**
	 * Creates a SYNCHRONOUS (client is waiting) reply message using the minimum
	 * arguments.
	 * 
	 * @param noid
	 *            The object waiting for this reply.
	 * @return message ready to add more parameters, finish(), and send.
	 */
	public JSONLiteral new_reply_msg(int noid) {
		JSONLiteral msg = new JSONLiteral("reply", EncodeControl.forClient);
		msg.addParameter("noid", noid);
		msg.addParameter("filler", 0); // TODO BAD! WHAT IS THIS??
		return msg;
	}

	/**
	 * Generates a reply message assuming that the noid is inferred by this
	 * object.
	 * 
	 * @return message ready to add more parameters, finish(), and send.
	 */
	public JSONLiteral new_reply_msg() {
		return new_reply_msg(this.noid);
	}

	/**
	 * Sends a SYNCHRONOUS (client is waiting) reply message using the minimum
	 * arguments.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param noid
	 *            The object waiting for this reply.
	 */
	public void send_reply_msg(User from, int noid) {
		JSONLiteral msg = new_reply_msg(noid);
		msg.finish();
		from.send(msg);
	}

	/**
	 * Sends a SYNCHRONOUS (client is waiting) string-only reply message
	 * inferring this.noid.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param text
	 *            The string to send, added with the attribute name "text"
	 */
	public void send_reply_msg(User from, String text) {
		JSONLiteral msg = new_reply_msg();
		msg.addParameter("text", text);
		msg.finish();
		from.send(msg);
	}

	/**
	 * Sends a SYNCHRONOUS (client is waiting) reply message, with addition
	 * attributes/values.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param noid
	 *            The object waiting for this reply.
	 * @param attrib
	 *            The attribute name to be added to the message
	 * @param value
	 *            The value of the attribute.
	 */
	public void send_reply_msg(User from, int noid, String attrib, int value) {
		JSONLiteral msg = new_reply_msg(noid);
		msg.addParameter(attrib, value);
		msg.finish();
		from.send(msg);
	}

	/**
	 * Sends a SYNCHRONOUS (client is waiting) reply message, with addition
	 * attributes/values.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param noid
	 *            The object waiting for this reply.
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 */
	public void send_reply_msg(User from, int noid, String a1, int v1, String a2, int v2) {
		JSONLiteral msg = new_reply_msg(noid);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.finish();
		from.send(msg);
	}

	/**
	 * Sends a SYNCHRONOUS (client is waiting) reply message, with addition
	 * attributes/values.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param noid
	 *            The object waiting for this reply.
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 * @param a3
	 *            Third attribute to add
	 * @param v3
	 *            Third value to add
	 */
	public void send_reply_msg(User from, int noid, String a1, int v1, String a2, int v2, String a3, int v3) {
		JSONLiteral msg = new_reply_msg(noid);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.addParameter(a3, v3);
		msg.finish();
		from.send(msg);
	}

	/**
	 * Sends a SYNCHRONOUS (client is waiting) reply message, with addition
	 * attributes/values.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param noid
	 *            The object waiting for this reply.
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 * @param a3
	 *            Third attribute to add
	 * @param v3
	 *            Third value to add
	 * @param a4
	 *            Fourth attribute to add
	 * @param v4
	 *            Fourth value to add
	 *
	 **/
	public void send_reply_msg(User from, int noid, String a1, int v1, String a2, int v2, String a3, int v3, String a4,
			int v4) {
		JSONLiteral msg = new_reply_msg(noid);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.addParameter(a3, v3);
		msg.addParameter(a4, v4);
		msg.finish();
		from.send(msg);
	}

	/**
	 * Sends a SYNCHRONOUS (client is waiting) reply message, with additional
	 * String value.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param noid
	 *            The object waiting for this reply.
	 * @param attrib
	 *            The attribute name to be added to the message
	 * @param value
	 *            The STRING value of the attribute.
	 */
	public void send_reply_msg(User from, int noid, String attrib, String value) {
		JSONLiteral msg = new_reply_msg(noid);
		msg.addParameter(attrib, value);
		msg.finish();
		from.send(msg);
	}

	/**
	 * Send simple SYNCHRONOUS reply indicating success or failure.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param noid
	 *            The object waiting for this reply.
	 * @param err
	 *            The error state byte (NOT boolean), added to the msg as
	 *            attribute "err"
	 */
	public void send_reply_err(User from, int noid, int err) {
		JSONLiteral msg = new JSONLiteral("reply", EncodeControl.forClient);
		msg.addParameter("noid", noid);
		msg.addParameter("filler", err); // TODO BAD! WHAT IS THIS??
		msg.addParameter("err", err);
		msg.finish();
		from.send(msg);
	}

	/**
	 * Send simple SYNCHRONOUS reply indicating failure.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param noid
	 *            The object waiting for this reply.
	 */
	public void send_reply_error(User from, int noid) {
		send_reply_err(from, noid, FALSE);
	}

	/**
	 * Send simple SYNCHRONOUS reply indicating failure. Uses this.noid.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 */
	public void send_reply_error(User from) {
		send_reply_error(from, this.noid);
	}

	/**
	 * Send simple SYNCHRONOUS reply indicating success.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 * @param noid
	 *            The object waiting for this reply.
	 */
	public void send_reply_success(User from, int noid) {
		send_reply_err(from, noid, TRUE);
	}

	/**
	 * Send simple SYNCHRONOUS reply indicating success. Uses this.noid.
	 * 
	 * @param from
	 *            The User/connection that gets the reply.
	 */
	public void send_reply_success(User from) {
		send_reply_success(from, this.noid);
	}

	/**
	 * Create a JSONLiteral initialized with the minimum arguments to send to a
	 * user/connections "neighbors/other users" via the Habitat/Elko server.
	 * 
	 * @param noid
	 *            The object that is acting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request. In the PL/1 source
	 *            this was a numeric constant, not a string. i.e PL/1: SPEAK$
	 *            Elko: "SPEAK$". The lookup now occurs in the Client/Server
	 *            bridge.
	 * @return message ready to add more parameters, finish(), and send.
	 */
	public JSONLiteral new_neighbor_msg(int noid, String op) {
		JSONLiteral msg = new JSONLiteral("neighbor", EncodeControl.forClient);
		msg.addParameter("noid", noid);
		msg.addParameter("op", op);
		return msg;
	}

	/**
	 * Create a JSONLiteral initialized with the minimum arguments to send to a
	 * user/connections "neighbors/other users" via the Habitat/Elko server.
	 * this.noid is used for the acting object.
	 * 
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request. In the PL/1 source
	 *            this was a numeric constant, not a string. i.e PL/1: SPEAK$
	 *            Elko: "SPEAK$". The lookup now occurs in the Client/Server
	 *            bridge.
	 * @return message ready to add more parameters, finish(), and send.
	 */
	public JSONLiteral new_neighbor_msg(String op) {
		return new_neighbor_msg(this.noid, op);
	}

	/**
	 * Sends a ASYNCHRONOUS message to all the neighbors (other
	 * user/connections) in a region.
	 * 
	 * @param from
	 *            The user/connection that is acting, and the only one that will
	 *            NOT get the message.
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_neighbor_msg)
	 */
	public void send_neighbor_msg(User from, int noid, String op) {
		JSONLiteral msg = new_neighbor_msg(noid, op);
		msg.finish();
		context().sendToNeighbors(from, msg);
	}

	/**
	 * Sends a ASYNCHRONOUS message to all the neighbors (other
	 * user/connections) in a region. this.noid is the acting object.
	 * 
	 * @param from
	 *            The user/connection that is acting, and the only one that will
	 *            NOT get the message.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_neighbor_msg)
	 */
	public void send_neighbor_msg(User from, String op) {
		JSONLiteral msg = new_neighbor_msg(this.noid, op);
		msg.finish();
		context().sendToNeighbors(from, msg);
	}

	/**
	 * Sends a ASYNCHRONOUS message to all the neighbors (other
	 * user/connections) in a region with an additional parameters.
	 * 
	 * @param from
	 *            The user/connection that is acting, and the only one that will
	 *            NOT get the message.
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_neighbor_msg)
	 * @param attrib
	 *            First attribute to add
	 * @param value
	 *            First value to add
	 */
	public void send_neighbor_msg(User from, int noid, String op, String attrib, int value) {
		JSONLiteral msg = new_neighbor_msg(noid, op);
		msg.addParameter(attrib, value);
		msg.finish();
		context().sendToNeighbors(from, msg);
	}

	/**
	 * Sends a ASYNCHRONOUS message to all the neighbors (other
	 * user/connections) in a region with additional parameters.
	 * 
	 * @param from
	 *            The user/connection that is acting, and the only one that will
	 *            NOT get the message.
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_neighbor_msg)
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 */

	public void send_neighbor_msg(User from, int noid, String op, String a1, int v1, String a2, int v2) {
		JSONLiteral msg = new_neighbor_msg(noid, op);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.finish();
		context().sendToNeighbors(from, msg);
	}

	/**
	 * Sends a ASYNCHRONOUS message to all the neighbors (other
	 * user/connections) in a region with additional parameters.
	 * 
	 * @param from
	 *            The user/connection that is acting, and the only one that will
	 *            NOT get the message.
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_neighbor_msg)
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 * @param a3
	 *            Third attribute to add
	 * @param v3
	 *            Third value to add
	 */
	public void send_neighbor_msg(User from, int noid, String op, String a1, int v1, String a2, int v2, String a3,
			int v3) {
		JSONLiteral msg = new_neighbor_msg(noid, op);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.addParameter(a3, v3);
		msg.finish();
		context().sendToNeighbors(from, msg);
	}

	/**
	 * Sends a ASYNCHRONOUS message to all the neighbors (other
	 * user/connections) in a region with additional parameters.
	 * 
	 * @param from
	 *            The user/connection that is acting, and the only one that will
	 *            NOT get the message.
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_neighbor_msg)
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 * @param a3
	 *            Third attribute to add
	 * @param v3
	 *            Third value to add
	 * @param a4
	 *            Fourth attribute to add
	 * @param v4
	 *            Fourth value to add
	 */
	public void send_neighbor_msg(User from, int noid, String op, String a1, int v1, String a2, int v2, String a3,
			int v3, String a4, int v4) {
		JSONLiteral msg = new_neighbor_msg(noid, op);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.addParameter(a3, v3);
		msg.addParameter(a4, v4);
		msg.finish();
		context().sendToNeighbors(from, msg);
	}

	/**
	 * Sends a ASYNCHRONOUS message to all the neighbors (other
	 * user/connections) in a region with an additional string.
	 * 
	 * @param from
	 *            The user/connection that is acting, and the only one that will
	 *            NOT get the message.
	 * @param noid
	 *            The object that is broadcasting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_neighbor_msg)
	 * @param attrib
	 *            Attribute to add
	 * @param value
	 *            String to add
	 */
	public void send_neighbor_msg(User from, int noid, String op, String attrib, String value) {
		JSONLiteral msg = new_neighbor_msg(noid, op);
		msg.addParameter(attrib, value);
		msg.finish();
		context().sendToNeighbors(from, msg);
	}

	/**
	 * Create a JSONLiteral initialized with the minimum arguments to send a
	 * private message to a single targeted user/connection.
	 * 
	 * @param noid
	 *            The object that is acting.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request. In the PL/1 source
	 *            this was a numeric constant, not a string. i.e PL/1: SPEAK$
	 *            Elko: "SPEAK$". The lookup now occurs in the Client/Server
	 *            bridge.
	 * @return message ready to add more parameters, finish(), and send.
	 */

	public JSONLiteral new_private_msg(int noid, String op) {
		JSONLiteral msg = new JSONLiteral("private", EncodeControl.forClient);
		msg.addParameter("noid", noid);
		msg.addParameter("op", op);
		return msg;
	}

	/**
	 * Create a JSONLiteral initialized with the minimum arguments to send a
	 * private message to a single targeted user/connection. this.noid is used
	 * as the acting object.
	 * 
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request. In the PL/1 source
	 *            this was a numeric constant, not a string. i.e PL/1: SPEAK$
	 *            Elko: "SPEAK$". The lookup now occurs in the Client/Server
	 *            bridge.
	 * @return message ready to add more parameters, finish(), and send.
	 */
	public JSONLiteral new_private_msg(String op) {
		return new_private_msg(this.noid, op);
	}

	/**
	 * Send a private message to a specified user-connection.
	 * 
	 * @param from
	 *            The user/connection that instigated this action. Will NOT get
	 *            a copy of the message.
	 * @param noid
	 *            The object that is acting.
	 * @param to
	 *            The user/connection that is the recipient of this private
	 *            message.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_private_msg)
	 */
	public void send_private_msg(User from, int noid, User to, String op) {
		JSONLiteral msg = new_private_msg(noid, op);
		msg.finish();
		to.send(msg);
	}

	/**
	 * Send a single-string private message to a specified user-connection.
	 * 
	 * @param from
	 *            The user/connection that instigated this action. Will NOT get
	 *            a copy of the message.
	 * @param noid
	 *            The object that is acting.
	 * @param to
	 *            The user/connection that is the recipient of this private
	 *            message.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_private_msg)
	 * @param text
	 *            A string to send. Will be added to the message as the "text"
	 *            parameter.
	 */
	public void send_private_msg(User from, int noid, User to, String op, String text) {
		JSONLiteral msg = new_private_msg(noid, op);
		msg.addParameter("text", text);
		msg.finish();
		to.send(msg);
	}

	/**
	 * Send a single-string private message to a specified user-connection.
	 * 
	 * @param from
	 *            The user/connection that instigated this action. Will NOT get
	 *            a copy of the message.
	 * @param noid
	 *            The object that is acting.
	 * @param to
	 *            The user/connection that is the recipient of this private
	 *            message.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_private_msg)
	 * @param attribute
	 *            Attribute to add
	 * @param value
	 *            String to add
	 */
	public void send_private_msg(User from, int noid, User to, String op, String attribute, String value) {
		JSONLiteral msg = new_private_msg(noid, op);
		msg.addParameter(attribute, value);
		msg.finish();
		to.send(msg);
	}

	/**
	 * Send a single-byte private message to a specified user-connection.
	 * 
	 * @param from
	 *            The user/connection that instigated this action. Will NOT get
	 *            a copy of the message.
	 * @param noid
	 *            The object that is acting.
	 * @param to
	 *            The user/connection that is the recipient of this private
	 *            message.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_private_msg)
	 * @param attribute
	 *            Attribute to add
	 * @param value
	 *            Value to add
	 */
	public void send_private_msg(User from, int noid, User to, String op, String attribute, int value) {
		JSONLiteral msg = new_private_msg(noid, op);
		msg.addParameter(attribute, value);
		msg.finish();
		to.send(msg);
	}

	/**
	 * Send a private message with additional parameters to a specified
	 * user-connection.
	 * 
	 * @param from
	 *            The user/connection that instigated this action. Will NOT get
	 *            a copy of the message.
	 * @param noid
	 *            The object that is acting.
	 * @param to
	 *            The user/connection that is the recipient of this private
	 *            message.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_private_msg)
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 * @param a3
	 *            Third attribute to add
	 * @param v3
	 *            Third value to add
	 * @param a4
	 *            Fourth attribute to add
	 * @param v4
	 *            Fourth value to add
	 */
	public void send_private_msg(User from, int noid, User to, String op, String a1, int v1, String a2, int v2,
			String a3, int v3, String a4, int v4) {
		JSONLiteral msg = new_private_msg(noid, op);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.addParameter(a3, v3);
		msg.addParameter(a4, v4);
		msg.finish();
		to.send(msg);
	}

	/**
	 * Send a private message with additional parameters to a specified
	 * user-connection.
	 * 
	 * @param from
	 *            The user/connection that instigated this action. Will NOT get
	 *            a copy of the message.
	 * @param noid
	 *            The object that is acting.
	 * @param to
	 *            The user/connection that is the recipient of this private
	 *            message.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_private_msg)
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 * @param a3
	 *            Third attribute to add
	 * @param v3
	 *            Third value to add
	 */
	public void send_private_msg(User from, int noid, User to, String op, String a1, int v1, String a2, int v2,
			String a3, int v3) {
		JSONLiteral msg = new_private_msg(noid, op);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.addParameter(a3, v3);
		msg.finish();
		to.send(msg);
	}

	/**
	 * Send a private message with additional parameters to a specified
	 * user-connection.
	 * 
	 * @param from
	 *            The user/connection that instigated this action. Will NOT get
	 *            a copy of the message.
	 * @param noid
	 *            The object that is acting.
	 * @param to
	 *            The user/connection that is the recipient of this private
	 *            message.
	 * @param op
	 *            The STRING name of the ASYNCRONOUS request.
	 *            (See::new_private_msg)
	 * @param a1
	 *            First attribute to add
	 * @param v1
	 *            First value to add
	 * @param a2
	 *            Second attribute to add
	 * @param v2
	 *            Second value to add
	 */
	public void send_private_msg(User from, int noid, User to, String op, String a1, int v1, String a2, int v2) {
		JSONLiteral msg = new_private_msg(noid, op);
		msg.addParameter(a1, v1);
		msg.addParameter(a2, v2);
		msg.finish();
		to.send(msg);
	}

	/**
	 * Clear a bit in an integer.
	 * 
	 * @param val
	 *            starting value
	 * @param bitpos
	 *            1-based bit position (right to left) to clear
	 * @return the starting value with the bit cleared.
	 */
	public int clear_bit(int val, int bitpos) {
		return val & ~(1 << (bitpos - 1));
	}

	/**
	 * Set a bit in an integer.
	 * 
	 * @param val
	 *            starting value
	 * @param bitpos
	 *            1-based bit position (right to left) to set
	 * @return the starting value with the bit set.
	 */
	public int set_bit(int val, int bitpos) {
		return val | (1 << (bitpos - 1));
	}

	/**
	 * Test to see if a specific bit is set.
	 * 
	 * @param val
	 *            value to search
	 * @param bitpos
	 *            1-based bit position (right to left) to test
	 * @return true if bit is set
	 */
	public boolean test_bit(int val, int bitpos) {
		return val == set_bit(val, bitpos);
	}

	// TO DO: Does the outermost container need to be checkpointed?

	/**
	 * Write the object to the Elko Habitat Database.
	 * 
	 * @param mod
	 *            The Habitat Mod to checkpoint.
	 */
	public void checkpoint_object(HabitatMod mod) {
		if (mod.gen_flags[MODIFIED]) {
			BasicObject object = mod.object();
			object.markAsChanged();
			object.checkpoint();
			mod.gen_flags[MODIFIED] = false;
		}
	}

	/**
	 * Deletes an object from the Elko Habitat Database.
	 *
	 * @param mod
	 *            The Habitat Mod to delete.
	 */
	public void destroy_object(HabitatMod mod) {
		Item item = (Item) mod.object();
		item.delete();
	}

	/**
	 * Is the the mod a Seating Class, requiring special handling?
	 * See org.neohabitat.Seating
	 * 
	 * @param mod The mod being tested
	 * @return true if seating.
	 */
	public boolean isSeating(HabitatMod mod) {
		return (mod.HabitatClass() == CLASS_COUCH ||
				mod.HabitatClass() == CLASS_CHAIR ||
				mod.HabitatClass() == CLASS_CHAIR);
	}  

	/**
	 * Is this mod a Seating Class, requiring special handling?
	 * See org.neohabitat.Seating
	 * 
	 * @return true if seating.
	 */    
	public boolean isSeating() {
		return isSeating(this);
	}

	/**
	 * Originally coded as lights_on in helpers.pl1, this method ensures
	 * that necessary side effects are applied whenever an Avatar is built.
	 * 
	 * @param who
	 * 			  The avatar upon which to perform in-hands side effects.
	 */
	public void in_hands_side_effects(Avatar who) {
		if (who.contents(HANDS) != null) {
			HabitatMod inHands = who.contents(HANDS);
			if (inHands.HabitatClass() == CLASS_FLASHLIGHT) {
				Flashlight flashlight = (Flashlight) inHands;
				Region curRegion = current_region();
				if (flashlight.on == TRUE) {
					curRegion.lighting += 1;
					send_broadcast_msg(THE_REGION, "CHANGELIGHT_$", "SUCCESS", 1);
				}
			} else if (inHands.HabitatClass() == CLASS_COMPASS) {
				Compass compass = (Compass) inHands;
				compass.gr_state = current_region().orientation;
				compass.gen_flags[MODIFIED] = true;
			}
		}
	}

	/**
	 * Spawn a Habitat Object out of thin air.
	 * 
	 * @param name		The name to give the object.
	 * @param mod		The Habitat Type/Elko Mod, well formed and ready to attach.
	 * @param container The container that will hold the object when it arrives. null == region/context.
	 * @return
	 */

	public Item create_object(String name, HabitatMod mod, Container container) {
		Item item = null;
		if (container != null) {
			item = container.object().createItem(name, true, true);
		} else {
			item = context().createItem(name, true, true);
		}
		if (item != null) {
			mod.attachTo(item);
			mod.objectIsComplete();
			item.checkpoint();
		}
		return item;
	}
}
