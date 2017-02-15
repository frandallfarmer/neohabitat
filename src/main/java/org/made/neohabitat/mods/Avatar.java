package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.server.context.User;
import org.elkoserver.server.context.UserMod;
import org.made.neohabitat.Container;
import org.made.neohabitat.mods.Door;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Magical;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;

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
    
    /** The body type for the avatar TODO */
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
    
    public String     turf            = "context-test";
    
    
    private String     from_region		= "";
    private String     to_region		= "";	   
    private int        from_orientation	= 0;
    private int        from_direction	= 0;
    private int        transition_type	= WALK_ENTRY;
    
    /**
     * Target NOID and magic item saved between events, such as for the GOD TOOL
     * (see Magical.java). This is a transient value and not persisted.
     */
    public HabitatMod savedTarget     = null;
    public Magical    savedMagical    = null;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "nitty_bits", "bodyType", "stun_count", "bankBalance",
        "activity", "action", "health", "restrainer", "transition_type", "from_orientation", "from_direction", "from_region", "to_region",
        "turf", "custom" })
    public Avatar(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger nitty_bits, OptString bodyType, OptInteger stun_count, OptInteger bankBalance,
            OptInteger activity, OptInteger action, OptInteger health, OptInteger restrainer, 
            OptInteger transition_type, OptInteger from_orientation, OptInteger from_direction,
            OptString from_region, OptString to_region, OptString turf, int[] custom) {
        super(style, x, y, orientation, gr_state);
        if (nitty_bits.value(-1) != -1) {
            this.nitty_bits = unpackBits(nitty_bits.value());
        }
        this.bodyType = bodyType.value("male");
        if ("female".equals(this.bodyType)) {
            this.orientation = this.set_bit(this.orientation, GENDER_BIT);
        } else {
            this.orientation = this.clear_bit(this.orientation, GENDER_BIT);
        }
        this.stun_count = stun_count.value(0);
        this.bankBalance = bankBalance.value(0);
        this.activity = activity.value(STAND_FRONT);
        this.action = action.value(this.activity);
        this.health = health.value(MAX_HEALTH);
        this.restrainer = restrainer.value(0);
        this.from_direction = from_direction.value(0);
        this.from_orientation = from_orientation.value(0);
        this.transition_type = transition_type.value(WALK_ENTRY);
        this.from_region = from_region.value("");
        this.to_region = to_region.value("");
        this.turf = turf.value(DEFAULT_TURF);
        this.custom = custom;
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        if (packBits(nitty_bits) != 0) {
            result.addParameter("nitty_bits", packBits(nitty_bits));
        }
        result.addParameter("bodyType", bodyType);
        result.addParameter("stun_count", stun_count);
        result.addParameter("bankBalance", bankBalance);
        result.addParameter("activity", activity);
        result.addParameter("action", action);
        result.addParameter("health", health);
        result.addParameter("restrainer", restrainer);
        result.addParameter("custom", custom);
        if (result.control().toRepository()) {
            result.addParameter("from_region",      from_region);
            result.addParameter("to_region",      	to_region);
            result.addParameter("from_orientation", from_orientation);
            result.addParameter("from_direction",   from_direction);
            result.addParameter("transition_type",	transition_type);
        }
        result.finish();
        return result;
    }
    
    
    /** Avatars need to be repositioned upon arrival in a region based on the method used to arrive. */
    public void objectIsComplete() {
        Region.addToNoids(this);
        /** Was pl1 region_entry_daemon: */
        
        // If traveling as a ghost, don't do ANYTHING fancy 
        if (noid == GHOST_NOID)
            return;

        // If the avatar has any objects in their hands, perform any necessary side effects.
        in_hands_side_effects(this);
        
        // If walking in, set the new (x,y) based on the old (x,y), the entry
        // direction, the rotation of the region transition, the horizon of the
        // new region, and so on 
        int new_x           = x;
        int new_y           = y & ~FOREGROUND_BIT;
        int new_activity    = FACE_LEFT;
        int rotation        = 0;
        int arrival_face    = 0;
        
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
        }
        
        // TODO If entering on death, penalize the Avatar's tokens, if any 
        else if (transition_type == DEATH_ENTRY) {
            HabitatMod noids[] = current_region().noids;
            for (int i=0; i < noids.length; i++) {
                HabitatMod obj = noids[i];
                if (obj != null && obj.HabitatClass() == CLASS_TOKENS) {
                    /*
                      Tokens token = (Tokens) obj;
                      int denom = (token.denom_lo + token.denom_hi * 256) * 50 / 100;
                      token.denom_lo = denom % 256;
                      token.denom_hi = (denom - token.denom_lo) / 256;
                      if (denom == 0)
                          token.denom_lo = 1;
                      token.gen_flags(MODIFIED) = true;
                     */                      
                }
            }
        }
        
        // If entering via teleport, make sure we're in foreground         
        else if (transition_type == TELEPORT_ENTRY) {
            y |= FOREGROUND_BIT;
        } else {
            trace_msg("ENTRY ERROR: uUnknown transition type: " + transition_type);
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
    
    
    
    /*        
         // If entering on death, penalize the Avatar's tokens, if any 
         else if (transition_type = DEATH_ENTRY) then do;
              do i = 0 to 255;
                   tokenptr = ObjList(i);
                   if (tokenptr ^= null()) then do;
                        if (token.class = CLASS_TOKENS) then do;
                             denom = token.denom_lo + token.denom_hi*256;
                             denom = divide(denom, 2, 15);
                             token.denom_hi = divide(denom, 256, 15);
                             token.denom_lo = mod(denom, 256);
                             if (denom = 0) then
                                  token.denom_lo = 1;
                             token.gen_flags(MODIFIED) = true;
                        end;
                   end;
              end;
         end;
        
         // If entering via teleport, make sure we're in foreground 
         else if (transition_type = TELEPORT_ENTRY) then do;
              call set_bit(avatar.y, 8);
         end; else do;
              call trace_msg('entry daemon: unknown transition type: ' ||
                   ltrim(transition_type));
         end;
     */
    
    /**
     * Verb (Specific): TODO Grabbing from another avatar.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void GRAB(User from) {
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
     * Verb (Specific): TODO Speak to the region/ESP to another user
     * 
     * @param from
     *            User representing the connection making the request.
     * @param esp
     *            Byte flag indicating that ESP message mode is active on the
     *            client.
     * @param text
     *            The string to speak...
     */
    @JSONMethod({ "esp", "text" })
    public void SPEAK(User from, OptInteger esp, OptString text) {
        int in_esp = esp.value(FALSE);
        /* TODO ESP logic Missing */
        send_broadcast_msg(this.noid, "SPEAK$", text.value("(missing text)"));
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
        
        // object_say(from, noid, "Avatar.WALK not implemented yet.");
        
        /*
         * declare destination_x binary(15); declare destination_y binary(15);
         * declare flip_path bit(1) aligned;
         * 
         * x = rank(request(FIRST)); y = rank(request(SECOND)); walk_how =
         * rank(request(THIRD)); if (selfptr ^= avatarptr) then do;
         * destination_x = avatar.x; destination_y = avatar.y; end; else if
         * (avatar.stun_count > 0) then do; avatar.stun_count =
         * avatar.stun_count - 1; call r_msg_3(avatar.x, avatar.y, walk_how); if
         * (avatar.stun_count >= 2) then call p_msg_s(selfptr, selfptr, SPEAK$,
         * 'I can''t move. I am stunned.'); else if (avatar.stun_count = 1) then
         * call p_msg_s(selfptr, selfptr, SPEAK$, 'I am still stunned.'); else
         * call p_msg_s(selfptr, selfptr, SPEAK$, 'The stun effect is wearing
         * off now.'); return; end; else do; call check_path(THE_REGION, x, y,
         * destination_x, destination_y, flip_path); if (flip_path) then call
         * set_bit(walk_how, 8); else call clear_bit(walk_how, 8); if
         * (destination_x ^= self.x | destination_y ^= self.y) then do; self.x =
         * destination_x; self.y = destination_y; call n_msg_3(selfptr, WALK$,
         * destination_x, destination_y, walk_how); end; end; call
         * r_msg_3(destination_x, destination_y, walk_how);
         */
        int destination_x = x.value(80);
        int destination_y = y.value(10) | FOREGROUND_BIT;
        int walk_how = how.value(0);
        
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
        unsupported_reply(from, noid, "Avatar.DISCORPORATE not implemented yet.");
    }
    
    /**
     * Verb (Specific): TODO Send a point-to-point message to another
     * user/avatar.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void ESP(User from) {
        unsupported_reply(from, noid, "Avatar.ESP not implemented yet.");
    }
    
    /**
     * Verb (Specific): TODO Sit down. [Stand up?]
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod({"up_or_down", "seat_id"})
    public void SITORSTAND(User from, int up_or_down, int seat_id) {
    	
    	if (up_or_down <= SIT_DOWN) {		// TOFO FRF This is always for now until we can work with Elko for a fix.
            unsupported_reply(from, noid, "This furniture has a sign that reads 'Do not sit here. Under repair'.");
    		return;
    	}	
   	
    	/** Historically was avatar_SITORSTAND in original pl1 */
    	Region		region	= current_region();
    	HabitatMod	seat	= region.noids[seat_id];
    	int			noid    = this.noid;
    	if (seat != null) {
    		if (seat.HabitatClass() == CLASS_CHAIR || seat.HabitatClass()  == CLASS_COUCH ||
    				seat.HabitatClass()  == CLASS_BED) {
    			if (up_or_down == STAND_UP) {
    				if (noid == seat_id) {
    					if (!change_containers(this, region, 0, false)) {
    						send_reply_msg(from, 0, "err", FALSE, "slot", 0);
    						return;
    					}
    					activity = STAND;
    					gen_flags[MODIFIED] = true;
    					checkpoint_object(this);
						send_reply_msg(from, 0, "err", TRUE, "slot", 0);
						this.send_neighbor_msg(from, noid, "SIT$", "up_or_down", STAND_UP, "cont", seat_id, "slot", 0);
    					return;
    				}
    			} else {
    				Container cont = (Container) seat;
    				for (int i=0; i < cont.capacity(); i++) {
    					if (cont.contents(i) == null) {
    						if (!change_containers(this,  cont, i, true)) {
        						send_reply_msg(from, 0, "err", FALSE, "slot", 0);
    							return;
    						}
    						send_reply_msg(from, 0, "err", TRUE, "slot", i);
    						this.send_neighbor_msg(from, noid, "SIT$", "up_or_down", SIT_DOWN, "cont", seat_id, "slot", 0);
    						return;
    					}
    				}
    			}
    		}
    	}     
		this.send_reply_msg(from, 0, "err", FALSE, "slot", 0);
    }



    
    /**
     * Verb (Specific): TODO Touch another avatar.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void TOUCH(User from) {
        unsupported_reply(from, noid, "Avatar.TOUCH not implemented yet.");
    }
    
    /**
     * Verb (Specific): TODO Deal with FN Key presses.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod({ "key", "target" })
    public void FNKEY(User from, OptInteger key, OptInteger target) {
        switch (key.value(0)) {
            case 16: // F8
                object_say(from, "        You are connected to          ");
                object_say(from, "   The Neoclassical Habitat Server    ");
                //                object_say(from, "                                     ".substring(BuildVersion.version.length())
                //                       + BuildVersion.version + " ");
                object_say(from, "    The MADE, The Museum of Arts &       Digital Entertainment, Oakland CA");
                object_say(from, "                                      ");
                object_say(from, "Open source - Join us! NeoHabitat.org ");
                send_reply_success(from);
                break;
            case 11: // F3 & F4 (List last dozen users)
            case 13: // F5 & F6 (Change Skin Color)
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
            send_neighbor_msg(from, THE_REGION, "WAITFOR_$", "who", this.noid);
            send_reply_success(from);
            change_regions(new_region, direction, entry_type);
            return;
        }       
        object_say(from, "There is nowhere to go in that direction.");
        send_reply_error(from); 
    }
    
    public void change_regions(String contextRef, int direction, int type) {
    	Region	region		= current_region();
    	User	who			= (User) this.object();
    	
    	// TODO change_regions exceptions! see region.pl1
    	
        to_region			= contextRef;    	
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
    		msg.finish();
    		who.send(msg);
    	}
    }
    
    public void drop_object_in_hand() {
    	if (contents(HANDS) != null) {
    		HabitatMod obj = contents(HANDS);
    		obj.x = 8;
    		obj.y = 130;
    		obj.gen_flags[MODIFIED] = true;
    		obj.checkpoint_object(obj);
    		send_broadcast_msg(THE_REGION, "CHANGE_CONTAINERS_$",
    			"CONTAINER", THE_REGION,
    			"X", obj.x,
    			"Y", obj.y);
    		change_containers(this, current_region(), obj.y, true);
    	}
    }
}