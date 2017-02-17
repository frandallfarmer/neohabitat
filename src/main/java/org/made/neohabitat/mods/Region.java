package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.ContextMod;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Constants;
import org.made.neohabitat.Container;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Region Mod (attached to a Elko Context)
 * 
 * The Region has all the state and behaviors for the main object of Habitat. It
 * is the "room" logic, controlling how things interact with each other - not on
 * a Item to Item or User to User basis, but when interacting between multiple
 * objects in the region.
 *
 * TODO Region Behavior
 * 
 * @author randy
 *
 */

public class Region extends Container implements ContextMod, Constants {
    
    /** The default depth for a region. */
    public static final int DEFAULT_REGION_DEPTH = 32; // TODO What is the
                                                       // correct default region
                                                       // depth?
    
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
    public int        lighting     = 1;
    /** The horizon line for the region to clip avatar motion */
    public int        depth        = DEFAULT_REGION_DEPTH;
    /**
     * This is an array holding all the Mods for all the Users and Items in this
     * room.
     */ // TODO Abstract this away! FRF */
    public HabitatMod noids[]      = new HabitatMod[256];
    /** Connecting region numbers in the 4 ordinal directions */
    public String     neighbors[]  = { "", "", "", "" };
    /** Direction to nearest Town */
    public String	  town_dir     = "";
    /** Direciton to nearest Teleport Booth */
    public String	  port_dir     = "";

    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "nitty_bits", "depth", "lighting", "town_dir", "port_dir", "neighbors" })
    Region(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger nitty_bits, OptInteger depth, OptInteger lighting, 
            OptString town_dir, OptString port_dir,
            String[] neighbors) {
        super(style, x, y, orientation, gr_state);
        if (nitty_bits.value(-1) != -1) {
            this.nitty_bits = unpackBits(nitty_bits.value());
        }
        this.depth = depth.value(DEFAULT_REGION_DEPTH);
        this.lighting = lighting.value(1);
        this.neighbors = neighbors;
        this.town_dir = town_dir.value("");
        this.port_dir = port_dir.value("");
    }
    
    @Override
    public void objectIsComplete() {
        this.noids[0] = this;
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = new JSONLiteral(HabitatModName(), control);
        if (packBits(nitty_bits) != 0) {
            result.addParameter("nitty_bits", packBits(nitty_bits));
        }
        result.addParameter("depth", depth);
        result.addParameter("lighting", lighting);
        result.addParameter("neighbors", neighbors);
        if (control.toRepository()) {
        	result.addParameter("town_dir", town_dir);
        	result.addParameter("port_dir", port_dir);
        }
        result.finish();
        return result;
    }
    
    /**
     * Add a HabitatMod to the object list for easy lookup by noid
     * 
     * @param mod
     */
    public static int addToNoids(HabitatMod mod) {
        int noid = 1;
        HabitatMod[] noids = mod.current_region().noids;
        while (null != noids[noid]) {
            noid++;
        }
        noids[noid] = mod;
        mod.noid = noid;
        return noid;
    }
    
    /**
     * Remove the noid from the object list.
     * 
     * @param mod
     *            The object to remove from the noid list.
     */
    public static void removeFromObjList(HabitatMod mod) {
        mod.current_region().noids[mod.noid] = null;
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
        this.send_broadcast_msg(0, "APPEARING_$", "appearing", who.noid);
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
    
}