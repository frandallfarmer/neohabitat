package org.made.neohabitat.mods;

import java.util.ArrayList;
import java.util.Hashtable;
import java.util.List;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.Context;
import org.elkoserver.server.context.ContextMod;
import org.elkoserver.server.context.ContextShutdownWatcher;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.User;
import org.elkoserver.server.context.UserWatcher;
import org.elkoserver.util.ArgRunnable;
import org.made.neohabitat.Constants;
import org.made.neohabitat.Container;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Toggle;



/**
 * Habitat Region Mod (attached to a Elko Context)
 * 
 * The Region has all the state and behaviors for the main object of Habitat. It
 * is the "room" logic, controlling how things interact with each other - not on
 * a Item to Item or User to User basis, but when interacting between multiple
 * objects in the region.
 * 
 * @author randy
 *
 */

public class Region extends Container implements UserWatcher, ContextMod, ContextShutdownWatcher,  Constants {
    
    public static String    MOTD = "Welcome to Habitat! For help see http://neohabitat.org";
    
    /** Static flag on if new features should be activated. Anyone can toggle with //neohabitat */
    public static boolean   NEOHABITAT_FEATURES = true; 
    
    /** The number of tokens to give to an avatar each new day that the user loggs in */
    public static final int STIPEND = 100;
    
    /** The default depth for a region. */
    public static final int DEFAULT_REGION_DEPTH = 32;

    /** The default maximum number of avatars for a Region. */
    public static final int DEFAULT_MAX_AVATARS = 6;
    
    /** Statics are shared amongst all regions */

    /** All the currently logged in user names for ESP lookup */
    public static Hashtable<String, User> NameToUser = new Hashtable<String, User>();    
    
    /** All the currently instantiated regions for region transition testing  */
    public static Hashtable<String, Region> RefToRegion = new Hashtable<String, Region>();    

    public int HabitatClass() {
        return CLASS_REGION;
    }
    
    public String HabitatModName() {
        return "Region";
    }
    
