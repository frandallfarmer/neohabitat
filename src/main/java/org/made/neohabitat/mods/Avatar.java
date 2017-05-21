package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.*;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.User;
import org.elkoserver.server.context.UserMod;
import org.elkoserver.util.ArgRunnable;
import org.made.neohabitat.*;

/**
 * The Avatar Mod (attached to an Elko User.)
 * 
 * This holds both the Habitat User state, and the Avatar state and behaviors,
 * which include action on the User's Avatar, and when interacting with other
 * User's Avatars.
 * 
 * @author randy
 *
 */

public class Avatar extends Container implements UserMod {

	public static final int SIT_GROUND  = 132;
	public static final int SIT_CHAIR   = 133;
	public static final int SIT_FRONT   = 157;
	public static final int STAND_FRONT = 146;
	public static final int STAND_LEFT  = 251;
	public static final int STAND_RIGHT = 252;
	public static final int STAND       = 129;
	public static final int FACE_FRONT  = 146;
	public static final int FACE_BACK   = 143;
	public static final int FACE_LEFT   = 254;
	public static final int FACE_RIGHT  = 255;
	public static final int GENDER_BIT  = 8;
	public static final int XRIGHT      = 148;
	public static final int XLEFT       = 12;
	public static final int YUP         = 159;
	public static final int YDOWN       = 129;


	public static final int	STAND_UP	= 0;
	public static final int	SIT_DOWN	= 1;

	public static final int    XMAX        = 144;
	public static final double XMAXFLOAT   = 144.0;

	public static final int DOOR_OFFSET = 12;
	public static final int BUILDING_OFFSET = 28;

	public static final String DEFAULT_TURF = "context-test";

	public static final String MAIL_ARRIVED_MSG = "* You have MAIL in your pocket. *";

	public int HabitatClass() {
		return CLASS_AVATAR;
	}

	public String HabitatModName() {
		return "Avatar";
	}

	public int capacity() {
		return AVATAR_CAPACITY;
	}

	public int pc_state_bytes() {
		return 6;
	};

	public boolean known() {
		return true;
	}

	public boolean opaque_container() {
		return false;						// TODO This should be conditionally 'true' depending on the content's slot. FRF
	}

	public boolean changeable() {
		return true;
	}

	public boolean filler() {
		return false;
	}

	/**
	 * Static constant CONNECTION_TYPE indicates the kind of client connected
	 * for this session
	 */
	protected static int ConnectionType = CONNECTION_JSON; /*
	 * Soon to default to
	 * CONNECTION_HABITAT
	 */

	/**
	 * Set the ConnectionType for this user.
	 * 
	 * @param type
	 *            CONNECTION_JSON or CONNECTION_HABITAT
	 */
	public static void setConnectionType(int type) {
		ConnectionType = type;
	}

	/**
	 * Get the ConnectionType for this user.
	 * 
	 * @return CONNECTION_JSON or CONNECTION_HABITAT
	 */
	public static int getConnectionType() {
		return ConnectionType;
	}

	/** The body type for the avatar TODO IGNORED FOR NOW */
	protected String  bodyType        = "male";
	/** A collection of server-side Avatar status flags */
	public boolean    nitty_bits[]    = new boolean[32];
	/** Cache of avatar.contents(HEAD).style to restore after a curse. */
	public int        true_head_style = 0;
	/** Non-zero when the Avatar-User is cursed. */
	public int        curse_type      = CURSE_NONE;
	/** Non-zero when the Avatar-User is stunned. */
	public int        stun_count      = 0;
	/** The number of tokens this avatar has in the bank (not cash-on-hand.) */
	public int        bankBalance     = 0;
	/** The current avatar pose */
	public int        activity        = STAND_FRONT;
	/** TODO Doc */
	public int        action          = STAND_FRONT;
	/** Hit Points. Reaching 0 == death */
	public int        health          = MAX_HEALTH;
	/** TODO Doc */
	public int        restrainer      = 0;
	/** Avatar customization TODO Doc */
	public int        custom[]        = new int[2];
	/** TODO Doc */
	public int        dest_x          = 0;
	public int        dest_y          = 0;

	/* FRF Moved Hall of Records per-user stats into the user-avatar for easy access/storage */
	protected int	  stats[]			= null;


	/** This is workaround - replacing the containership-based original model for seating used by the original Habtiat */
	public int		  sittingIn			= 0;
	public int		  sittingSlot		= 0;
	public int		  sittingAction		= AV_ACT_sit_front;

	public String     turf            = "context-test";

	private String     from_region		= "";
	public  String     to_region		= "";	   
	private int        from_orientation	= 0;
	private int        from_direction	= 0;
	private int		   to_x				= 0;
	private int		   to_y				= 0;
	private int        transition_type	= WALK_ENTRY;

	private MailQueue  mail_queue = null;

	/**
	 * Target NOID and magic item saved between events, such as for the GOD TOOL
	 * (see Magical.java). This is a transient value and not persisted.
	 */
	public HabitatMod savedTarget		= null;
	public Magical    savedMagical		= null;
	public String	  ESPTargetName		= null;

	public int		  lastConnectedDay	= 0;
	public int		  lastConnectedTime = 0;

	/** Used to indicate that this avatar-instance should be treated as the "first" instantiation of the session */
	public boolean	  firstConnection	= false;


	/** Flag to indicate this User/Connection/Avatar is in Ghost state: Observer only **/
	public boolean	  amAGhost			= false;

