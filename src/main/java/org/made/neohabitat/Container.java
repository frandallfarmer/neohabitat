package org.made.neohabitat;

import java.util.Iterator;

import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.BasicObject;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.Msg;
import org.elkoserver.server.context.User;
import org.made.neohabitat.mods.Avatar;
import org.made.neohabitat.mods.Region;

/**
 * an Elko Habitat superclass to handle container state.
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 * This class doesn't actually store the contents of this container - that is
 * all being modeled by Elko. So this.contents(INDEX) finds the item in Elko
 * contents.
 * 
 * Note that there aren't many verb related methods here, as GET/PUT semantics
 * are managed by verbs on the object being GET/PUT into or out-of the
 * container.
 */
public abstract class Container extends HabitatMod {
    
	/** The c64 Heap footprint when this object was last closed & persisted **/
	
	
    /** C64 Heap Emulation (ephemeral) **/
	/* FRF 02/16/18 - Moved from Region to Container so that we can track heap size for reagions, avatars, and openable containers for doing "peek ahead" to determine if there's space to add an object. */
	
    public  int[]   class_ref_count     = new int[256];
    public  int[][] resource_ref_count  = new int[4][256];      // images, heads, behaviors, sounds
    public  int     space_usage         = 0;
    
	/** The c64 Heap footprint when this object was last closed - persisted in Openable/Avatar/Region **/
    public	int		shutdown_size = 0;
	
    /* All objects with contents have this state */
    
    public Container(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    public Container(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted, OptInteger shutdown_size) {
        super(style, x, y, orientation, gr_state, restricted);
        this.shutdown_size = shutdown_size.value(0);
    }
    
    public Container(int style, int x, int y, int orientation, int gr_state, boolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }
    
    public Container(int style, int x, int y, int orientation, int gr_state, boolean restricted, int shutdown_size) {
        super(style, x, y, orientation, gr_state, restricted);
        this.shutdown_size = shutdown_size;
    }

    public JSONLiteral encodeContainer(JSONLiteral result) {
        result = super.encodeCommon(result);
        if (0 != shutdown_size) {
        	result.addParameter("shutdown_size", shutdown_size);
        }
        return result;   
    }
    
    /**
     * In pl1 contents[] was an array of noids - with positional offsets for
     * class_avatar (not for other containers) Now it's an get function with the
     * same name for easy porting. The contents are managed by Elko.
     * 
     * @param index
     *            Position in PL1 contents[] array. Now used as a search key for
     *            y/position through Elko contents.
     * 
     * @return The mod of the item with that noid.
     */
    public HabitatMod contents(int index) {
        Iterator<Item> elkoContents = ((BasicObject) this.object()).contents()
                .iterator(); /* TODO refactor with Chip FRF */
        while (elkoContents.hasNext()) {
            Item item = elkoContents.next();
            HabitatMod mod;
            try {
                mod = (HabitatMod) item.getMod(HabitatMod.class);
            } catch (Exception ignored) {
                mod = null;
                trace_msg("Attempt to get " + item.name() + " for " + item.ref() + " failed: " + ignored.toString());
            }
            if (null != mod && mod.y == index) {
                return mod;
            }
        }
        return null;
    }
    
    /**
     * It sends a newly opened container's contents.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void get_container_contents(User from) {
        /* Original code was in regionproc.pl1 - ELKO handles this now */
        ((Item) object()).openContainer();
        // Assumes calling code has already accounted for any client-side
        // storage limitation
    }
    
    /**
     * Sends CONNECTION_JSON messages to destroy items (client side) that are
     * now invisible in the closed container
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void close_container(User from) {
    	setContainerShutdownSize();        
        Region.removeContentsFromRegion(this);      // Do this Game Logic before any delete messages get sent...
        ((Item) object()).closeContainer();         // Elko will really remove the instances  TODO: FRF Can this fail?
        /* Original code was in regionproc.pl1 - ELKO handles this now */
        // TODO Client Memory Management and several messages are missing from
        // this interim implementation
    }
    
    public int setContainerShutdownSize() {
    	// Calculate the memory maximum memory footprint
    	space_usage = 0;
        class_ref_count     = new int[256];
        resource_ref_count  = new int[4][256];
        
        for (int i = 0; i < capacity(); i++) {
            HabitatMod obj = contents(i);
            if (obj != null) {
                note_instance_creation_internal(obj, this);
                if (container_is_opaque(this, obj.y)) {
                	note_image_creation_internal(obj, obj.style, this);
                } else {
                	note_resource_creation_internal(obj, obj.style, this);
                }
            }
        }
        shutdown_size = space_usage;
        return shutdown_size;
    }

    /**
     * Destroys and deletes all contents of this Container.
     */
    public void destroy_contents() {
        for (int i=0; i < capacity(); i++) {
            HabitatMod mod = this.contents(i);
            if (mod != null) {
                destroy_object(mod);
            }
        }
    }

    /**
     * Determine if the avatar manipulating this container exclusively "owns" this (in possession or in turf.)
     * 
     * TODO: NOTE - this replaces having "owner" state on display cases. That can be added back in later for "shop owners" FRF
     * It's more general and can be applied to all turf containers. Only turf owners can manipulate contents.
     * 
     * @param from
     * @return
     */
    public boolean meetsOwnershipRestrictions(User from) {
        Avatar avatar = (Avatar) avatar(from);
        Region region = current_region();
        if (!immobile(this) || !region.is_turf) { // Test only immobile containers in turfs.
            return true;
        }
        if (region.resident.equals(avatar.object().baseRef())) {
                return true;
        }
        return false;
    }
}