    public int capacity() {
        return 255;
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
    
    /** A collection of server-side region status flags */
    public boolean    nitty_bits[] = new boolean[32];
    /** The lighting level in the room. 0 is Dark. */
    public int        lighting     = 0;
    /** The horizon line for the region to clip avatar motion */
    public int        depth        = DEFAULT_REGION_DEPTH;
    /** The maximum number of Avatars that can be in this Region */
    public int        max_avatars  = DEFAULT_MAX_AVATARS;

    /**
     * This is an array holding all the Mods for all the Users and Items in this
     * room.
     */
    public HabitatMod noids[]      = new HabitatMod[256];
    public int        nextNoid     = 1;
    public String     neighbors[]  = { "", "", "", "" };
    /** Direction to nearest Town */
    public String     town_dir     = "";
    /** Direction to nearest Teleport Booth */
    public String     port_dir     = "";    

    public boolean is_turf  = false;
    public String  resident = "";
    public String  realm    = "unknown";
    public boolean locked   = false;

    /** C64 Heap Emulation */
    public  int[]   class_ref_count     = new int[256];
    public  int[][] resource_ref_count  = new int[4][256];      // images, heads, behaviors, sounds
    public  int     space_usage         = 0;
    
    /** A handle to the mandatory singleton ghost object for this region */    
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "nitty_bits", "depth", "lighting",
        "town_dir", "port_dir", "max_avatars", "neighbors", "is_turf", "resident", "realm", "locked", "noid" })
    public Region(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
        OptInteger nitty_bits, OptInteger depth, OptInteger lighting,
        OptString town_dir, OptString port_dir, OptInteger max_avatars,
        String[] neighbors, OptBoolean is_turf, OptString resident, OptString realm,
        OptBoolean locked, OptInteger noid) {
        super(style, x, y, orientation, gr_state, new OptBoolean(false));
        if (nitty_bits.value(-1) != -1) {
            this.nitty_bits = unpackBits(nitty_bits.value());
        }
        this.depth = depth.value(DEFAULT_REGION_DEPTH);
        this.lighting = lighting.value(0);
        this.max_avatars = max_avatars.value(DEFAULT_MAX_AVATARS);
        this.neighbors = neighbors;
        this.town_dir = town_dir.value("");
        this.port_dir = port_dir.value("");
        this.is_turf = is_turf.value(false);
        this.resident = resident.value("");
        this.realm = realm.value("unknown");
        this.locked = locked.value(false);
        this.noid = THE_REGION;
    }

    public Region(int style, int x, int y, int orientation, int gr_state, boolean[] nitty_bits,
        int depth, int lighting, String town_dir, String port_dir, int max_avatars,
        String[] neighbors, boolean is_turf, String resident, String realm, boolean locked, int noid) {
        super(style, x, y, orientation, gr_state, false);
        this.nitty_bits = nitty_bits;
        this.depth = depth;
        this.lighting = lighting;
        this.max_avatars = max_avatars;
        this.neighbors = neighbors;
        this.town_dir = town_dir;
        this.port_dir = port_dir;
        this.is_turf = is_turf;
        this.resident = resident;
        this.realm = realm;
        this.locked = locked;
        this.noid = THE_REGION;
    }

    @Override
    public void objectIsComplete() {
        ((Context) object()).registerUserWatcher((UserWatcher) this);
        noids[THE_REGION] = this;
        note_object_creation(this);
        Region.RefToRegion.put(obj_id(), this);
    }
    
    private Ghost regionGhost() {
        return (Ghost) noids[GHOST_NOID];
    }

    public Ghost getGhost() {
        Ghost ghost = regionGhost();
        if (ghost == null) {
            ghost       = new Ghost(0, 4, 240, 0, 0, false);
            ghost.noid  = GHOST_NOID;
            create_object("Ghost", ghost, this, true);
            new Thread(announceGhostLater).start();          
        }
        return ghost;
    }

    /**
     * It could be that the ghost is getting created at startup time, which is too soon to send messages to the clients.
     */
    protected Runnable announceGhostLater = new Runnable() {
        @Override
        public void run() {
            try {
                Thread.sleep(1000);
                announce_object(current_region().noids[GHOST_NOID].object(), current_region());
            } catch (InterruptedException neverHappens) {
                Thread.currentThread().interrupt();
            }
        }
    };
    
    public void destroyGhost(User from) {
        Ghost ghost = regionGhost();
        if (ghost != null) {
            if (from != null)
                send_neighbor_msg(from, THE_REGION, "GOAWAY_$", "target", GHOST_NOID);
            destroy_object(ghost);
        }
    }
    
    
    @Override
    public void noteContextShutdown() {
        destroyGhost(null);
        Region.RefToRegion.remove(obj_id());
    }
    
    public void noteUserArrival(User who) {
        Avatar avatar = (Avatar) who.getMod(Avatar.class);
        avatar.inc_record(HS$travel);
        int today = (int) (System.currentTimeMillis() / ONE_DAY);
        int time  = (int) (System.currentTimeMillis() % ONE_DAY);
        if (today > avatar.lastConnectedDay) {
            avatar.bankBalance += STIPEND;
            avatar.set_record(HS$wealth, avatar.bankBalance);
            avatar.inc_record(HS$lifetime);
        }
        avatar.lastArrivedIn        = context().baseRef(); 
        avatar.lastConnectedDay     = today;
        avatar.lastConnectedTime    = time;
        
        if(today > avatar.lastConnectedDay && avatar.health < MAX_HEALTH) {
            avatar.health += 25;
            if(avatar.health > MAX_HEALTH) {
                avatar.health = MAX_HEALTH;
            }
        }
        
        if (avatar.amAGhost) {
            getGhost().total_ghosts++; // Make sure the user has a ghost object..
        }
        if (avatar.firstConnection) {
            object_say(who, MOTD);
            if (NEOHABITAT_FEATURES) {
                if (NameToUser.size() < 2) {
                    object_say(who, UPGRADE_PREFIX + "You are the only one here right now.");
                } else {
                    object_say(who, UPGRADE_PREFIX + "There are " + (NameToUser.size() - 1) + " others here" +
                            (avatar.amAGhost ? "." : " Press F3 to see a list."));
                }
                if (avatar.amAGhost) {
                    object_say(who, UPGRADE_PREFIX + "You are a ghost. Press F1 to become an Avatar.");
                }
                tellEveryone(who.name() + " has arrived.");
            }
        }
        avatar.check_mail();
        Region.addUser(who);
    }
    
    public void noteUserDeparture(User who) {
        Region.removeUser(who);
        Avatar avatar = avatar(who);
        Ghost  ghost  = regionGhost();
        if (avatar.holding_restricted_object()) {
            avatar.heldObject().putMeBack(who, false);
        }
        if (avatar.amAGhost) {
            ghost.total_ghosts--;
            if (ghost.total_ghosts == 0) {
                destroyGhost(who);
            }
        } else {
            lights_off(avatar);
        }
        avatar.lastConnectedDay  = (int) (System.currentTimeMillis() / ONE_DAY);
        avatar.lastConnectedTime = (int) (System.currentTimeMillis() % ONE_DAY);
        avatar.gen_flags[MODIFIED] = true;                      
        avatar.checkpoint_object(avatar);
    }
    
    private int avatarsPresent() {
        return class_ref_count[CLASS_AVATAR];
    }
    
    public synchronized static void addUser(User from) {
        NameToUser.put(from.name().toLowerCase(), from);
    }
    
    public synchronized static void removeUser(User from) {
        Avatar avatar = (Avatar) from.getMod(Avatar.class);
        NameToUser.remove(from.name().toLowerCase());
        removeContentsFromRegion(avatar);
        avatar.note_object_deletion(avatar);
        removeFromObjList(avatar);
    }

    public synchronized static List<Avatar> findOracles() {
        List<Avatar> oracleList = new ArrayList<>();
        for (User user : NameToUser.values()) {
            Avatar avatar = (Avatar) (user.getMod(Avatar.class));
            if (avatar.nitty_bits[GOD_FLAG]) {
                oracleList.add(avatar);
            }
        }
        return oracleList;
    }

    public static User getUserByName(String name) {
        if (name != null) {         
            return (User) NameToUser.get(name.toLowerCase());
        }
        return null;
    }
    
    public static final int AVERAGE_C64_AVATAR_LOAD = 1000; // bytes. Non-scientific spitball guess of additional headroom needed for head image + 4 unique items.
    
    public static boolean IsRoomForMyAvatarIn(String regionRef, User from) {
        Region region = Region.RefToRegion.get(regionRef);
        
        if (region == null)
            return true;                // if there is no instantiated region, there must be room!
                
        return region.isRoomForMyAvatar(from);
    }
    
    public boolean isRoomForMyAvatar(User from) {
        if (avatarsPresent() == max_avatars)
            return false;
        
        // TODO: Remove the silly headroom estimate below with something real someday?
        if (space_usage + AVERAGE_C64_AVATAR_LOAD >= C64_HEAP_SIZE)
            return false;
        
        return mem_check_container(avatar(from)); // Check the pocket contents for other overflows.

    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = new JSONLiteral(HabitatModName(), control); // Normally I would call encodeCommon() but don't want to bother with the extraneous fields.
        result.addParameter("orientation", orientation);
        if (packBits(nitty_bits) != 0) {
            result.addParameter("nitty_bits", packBits(nitty_bits));
        }
        result.addParameter("depth", depth);
        result.addParameter("lighting", lighting);
        result.addParameter("noid", noid);
        result.addParameter("neighbors", neighbors);
        if (control.toRepository()) {
            result.addParameter("max_avatars", max_avatars);
            result.addParameter("town_dir", town_dir);
            result.addParameter("port_dir", port_dir);
            result.addParameter("is_turf", is_turf);
            result.addParameter("resident", resident);
            result.addParameter("realm", realm);
            result.addParameter("locked", locked);
        }
        result.finish();
        return result;
    }
    
    private static int incNoid(int noid) {
        noid++;
        switch (noid) {
            case THE_REGION:
            case GHOST_NOID:
            case 256:
                return 1;
        }
        return noid;
    }
    
    /**
     * Add a HabitatMod to the object list for easy lookup by noid.
     * This method uses a monotonically increasing index, remembering
     * the previous noid assignment. Deleted objects will leave holes
     * that we are in no hurry to fill in. Note the reserved NOID ids
     * of THE_REGION (0) and GHOST_NOID (255).
     * 
     * @param mod
     */
    public static boolean addToNoids(HabitatMod mod) {
        Region          region  = mod.current_region();
        int             noid    = region.nextNoid;
        HabitatMod[]    noids   = region.noids;
        
        if (region.nextNoid == -1) {
            return false; /* Too many things in this region!*/
        }

        noids[noid]     = mod;
        mod.noid        = noid;
        
        noid = incNoid(noid);
        
        while (null != noids[noid]) {
            noid = incNoid(noid);
            if (noid == region.nextNoid) {
                noid = -1;
                break;  // Searched everything, none free.
            }
        }
        region.nextNoid = noid;
        return true; // noid added, even if no
    }
    
    /**
     * Remove the noid from the object list.
     * 
     * @param mod
     *            The object to remove from the noid list.
     */
    public static void removeFromObjList(HabitatMod mod) {
        if (mod.noid < UNASSIGNED_NOID) {
            mod.current_region().noids[mod.noid] = null;
            mod.noid = UNASSIGNED_NOID;
        }
    }
        
    /**
     * When items go away because their container left or closed, we must reclaim scarce resources: noids and 
     * 
     * @param cont
     */
    public static void removeContentsFromRegion(Container cont) {
        for (int i = 0; i < cont.capacity(); i++) {
            HabitatMod obj = cont.contents(i);
            if (obj != null)
                removeObjectFromRegion(obj);
        }
    }
    
    public static void removeObjectFromRegion(HabitatMod obj) {
        if (obj == null)
            return;
        
        Container cont = obj.container();
        if (cont != null & cont.opaque_container())
            obj.note_instance_deletion(obj);
        else
            obj.note_object_deletion(obj);
        
        removeFromObjList(obj);
    }

    public static void tellEveryone(String text) {
        tellEveryone(text, false);
    }

    public static void tellEveryone(String text, boolean shouldBeep) {
        for (String key: NameToUser.keySet()) {
            User    user    = NameToUser.get(key);
            Avatar  avatar  = (Avatar) user.getMod(Avatar.class);
            if (shouldBeep) {
                avatar.send_private_msg(user, THE_REGION, user, "PLAY_$",
                    "sfx_number", 8,
                    "from_noid", avatar.noid);
            }
            avatar.object_say(user, UPGRADE_PREFIX + text);
        }
    }

    public static void tellEveryone(int[] ascii) {
        tellEveryone(ascii, false);
    }

    public static void tellEveryone(int[] ascii, boolean shouldBeep) {
        for (String key: NameToUser.keySet()) {
            User        user    = NameToUser.get(key);
            Avatar      avatar  = (Avatar) user.getMod(Avatar.class);
            if (shouldBeep) {
                avatar.send_private_msg(user, THE_REGION, user, "PLAY_$",
                    "sfx_number", 8,
                    "from_noid", avatar.noid);
            }
            JSONLiteral msg     = avatar.new_private_msg(THE_REGION, "OBJECTSPEAK_$");
            int         send[]  = new int[ascii.length + 1];
            send[0] = UPGRADE_PREFIX.charAt(0);
            System.arraycopy(ascii, 0, send, 1, ascii.length);
            msg.addParameter("ascii", send);
            msg.addParameter("speaker", avatar.noid);
            msg.finish();
            user.send(msg);
        }
    }
    
    /**
     * The client is leaving the Habitat Application and wants to politely
     * disconnect.
     * 
     * @param from
     *            The client disconnecting
     */
    @JSONMethod({ "reason" })
    public void LEAVE(User from, OptInteger reason) {
        if (reason.present()) {
            trace_msg("Client error " + CLIENT_ERRORS[reason.value()] + " reported by " + from.ref());
        }
        try {
            current_region().context().exit(from);
        } catch (Exception ignored) {
            trace_msg("Invalid attempt to leave by " + from.ref() + " failed: " + ignored.toString());
        }
    }
    
    /**
     * The client is slow and this might provide an advantage to others seeing a
     * new avatar before it can react. The server is told by this message that
     * it deal with messages before this as being before the user has appeared.
     * 
     * @param from
     *            The client connection that needs to catch up...
     */
    @JSONMethod
    public void FINGER_IN_QUE(User from) {
        this.send_private_msg(from, 0, from, "CAUGHT_UP_$", "err", TRUE);
    }
    
    /**
     * Handle the client request to "appear" after the client is done loading
     * the region.
     * 
     * @param from
     *            The client connection that has "caught up" loading the
     *            contents vector it just received.
     */ 
    @JSONMethod
    public void I_AM_HERE(User from) {
        Avatar who = avatar(from);
        who.gr_state &= ~INVISIBLE;
        who.showDebugInfo(from);
        send_broadcast_msg(0, "APPEARING_$", "appearing", who.noid);
        // If the avatar has any objects in their hands, perform any necessary side effects.
        lights_on(who);
    }

    public boolean grabable(HabitatMod mod) {
        if (nitty_bits[STEAL_FREE] |
            mod.HabitatClass() == CLASS_PAPER |
            mod.HabitatClass() == CLASS_BOOK |
            mod.HabitatClass() == CLASS_TOKENS |
            (mod.HabitatClass() == CLASS_MAGIC_LAMP && mod.gr_state == MAGIC_LAMP_GENIE)) {
            return false;
        }
        return true;
    }

    public void lights_off(Avatar avatar) {
        if (!empty_handed(avatar)) {
            HabitatMod light = avatar.contents(HANDS);
            if (light.HabitatClass() == CLASS_FLASHLIGHT) {
                if (((Toggle) light).on == TRUE) {
                    lighting -= 1;
                    send_broadcast_msg(THE_REGION, "CHANGELIGHT_$", "adjustment", -1);
                }
            }           
        }
    }
    
    public void lights_on(Avatar avatar) {
        if (!empty_handed(avatar)) {
            HabitatMod held = avatar.contents(HANDS);
            /* If holding a flashheld.on entry, turn on the held. */
            if (held.HabitatClass() == CLASS_FLASHLIGHT) {
                if (((Toggle) held).on == TRUE) {
                    lighting += 1;
                    send_broadcast_msg(THE_REGION, "CHANGELIGHT_$", "adjustment", +1);
                }
            }           
            /* If holding a compass, set the arrow pointer */
            if (held.HabitatClass() ==  CLASS_COMPASS) {
                held.gr_state = orientation;
                held.gen_flags[MODIFIED] = true;
            }
        }
    }
        
    /**
     * Handle request to change the Message of the Day.
     * Presently, this is a non-persistent change.
     * 
     * @param from
     * @param MOTD
     */
    @JSONMethod ({ "MOTD" })
    public static void SET_MOTD(User from, String MOTD) {
        // TODO FRF Security is missing from this feature. Should this be a message on Admin/Session?
        Region.MOTD = MOTD;
    }
    
    /**
     * Handle request to send a word balloon message
     * to every user currently online.
     * 
     * @param from
     * @param MOTD
     */
    @JSONMethod ({ "text", "ascii" })
    public void TELL_EVERYONE(User from, OptString text, int[] ascii) {
        // TODO FRF Security is missing from this feature. Should this be a message on Admin/Session?
        tellEveryone(" From: The Oracle   To: All Avatars: ");
        if (ascii != null) {
            tellEveryone(ascii);
        } else {
            tellEveryone(text.value("... nevermind ..."));
        }
    }    
    
    /**
     * Handle a prompted message, overloading the text-entry field. This
     * requires some callback related storage in Avatar.
     * 
     * @param from
     *            The user-connection that sent the prompt reply
     * @param text
     *            The prompt reply (includes any prompt.)
     */
    @JSONMethod({ "text" })
    public void PROMPT_REPLY(User from, OptString text) {
        String prompt = text.value("");
        String body = null;
        Avatar avatar = avatar(from);
        if (prompt.contains(GOD_TOOL_PROMPT)) {
            body = prompt.substring(GOD_TOOL_PROMPT.length());
            if (0 == body.length()) {
                avatar.savedMagical = null;
                avatar.savedTarget = null;
                return;
            }
            avatar.savedMagical.god_tool_revisited(from, body);
            return;
        }
    }

    public void describeRegion(User from, int noid) {
         String name_str = object().name();
         String help_str = "";
         if (name_str.isEmpty()) 
              help_str = "This region has no name";
         else
              help_str = "This region is " + name_str;
         
         if (!town_dir.isEmpty()) 
              help_str += ".  The nearest town is " + town_dir;
                   
         if (!port_dir.isEmpty()) 
              help_str += ".  The nearest teleport booth is " + port_dir;
         
         help_str += ".";
            send_reply_msg(from, noid, "text", help_str);
    }
}