	@JSONMethod({ "style", "x", "y", "orientation", "gr_state", "nitty_bits", "bodyType", "stun_count", "bankBalance",
		"activity", "action", "health", "restrainer", "transition_type", "from_orientation", "from_direction", "from_region", "to_region",
		"to_x", "to_y", "turf", "custom", "lastConnectedDay", "lastConnectedTime", "amAGhost", "?stats" })
	public Avatar(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
			OptInteger nitty_bits, OptString bodyType, OptInteger stun_count, OptInteger bankBalance,
			OptInteger activity, OptInteger action, OptInteger health, OptInteger restrainer, 
			OptInteger transition_type, OptInteger from_orientation, OptInteger from_direction,
			OptString from_region, OptString to_region, OptInteger to_x, OptInteger to_y,
			OptString turf, int[] custom, OptInteger lastConnectedDay, OptInteger lastConnectedTime,
			OptBoolean amAGhost, int[] stats) {
		super(style, x, y, orientation, gr_state, new OptBoolean(false));
		if (null == stats) {
			stats = new int[HS$MAX];
			stats[HS$wealth]		= bankBalance.value(0);
			stats[HS$max_wealth]	= bankBalance.value(0);
		}
		setAvatarState(nitty_bits.present() ? unpackBits(nitty_bits.value()) :  new boolean[32],
				bodyType.value("male"),
				stun_count.value(0),
				bankBalance.value(0),
				activity.value(STAND_FRONT),
				action.value(this.activity),
				health.value(MAX_HEALTH),
				restrainer.value(0),
				transition_type.value(WALK_ENTRY),
				from_orientation.value(0),
				from_direction.value(0),
				from_region.value(""),
				to_region.value(""),
				to_x.value(0),
				to_y.value(0),
				turf.value(DEFAULT_TURF),
				custom,
				lastConnectedDay.value(0),
				lastConnectedTime.value(0),
				amAGhost.value(false),
				stats);
	}

	public Avatar(int style, int x, int y, int orientation, int gr_state, boolean[] nitty_bits, String bodyType,
			int stun_count, int bankBalance, int activity, int action, int health, int restrainer, int transition_type,
			int from_orientation, int from_direction, String from_region, String to_region, int to_x, int to_y,
			String turf, int[] custom, int lastConnectedDay, int lastConnectedTime, boolean amAGhost, int[] stats) {
		super(style, x, y, orientation, gr_state, false);
		setAvatarState(nitty_bits, bodyType, stun_count, bankBalance, activity, action, health, restrainer, transition_type,
				from_orientation, from_direction, from_region, to_region, to_x, to_y, turf, custom, lastConnectedDay, lastConnectedTime, amAGhost, stats);
	}

	protected void setAvatarState(boolean[] nitty_bits, String bodyType,
			int stun_count, int bankBalance, int activity, int action, int health, int restrainer, int transition_type,
			int from_orientation, int from_direction, String from_region, String to_region, int to_x, int to_y,
			String turf, int[] custom, int lastConnectedDay, int lastConnectedTime, boolean amAGhost, int[] stats) {
		this.nitty_bits = nitty_bits;
		this.bodyType = bodyType;
		this.stun_count = stun_count;
		this.bankBalance = bankBalance;
		this.activity = activity;
		this.action = action;
		this.health = health;
		this.restrainer = restrainer;
		this.transition_type = transition_type;
		this.from_orientation = from_orientation;
		this.from_direction = from_direction;
		this.from_region = from_region;
		this.to_region = to_region;
		this.to_x = to_x;
		this.to_y = to_y;
		this.turf = turf;
		this.custom = custom;
		this.lastConnectedDay = lastConnectedDay;
		this.lastConnectedTime = lastConnectedTime;
		this.amAGhost = amAGhost;
		this.stats = stats;
	}


	@Override
	public JSONLiteral encode(EncodeControl control) {
		JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
		if (packBits(nitty_bits) != 0) {
			result.addParameter("nitty_bits", packBits(nitty_bits));
		}
		result.addParameter("bodyType",		bodyType);
		result.addParameter("stun_count",	stun_count);
		result.addParameter("bankBalance",	bankBalance);
		result.addParameter("activity",		activity);
		result.addParameter("action",		action);
		result.addParameter("health",		health);
		result.addParameter("restrainer",	restrainer);
		result.addParameter("custom", 		custom);
		result.addParameter("amAGhost",		amAGhost);
		if (result.control().toRepository()) {
			result.addParameter("transition_type",	transition_type);
			result.addParameter("from_orientation", from_orientation);
			result.addParameter("from_direction",   from_direction);
			result.addParameter("from_region",      from_region);
			result.addParameter("to_region",      	to_region);
			result.addParameter("to_x",		      	to_x);
			result.addParameter("to_y",		      	to_y);
			result.addParameter("turf", 			turf);
			result.addParameter("lastConnectedDay", lastConnectedDay);
			result.addParameter("lastConnectedTime",lastConnectedTime);
			result.addParameter("stats", 			stats);
		}
		if (result.control().toClient() && sittingIn != 0) {
			result.addParameter("sittingIn",		sittingIn);
			result.addParameter("sittingSlot",		sittingSlot);
			result.addParameter("sittingAction",	sittingAction);
			// Having a non-persistent client-only variables is unusual.
			// This is a work around because the client expects a seated avatar to be "contained" by the seat
			// That's terrible, so the workaround is to say that seating is live-session-only.
			// This prevents a LOT of problems since objects can change state/existence between sessions.
		}
		result.finish();
		return result;
	}

	public String mailQueueRef() {
		return String.format("mail-%s", object().name().toLowerCase());
	}

	/** Avatars need to be repositioned upon arrival in a region based on the method used to arrive. */
	public void objectIsComplete() {
		/** Was pl1 region_entry_daemon: */

		// If traveling as a ghost, don't do ANYTHING fancy 
		if (amAGhost) {
			return;
		}

		Region.addToNoids(this);
		note_object_creation(this);

		// If walking in, set the new (x,y) based on the old (x,y), the entry
		// direction, the rotation of the region transition, the horizon of the
		// new region, and so on 
		int new_x           = x;
		int new_y           = y & ~FOREGROUND_BIT;
		int new_activity    = FACE_LEFT;
		int rotation        = 0;
		int arrival_face    = 0;

		trace_msg("Avatar %s called objectIsComplete, transition_type=%d", obj_id(), transition_type);
		if (transition_type == WALK_ENTRY) {
			y &= ~FOREGROUND_BIT;
			rotation = (from_orientation - current_region().orientation + 4) % 4;
			arrival_face = (from_direction + rotation + 2) % 4;
			if (arrival_face == 0) {
				new_x = XLEFT;
				new_activity = FACE_RIGHT;
				if (rotation == 0)
					new_y = y;
				else if (rotation == 1)
					new_y = x_scale(x_invert(x));
				else if (rotation == 2)
					new_y = y_invert(y);
				else
					new_y = x_scale(x);
			} else if (arrival_face == 1) {
				new_y = current_region().depth;
				new_activity = FACE_FRONT;
				if (rotation == 0)
					new_x = x;
				else if (rotation == 1)
					new_x = y_scale(y);
				else if (rotation == 2)
					new_x = x_invert(x);
				else
					new_x = y_scale(y_invert(y));
				HabitatMod noids[] = current_region().noids;
				for (int i=0; i < noids.length; i++) {
					HabitatMod obj = noids[i];
					if (noids[i] != null) {
						if (obj.HabitatClass() == CLASS_DOOR) {
							Door door = (Door) obj;
							if (door.connection.equals(from_region) || door.connection.isEmpty()) {
								new_y = obj.y;
								new_x = obj.x + DOOR_OFFSET;
								if (test_bit(obj.orientation, 1))
									new_x = new_x - 16;
							}                    
						} else if (obj.HabitatClass() == CLASS_BUILDING) {
							Building bldg = (Building) obj;
							if (bldg.connection == from_region || bldg.connection.isEmpty()) {
								new_x = obj.x + BUILDING_OFFSET;
							}
						}
					}
				}
			} else if (arrival_face == 2) {
				new_x = XRIGHT;
				new_activity = FACE_LEFT;
				if (rotation == 0)
					new_y = y;
				else if (rotation == 1)
					new_y = x_scale(x_invert(x));
				else if (rotation == 2)
					new_y = y_invert(y);
				else
					new_y = x_scale(x);
			} else {
				new_y = YDOWN;
				new_activity = FACE_BACK;
				if (rotation == 0)
					new_x = x;
				else if (rotation == 1)
					new_x = y_scale(y);
				else if (rotation == 2)
					new_x = x_invert(x);
				else
					new_x = y_scale(y_invert(y));
			}
			x = new_x & 0b11111100;
			y = Math.min((new_y & ~FOREGROUND_BIT), current_region().depth) | FOREGROUND_BIT;
			activity = new_activity;
		} else if (transition_type == TELEPORT_ENTRY) {
			if ( 0 != to_y) {
				x = to_x;
				y = to_y;
			} else {
				x = 8;
				y = 130;
				HabitatMod noids[] = current_region().noids;
				for (int i=0; i < noids.length; i++) {
					HabitatMod obj = noids[i];
					if (noids[i] != null) {
						if (obj.HabitatClass() == CLASS_TELEPORT) {
							x = obj.x + 8;
							y = obj.y + 3;
						}
						if (obj.HabitatClass() == CLASS_ELEVATOR) {
							x = obj.x + 12;
							y = obj.y -  5;
						}
					}
				}
			}
			// If entering via teleport, make sure we're in foreground
			y |= FOREGROUND_BIT;
		} else {
			trace_msg("ENTRY ERROR: Unknown transition type: " + transition_type);
		}
	}


	private int x_invert(int x) {
		return (XMAX - x);         
	}


	private int y_invert(int y) {
		return(current_region().depth - y);
	}

	private int x_scale(int x) {
		double scale = current_region().depth / XMAXFLOAT;
		return ((int) scale);
	}

	private int y_scale(int y) {
		double scale = XMAXFLOAT / current_region().depth;
		return ((int) scale);
	}

	/**
	 * Verb (Specific): TODO Grabbing from another avatar.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void GRAB(User from) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}
		unsupported_reply(from, noid, "Avatar.GRAB not implemented yet.");
	}

	/**
	 * Verb (Specific): TODO Handing in-hand item to another avatar.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void HAND(User from) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}
		unsupported_reply(from, noid, "Avatar.HAND not implemented yet.");
	}

	/**
	 * Verb (Specific): TODO Change this avatar's posture.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod({ "pose" })
	public void POSTURE(User from, OptInteger pose) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}
		int new_posture = pose.value(STAND_FRONT);
		// if (selfptr == avatarptr) { TODO Bullet Proofing Needed
		if (0 <= new_posture && new_posture < 256) {
			if (new_posture == SIT_GROUND || new_posture == SIT_CHAIR || new_posture == SIT_FRONT
					|| new_posture == STAND || new_posture == STAND_FRONT || new_posture == STAND_LEFT
					|| new_posture == STAND_RIGHT || new_posture == FACE_LEFT || new_posture == FACE_RIGHT) {
				this.activity = new_posture;
			}
			if (new_posture != COLOR_POSTURE) {
				send_neighbor_msg(from, noid, "POSTURE$", "new_posture", new_posture);
			}
			if (new_posture < STAND_LEFT || new_posture == COLOR_POSTURE) {
				send_reply_success(from);
			}
		}
		// }
	}

	/**
	 * Verb (Specific)
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param esp
	 *            Byte flag indicating that ESP message mode is active on the
	 *            client (NOTE: ESP is implemented in the Bridge.)
	 * @param text
	 *            The string to speak...
	 */
	@JSONMethod({ "esp", "text" })
	public void SPEAK(User from, OptInteger esp, OptString text) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}

		int		in_esp	= esp.value(TRUE);
		String	msg		= text.value("(missing text)");

		if (FALSE == in_esp) {
			if (msg.toLowerCase().startsWith("//neohabitat")) {
				if (Region.NEOHABITAT_FEATURES) {
					Region.tellEveryone("Original Habitat interface enabled globally.");
				} else {
					Region.tellEveryone("Upgraded NeoHabitat interface enabled globally.");
				}
				Region.NEOHABITAT_FEATURES = !Region.NEOHABITAT_FEATURES;
			} else if (msg.toLowerCase().startsWith("to:")) {
				String name = msg.substring(3).trim();
				User   user = Region.getUserByName(name);
				if (user != null && user != from) {
					ESPTargetName	= name;
					in_esp			= TRUE;
					if (Region.NEOHABITAT_FEATURES) {
						object_say(from, UPGRADE_PREFIX + "Tranmitting thoughts to " + user.name() + "...");
					}
				} else {
					send_private_msg(from, this.noid, from, "SPEAK$", "Cannot contact " + name + ".");
				}
			} else {
				send_broadcast_msg(this.noid, "SPEAK$", msg);
				inc_record(HS$talkcount);
			}
		}
		send_reply_msg(from, this.noid, "esp", in_esp);
	}

	/**
	 * Verb (Specific): TODO Walk across the region.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod({ "x", "y", "how" })
	public void WALK(User from, OptInteger x, OptInteger y, OptInteger how) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}
		int destination_x = x.value(80);
		int destination_y = y.value(10) | FOREGROUND_BIT;
		int walk_how = how.value(0);

		if (stun_count > 0) {
			stun_count -= 1;
			send_reply_msg(from, this.noid, "x", this.x, "y", this.y, "how", walk_how);
			if (stun_count >= 2) {
				send_private_msg(from, this.noid, from, "SPEAK$", "I can't move.  I am stunned.");
			} else if (stun_count == 1) {
				send_private_msg(from, this.noid, from, "SPEAK$", "I am still stunned.");
			} else {
				send_private_msg(from, this.noid, from, "SPEAK$", "The stun effect is wearing off now.");
			}
			checkpoint_object(this);
			return;
		}

		if ((destination_y & ~FOREGROUND_BIT) > current_region().depth) {
			destination_y = current_region().depth | FOREGROUND_BIT;
		}

		send_neighbor_msg(from, this.noid, "WALK$", "x", destination_x, "y", destination_y, "how", walk_how);
		send_reply_msg(from, this.noid, "x", destination_x, "y", destination_y, "how", walk_how);

		this.x = destination_x;
		this.y = destination_y;
		checkpoint_object(this);
	}

	/**
	 * Verb (Specific): TODO Leave the region for another region.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod({ "direction", "passage_id" })
	public void NEWREGION(User from, OptInteger direction, OptInteger passage_id) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}

		avatar_NEWREGION(from, direction.value(1), passage_id.value(0));
	}

	/**
	 * Verb (Specific): TODO Turn to/from being a ghost.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void DISCORPORATE(User from) {
		//		if (amAGhost)
		//			trace_msg("Invalid request: Avatar.DISCORPORATE called with avatar.amAGhost == true.");
		//		else
		if (holding_class(CLASS_MAGIC_LAMP) && heldObject().gr_state == MAGIC_LAMP_GENIE) 
			object_say(from, "You can't turn into a ghost while you are holding the Genie.");
		else 
			if (holding_restricted_object())
				object_say(from, "You can't turn into a ghost while you are holding that.");
			else {
				switch_to_ghost(from);
				return;
			}
		send_reply_error(from);
	}

	public static final int COPOREAL_FAIL			= 0;
	public static final int COPOREAL_SUCCESS		= 1;
	public static final int COPOREAL_ALREADY_THERE	= 2;
	public static final int COPOREAL_LAST_GHOST		= 3;

	public void switch_to_ghost(User from) {
		if (sittingIn != 0) {
			send_reply_error(from);
			return;
		}
		/* First, transform to a ghost (which will create one if needed) */
		Ghost ghost = current_region().getGhost();
		ghost.total_ghosts++;
		amAGhost = true;
		send_reply_msg(from, noid,
				"success", COPOREAL_ALREADY_THERE,
				"newNoid", GHOST_NOID,
				"balance", bankBalance);
		send_neighbor_msg(from, THE_REGION, "GOAWAY_$", "target", noid); // Tell the neighbors who vanished...		
		x = SAFE_X;			// Prepare for when the avatar comes back. Or reload from DB
		y = SAFE_Y;
		activity = STAND;
		gen_flags[MODIFIED] = true;
		current_region().lights_off(this);
		/* Clean up the region, recovering scarce c64 resources and noids */
		for (int i = 0; i < capacity(); i++) {
			HabitatMod obj = contents(i);
			if (obj != null) {
				note_object_deletion(obj);
				Region.removeFromObjList(obj);
			}
		}
		note_object_deletion(this);
		Region.removeFromObjList(this);
	}

	public void switch_to_avatar(User from) {
		Region region 	= current_region();
		Ghost  ghost	= region.getGhost();
		int    result	= COPOREAL_FAIL;
		if (region.isRoomForMyAvatar(from)) {
			for (int i = 0; i < capacity(); i++) {
				HabitatMod obj = contents(i);
				if (obj != null) {
					Region.addToNoids(obj);
					note_object_creation(obj);
				}
			}
			Region.addToNoids(this);
			note_object_creation(this);
			result = COPOREAL_SUCCESS;
			ghost.total_ghosts--;
			amAGhost = false;
			if (ghost.total_ghosts == 0) {
				result = COPOREAL_LAST_GHOST;
				region.destroyGhost(from);
			}
		}
		JSONLiteral msg = new_reply_msg(GHOST_NOID);
		msg.addParameter("success", result);
		msg.addParameter("newNoid", noid);
		msg.addParameter("balance", bankBalance);
		if (result == COPOREAL_FAIL) {
			from.send(msg);
		} else {
			x = SAFE_X;
			y = SAFE_Y;
			gen_flags[MODIFIED] = true;
			//			msg.addParameter("body", object().encode(EncodeControl.forClient));
			msg.addParameter("body", 0);
			from.send(msg);
			//			announce_object_to_neighbors(from, object(), current_region());
			fakeMakeMessage(object(), current_region());
			current_region().lights_on(this);
			for (int i = capacity() - 1; i >= 0; i--) {			// TODO - encode the avatar and contents together instead of this HACK! FRF
				HabitatMod obj = contents(i);
				if (obj != null)
					fakeMakeMessage(obj.object(), this);
			}
			JSONLiteral ready = new JSONLiteral(null, EncodeControl.forClient);
			ready.addParameter("to", object().ref());
			ready.addParameter("op", "ready");
			ready.finish();
			context().send(ready);

		}
	}

	/**
	 * Verb (Specific): Send a point-to-point message to another user/avatar.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param esp
	 *            Byte flag indicating that ESP message mode is active on the
	 *            client (NOTE: ESP is implemented in the Bridge.)
	 * @param text
	 *            The string to speak...
	 */
	@JSONMethod({ "esp", "text" })
	public void ESP(User from, OptInteger esp, OptString text) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}

		int		in_esp	= esp.value(FALSE);
		String	msg		= text.value("");

		if (TRUE == in_esp) {
			msg = msg.startsWith("ESP:") ? msg.substring(4) : msg;
			if (msg.isEmpty()) {			// Exit ESP
				in_esp			= FALSE;
				ESPTargetName	= null;
				if (Region.NEOHABITAT_FEATURES) {
					object_say(from, UPGRADE_PREFIX + "ESP connection ended.");
				}
			} else {
				User to = Region.getUserByName(ESPTargetName);
				if (to != null) {
					object_say(to, "ESP from " + object().name() + ": ");
					if (msg.length() < 4) {
						msg = " " + msg + " ";
					}
					object_say(to, msg);
					inc_record(HS$esp_send_count);
					Avatar.inc_record(to, HS$esp_recv_count);
					if (Region.NEOHABITAT_FEATURES) {
						object_say(from, UPGRADE_PREFIX + "ESP:" + msg);
					}
				} else {
					object_say(from, "Cannot contact " + ESPTargetName + ".");
					in_esp			= FALSE;
					ESPTargetName	= null;
				}
			}
		}
		send_reply_msg(from, this.noid, "esp", in_esp);      
	}

	/**
	 * Verb (Specific): TODO Sit down. [Stand up?]
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod({"up_or_down", "seat_id"})
	public void SITORSTAND(User from, int up_or_down, int seat_id) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}

		//    	if (up_or_down <= SIT_DOWN) {		// TOFO FRF This is always for now until we can work with Elko for a fix.
		//            unsupported_reply(from, noid, "This furniture has a sign that reads 'Do not sit here. Under repair'.");
		//    		return;
		//    	}	

		/** Historically was avatar_SITORSTAND in original pl1 */
		Region		region	= current_region();
		Seating		seat	= (Seating) region.noids[seat_id];
		int			slot	= -1;
		if (seat != null) {
			if (isSeating(seat) && !seat.gen_flags[RESTRICTED]) {
				if (up_or_down == STAND_UP) {
					if (sittingIn == seat_id) {
						slot = sittingSlot;
						if (seat.sitters[slot] != noid) {
							send_reply_msg(from, noid, "err", FALSE, "slot", 0);
							return;
						}
						activity 			= STAND;
						sittingIn			= 0;
						seat.sitters[slot]	= 0;
						gen_flags[MODIFIED] = true;    					
						checkpoint_object(this);
						send_reply_msg(from, noid, "err", TRUE, "slot", 0);
						send_neighbor_msg(from, noid, "SIT$", "up_or_down", STAND_UP, "cont", seat_id, "slot", 0);
						return;
					}
				} else {
					Container cont = (Container) seat;
					for (slot = 0; slot < cont.capacity(); slot++) {
						if (cont.contents(slot) == null && seat.sitters[slot] == 0) {
							if (sittingIn != 0) {
								send_reply_msg(from, 0, "err", FALSE, "slot", 0);
								return;
							}
							seat.sitters[slot]	= noid;
							sittingIn		= seat.noid;
							sittingSlot		= slot;
							sittingAction	= ((seat.style & 1) == 1) ? AV_ACT_sit_chair : AV_ACT_sit_front;
							send_reply_msg(from, noid, "err", TRUE, "slot", slot);
							send_neighbor_msg(from, noid, "SIT$", "up_or_down", SIT_DOWN, "cont", seat_id, "slot", slot);
							return;
						}
					}
				}
			}
		}     
		send_reply_msg(from, noid, "err", FALSE, "slot", 0);
	}




	/**
	 * Verb (Specific): TODO Touch another avatar.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void TOUCH(User from) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}

		unsupported_reply(from, noid, "Avatar.TOUCH not implemented yet.");
	}

	/**
	 * Verb (Specific): Userlist (same as F3 on c64 client)
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void USERLIST(User from) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}

		sayUserList(from);
	} 

	public void sayUserList(User from) {
		String balloon = "";				// TODO Limit to last dozen.
		for (String name: Region.NameToUser.keySet()) {
			balloon += (Region.NameToUser.get(name).name() + "            ").substring(0, 12);
			if (balloon.length() > 35) {
				object_say(from, balloon);
				balloon = "";
			}
		}
		if (!balloon.isEmpty()) {
			object_say(from, (balloon + "                        ").substring(0,36));
		}
		send_reply_success(from);
	}

	/**
	 * Verb (Specific): TODO Deal with FN Key presses.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod({ "key", "target" })
	public void FNKEY(User from, OptInteger key, OptInteger target) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}

		switch (key.value(0)) {
		case 16: // F8
			object_say(from, UPGRADE_PREFIX + "       You are connected to          ");
			object_say(from, "   The Neoclassical Habitat Server    ");
			//                object_say(from, "                                     ".substring(BuildVersion.version.length())
			//                       + BuildVersion.version + " ");
			object_say(from, "    The MADE, The Museum of Arts &       Digital Entertainment, Oakland CA");
			object_say(from, "                                      ");
			object_say(from, "Open source - Join us! NeoHabitat.org ");
			object_say(from, NeoHabitat.GetBuildVersion());
			send_reply_success(from);
			break;
		case 11: // F3 & F4 (Users list)
			sayUserList(from);
			break;
		case 13: // F5 & F6 (Change Skin Color)
			object_say(from, String.format("Light level: " + current_region().lighting + " Current heap: %d", current_region().space_usage));
			send_reply_success(from);
			break;
		default:
			unsupported_reply(from, noid, "Avatar.FNKEY not implemented yet.");

		}
	}

	/**
	 * Verb (Avatar): Reply with the HELP for this avatar.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	@JSONMethod
	public void HELP(User from) {
		if (amAGhost) { 
			illegal_request(from, "Avatar commands not allowed when a ghost.");
			return;
		}

		avatar_IDENTIFY(from);
	}

	/**
	 * Alternate interface to avatar_IDENTIFY, passing this.noid as the missing
	 * second argument.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 */
	public void avatar_IDENTIFY(User from) {
		avatar_IDENTIFY(from, this.noid);
	}

	private boolean alreadyShown = false;

	private String stripContextDash(String s) {
		s = (s.indexOf("context-") == 0) ? s.substring(8) : s;
		return s.replace('_',  '{');
	}

	public void showDebugInfo(User from) {
		if (!alreadyShown) {
			if (nitty_bits[GOD_FLAG] &&
					contents(HANDS) instanceof Magical  &&
					Magical.isGodTool((Magical) contents(HANDS))) {
				Region region = current_region();
				String msg = stripContextDash(context().ref()) + "(W" + Compass.DIRECTION_ARROWS[region.orientation]+") ";
				int arrow = (region.orientation + 3) % 4;
				if (!region.neighbors[MAP_NORTH].isEmpty()) {
					msg += "N" + Compass.DIRECTION_ARROWS[arrow];
					msg += stripContextDash(region.neighbors[MAP_NORTH]) + " ";
				}
				arrow = ++arrow % 4;
				if (!region.neighbors[MAP_WEST].isEmpty()) {
					msg += "W" + Compass.DIRECTION_ARROWS[arrow];
					msg += stripContextDash(region.neighbors[MAP_WEST]) + " ";
				}
				arrow = ++arrow % 4;
				if (!region.neighbors[MAP_SOUTH].isEmpty()) {
					msg += "S" + Compass.DIRECTION_ARROWS[arrow];
					msg += stripContextDash(region.neighbors[MAP_SOUTH]) + " ";
				}
				arrow = ++arrow % 4;
				if (!region.neighbors[MAP_EAST].isEmpty()) {
					msg += "E" + Compass.DIRECTION_ARROWS[arrow];
					msg += stripContextDash(region.neighbors[MAP_EAST]) + " ";
				}
				this.object_say(from, msg);
				alreadyShown = true;
			}
		}
	}


	/**
	 * A different message is returned depending on if this avatar is the "from"
	 * user or another, the message returned will vary.
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param replyNoid
	 *            which avatar.noid is the one getting the reply.
	 */
	public void avatar_IDENTIFY(User from, int replyNoid) {
		User targetUser = (User) this.object();
		String targetName = targetUser.name();
		String avatarname = from.name();
		Avatar avatar = avatar(from);
		String result = "";

		if (avatar.noid == this.noid) {
			result = "Your name is " + avatarname + ".  You are ";
			if (avatar.stun_count > 0)
				result = result + "stunned, and you are ";
			if (avatar.health > 200)
				result = result + "in the peak of health.";
			else if (avatar.health > 150)
				result = result + "in good health.";
			else if (avatar.health > 100)
				result = result + "in fair health.";
			else if (avatar.health > 50)
				result = result + "in poor health.";
			else
				result = result + "near death.";

			if (has_turf()) {
				result = result + "  You live at " + turf_name() + ".";
			}
		} else {
			send_private_msg(from, avatar.noid, targetUser, "SPEAK$", "I am " + avatarname);
			// p_msg_s(from, avatar.noid, targetUser, SPEAK$, "I am " +
			// avatarname);
			/*
			 * OBSOLETE CODE REFACTORED An Elko User == Connection, so there is
			 * no Turned to Stone state. And since a Elko Habitat Avatar is
			 * attached 1:1 to a Elko User, this code can never be true in this
			 * server.
			 * 
			 * if (UserList(self.avatarslot)->u.online) result = "This is " +
			 * targetName; else result = "Turned to stone: " + selfname;
			 */
			result = "This is " + targetName;
		}
		send_reply_msg(from, replyNoid, "text",
				result); /* TODO is replyNoid right? */
	}

	public void avatar_NEWREGION(User from, int direction, int passage_id) {
		Region      region          = current_region();
		String      new_region      = "";
		int			entry_type		= WALK_ENTRY;
		HabitatMod  passage         = region.noids[passage_id];
		int         direction_index = (direction + region.orientation + 2) % 4;

		if (direction != AUTO_TELEPORT_DIR && passage_id != 0 &&
				passage.HabitatClass() == CLASS_DOOR || 
				passage.HabitatClass() == CLASS_BUILDING) {

			if (passage.HabitatClass() == CLASS_DOOR) {
				Door door = (Door) passage;
				if (!door.getOpenFlag(OPEN_BIT) || 
						door.gen_flags[DOOR_AVATAR_RESTRICTED_BIT]) {
					send_reply_error(from);
					return;
				} else {
					new_region = door.connection;
				}
			} else {
				new_region = ((Building) passage).connection;
			}

		}

		else {
			if (direction >= 0 && direction < 4) {
				new_region = region.neighbors[direction_index]; // East,  West, North, South
			} else {     // direction == AUTO_TELEPORT_DIR 
				new_region = to_region;
				entry_type = TELEPORT_ENTRY;
				direction  = WEST; // TODO Randy needs to revisit this little hack to prevent a loop..
			}
		}

		if (!new_region.isEmpty()) {        
			if (holding_restricted_object()) {
				heldObject().putMeBack(from, false);
			}
			if (Region.IsRoomForMyAvatarIn(new_region, from) == false) {
				object_say(from, "That region is full. Try entering as a ghost (F1).");
				send_reply_error(from); 
				return;
			}
			send_neighbor_msg(from, THE_REGION, "WAITFOR_$", "who", this.noid);
			send_reply_success(from);
			change_regions(new_region, direction, entry_type);
			return;
		}       
		object_say(from, "There is nowhere to go in that direction.");
		send_reply_error(from); 
	}

	public void change_regions(String contextRef, int direction, int type) {
		change_regions(contextRef, direction, type, 0, 0);
	}

	public void change_regions(String contextRef, int direction, int type, int x, int y) {
		Region		region		= current_region();
		User		who			= (User) this.object();

		trace_msg("Avatar %s changing regions to context=%s, direction=%d, type=%d", obj_id(),
				contextRef, direction, type);

		to_region			= contextRef;    
		to_x				= x;
		to_y				= y;
		from_region         = region.obj_id();     // Save exit information in avatar for use on arrival.
		from_orientation    = region.orientation;
		from_direction      = direction;
		transition_type     = type;
		gen_flags[MODIFIED] = true;
		checkpoint_object(this);

		if (direction == AUTO_TELEPORT_DIR) {
			send_private_msg(who, THE_REGION, who, "AUTO_TELEPORT_$", "direction", direction);
		} else {
			JSONLiteral msg = new JSONLiteral("changeContext", EncodeControl.forClient);
			msg.addParameter("context", contextRef);
			msg.addParameter("immediate", (type == TELEPORT_ENTRY && direction == EAST));
			msg.finish();
			who.send(msg);
		}
	}

	/**
	 * Drops whatever item is in the current Avatar's hands.
	 */
	public void drop_object_in_hand() {
		if (contents(HANDS) != null) {
			HabitatMod obj = contents(HANDS);
			obj.x = 8;
			obj.y = 130;
			obj.gen_flags[MODIFIED] = true;
			obj.change_containers(obj, current_region(), obj.y, true);
			// For C64-side implementation, see line 110 of actions.m.
			send_broadcast_msg(THE_REGION, "CHANGE_CONTAINERS_$",
					"object_noid", obj.noid,
					"container_noid", THE_REGION,
					"x", obj.x,
					"y", obj.y);
		}
	}

	/**
	 * Returns true if the Avatar is holding an item of the provided class.
	 *
	 * @param habitat_class The Habitat class to check against.
	 * @return true/false whether the Avatar is holding an item of the provideed class
	 */
	public boolean holding_class(int habitat_class) {
		HabitatMod obj = contents(HANDS);
		if (obj != null) {
			return obj.HabitatClass() == habitat_class;
		}
		return false;
	}

	/**
	 * Returns whether the Avatar is holding a restricted object.
	 *
	 * @return true/false whether the Avatar is holding a restricted object
	 */
	public boolean holding_restricted_object() {
		HabitatMod obj = contents(HANDS);
		if (obj != null) {
			return obj.gen_flags[RESTRICTED];
		}
		return false;
	}


	/**
	 * Set a user's record value.
	 * 
	 * @param recordID
	 * @param value
	 */
	public void set_record(int recordID, int value) {
		stats[recordID] 		= value;
		stats[HS$max_lifetime]	= Math.max(stats[HS$max_lifetime],	stats[HS$lifetime]);
		stats[HS$max_wealth]	= Math.max(stats[HS$max_wealth],	stats[HS$wealth]);
		stats[HS$max_travel]	= Math.max(stats[HS$max_travel],	stats[HS$travel]);
		gen_flags[MODIFIED] = true;
	}

	/**
	 * Returns the Elko User associated with this Avatar.
	 *
	 * @return the Elko User associated with this Avatar
     */
	public User elko_user() {
		return Region.getUserByName(object().name());
	}

	/**
	 * Sends a MAILARRIVED$ message to the User associated with this Avatar.
	 */
	public void send_mail_arrived() {
		send_mail_arrived(elko_user());
	}

	/**
	 * Sends a mail arrival message to the provided User.
	 *
	 * @param from User to send mail arrival message to.
     */
	public void send_mail_arrived(User from) {
		object_say(from, noid, MAIL_ARRIVED_MSG);
	}

	/**
	 * Get this user's value for a record.
	 * 
	 * @param recordID
	 * @return
	 */
	public int get_record(int recordID) {
		return stats[recordID];
	}

	/**
	 * Add one to a user's record value.
	 * 
	 * @param recordID
	 */
	public void inc_record(int recordID) {
		set_record(recordID, get_record(recordID) + 1);
	}

	/**
	 * Static version of set_record. Does the cast for you.
	 * 
	 * @param whom
	 * @param recordID
	 * @param value
	 */
	static public void set_record(User whom, int recordID, int value) {
		((Avatar) whom.getMod(Avatar.class)).set_record(recordID, value);
	}

	/**
	 * Static version of get_record. Does the cast for you.
	 * @param whom
	 * @param recordID
	 * @return
	 */
	static public int get_record(User whom, int recordID) {
		return(((Avatar) whom.getMod(Avatar.class)).get_record(recordID));
	}

	/**
	 * Static version of inc_record. Does the cast for you.
	 * 
	 * @param whom
	 * @param recordID
	 */
	static public void inc_record(User whom, int recordID) {
		((Avatar) whom.getMod(Avatar.class)).inc_record(recordID);
	}

	/**
	 * Returns whether this Avatar has an assigned Turf.
	 *
	 * @return boolean whether Avatar has an assigned Turf
     */
	public boolean has_turf() {
		return !turf.equals(DEFAULT_TURF);
	}

	/**
	 * Determines the name of the turf (e.g. Popustop #100) from its Elko context reference.
	 *
	 * @return Human-readable name of the Avatar's turf
     */
	public String turf_name() {
		if (!has_turf()) {
			return null;
		} else {
			String[] splitTurf = turf.split("context-")[1].split(".");
			String realm = splitTurf[0].substring(0, 1).toUpperCase() + splitTurf[0].substring(1);
			String turfId = splitTurf[1];
			return String.format("%s #%s", realm, turfId);
		}
	}

	/**
	 * Checks for new Mail and sends a MAILARRIVED$ notification to the Avatar if so.
	 */
	public void check_mail() {
		// If the Avatar has a Paper in their MAIL_SLOT, sends a Mail arrived
		// notification and performs no MailQueue operations.
		HabitatMod paperMod = contents(MAIL_SLOT);
		if (paperMod == null || !(paperMod instanceof Paper)) {
			trace_msg("Paper not in MAIL_SLOT for User %s", object().ref());
			return;
		}
		Paper paperInMailSlot = (Paper) paperMod;
		if (paperInMailSlot.gr_state == Paper.PAPER_LETTER_STATE) {
			if (!amAGhost) {
				send_mail_arrived();
			}
			return;
		}

		// Otherwise, checks the Avatar's MailQueue for new Mail and modifies the Paper
		// in the MAIL_SLOT if any is found.
		update_mail_slot(!amAGhost);
	}

	/**
	 * If the Paper in the Avatar's pocket indicates that it can receive a new Mail and
	 * there is new Mail in an Avatar's MailQueue, pops that Mail off the MailQueue
	 * and adds it to the Paper in the Avatar's MAIL_SLOT, then optionally sends a
	 * mail arrival message.
	 *
	 * @param shouldAnnounce whether to send a MAILARRIVED$ message if the slot is advanced
     */
	private void advance_mail_slot(boolean shouldAnnounce) {
		if (mail_queue == null) {
			return;
		}

		trace_msg("Advancing Mail slot for User %s (Mail records count: %d)",
			object().ref(), mail_queue.size());

		boolean advanced = false;

		Paper paperInMailSlot = null;
		HabitatMod paperMod = contents(MAIL_SLOT);
		if (paperMod == null || !(paperMod instanceof Paper)) {
			trace_msg("Object in MAIL_SLOT for User %s is not Paper", object().ref());
			return;
		} else {
			paperInMailSlot = (Paper) paperMod;
		}

		if (mail_queue.nonEmpty()) {
			// There is a Paper in the Avatar's MAIL_SLOT, so pops the latest Mail
			// record off the MailQueue and sets it on the Paper within the MAIL_SLOT
			// so it may be read.
			MailQueueRecord nextMail = mail_queue.popNextMail();
			paperInMailSlot.gr_state = Paper.PAPER_LETTER_STATE;
			paperInMailSlot.text_path = nextMail.paper_ref;
			paperInMailSlot.sent_timestamp = nextMail.timestamp;
			paperInMailSlot.gen_flags[MODIFIED] = true;
			paperInMailSlot.checkpoint_object(paperInMailSlot);
			paperInMailSlot.retrievePaperContents();
			paperInMailSlot.send_gr_state_fiddle(Paper.PAPER_LETTER_STATE);
			context().contextor().odb().putObject(
				mailQueueRef(), mail_queue, null, false, finishMailQueueWrite);
			inc_record(Constants.HS$mail_recv_count);
			advanced = true;
			trace_msg("Advanced Mail slot for User %s to %s",
				object().ref(), paperInMailSlot.text_path);
		} else if (paperInMailSlot.gr_state == Paper.PAPER_LETTER_STATE) {
			// Otherwise, there is no more mail, so if the Paper is in a LETTER state,
			// renders it as a BLANK state.
			paperInMailSlot.ascii = Paper.EMPTY_PAPER;
			paperInMailSlot.gr_state = Paper.PAPER_BLANK_STATE;
			paperInMailSlot.text_path = Paper.EMPTY_PAPER_REF;
			paperInMailSlot.sent_timestamp = 0;
			paperInMailSlot.gen_flags[MODIFIED] = true;
			paperInMailSlot.checkpoint_object(paperInMailSlot);
			paperInMailSlot.send_gr_state_fiddle(Paper.PAPER_BLANK_STATE);
			context().contextor().odb().putObject(
				mailQueueRef(), mail_queue, null, false, finishMailQueueWrite);
			trace_msg("Blanked Mail slot for User %s", object().ref());
		}

		if (advanced && shouldAnnounce) {
			send_mail_arrived();
		}
	}

	/**
	 * Reads the latest MailQueue from Mongo then updates the Paper in an Avatar's MailSlot with
	 * the next Mail message on the MailQueue. If no further mail, blanks the Paper instead.
	 *
	 * @param shouldAnnounce whether the Avatar should receive a ' * You have MAIL...' notification
     */
	public void update_mail_slot(boolean shouldAnnounce) {
		JSONObject findPattern = new JSONObject();
		findPattern.addProperty("ref", mailQueueRef());
		context().contextor().queryObjects(
			findPattern, null, 1, new MailQueueReader(shouldAnnounce));
	}

	private class MailQueueReader implements ArgRunnable {

		private boolean shouldAnnounce;

		public MailQueueReader(boolean shouldAnnounce) {
			this.shouldAnnounce = shouldAnnounce;
		}

		@Override
		public void run(Object obj) {
			try {
				// Deserializes the MailQueue if it was found in Mongo.
				MailQueue newQueue = new MailQueue();
				if (obj != null) {
					Object[] args = (Object[]) obj;
					try {
						JSONObject jsonObj = ((JSONObject) args[0]);
						newQueue = new MailQueue(jsonObj);
					} catch (JSONDecodingException e) {
						mail_queue = newQueue;
						return;
					}
				}

				// After reading the MailQueue, assigns it as an Avatar instance variable.
				mail_queue = newQueue;
				trace_msg("Finished reading MailQueue %s for User %s",
						mailQueueRef(), object().ref());

				// If any Mail exists in the MailQueue, adds it to this Avatar's MailSlot,
				// optionally sending a presence notification.
				advance_mail_slot(shouldAnnounce);
			} catch (Exception e) {
				trace_exception(e);
			}
		}
	}

	private final ArgRunnable finishMailQueueWrite = new ArgRunnable() {
		@Override
		public void run(Object obj) {
			try {
				if (obj != null) {
					trace_msg("Failed to write mail queue for User %s: %s",
							object().ref(), obj);
				}
			} catch (Exception e) {
				trace_exception(e);
			}
		}
	};

}
