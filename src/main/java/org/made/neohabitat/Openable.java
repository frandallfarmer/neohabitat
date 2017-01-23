package org.made.neohabitat;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.mods.Key;

/**
 * an Elko Habitat superclass to handle container open/closed and
 * locked/unlocked states.
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 * There are generic support functions here for handling opening and closing a
 * container as well as locking and unlocking it (which requires a matching
 * KEY.)
 */
public abstract class Openable extends Container {
    
    /** Flags for open/closed and locked/unlocked states */
    protected boolean open_flags[] = new boolean[32];
    
    /**
     * Least significant byte in a 16 bit value to match against a key in order
     * to lock/unlock the item.
     */
    protected int     key_lo       = 0;
    
    /**
     * Most significant byte in a 16 bit value to match against a key in order
     * to lock/unlock the item.
     */
    protected int     key_hi       = 0;
    
    public Openable(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger open_flags, OptInteger key_lo, OptInteger key_hi) {
        super(style, x, y, orientation, gr_state);
        if (open_flags.value(-1) != -1) {
            this.open_flags = unpackBits(open_flags.value());
        }
        this.key_lo = key_lo.value(0);
        this.key_hi = key_hi.value(0);
    }
    
    public JSONLiteral encodeOpenable(JSONLiteral result) {
        result = super.encodeCommon(result);
        if (0 != packBits(open_flags)) {
            result.addParameter("open_flags", packBits(open_flags));
        }
        if (0 != key_lo) {
            result.addParameter("key_lo", key_lo);
        }
        if (0 != key_hi) {
            result.addParameter("key_hi", key_hi);
        }
        return result;
    }
    
    /**
     * Verb (Openable): Close [and lock] this container.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void CLOSECONTAINER(User from) {
        generic_CLOSECONTAINER(from);
    }
    
    /**
     * Verb (Openable): Open [and unlock] this container.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void OPENCONTAINER(User from) {
        generic_OPENCONTAINER(from);
    }
    
    /**
     * A generic HELP verb for containers that can open/close/lock/unlock.
     * 
     * @param from
     *            User representing the connection making the request.
     * @param item_name
     *            Each class will pass it's name (i.e. "Box") to customize this
     *            message.
     * @param key_number
     *            Combined value of key_lo and key_hi
     * @param open_flags
     *            The containers open/closed/locked/unlocked state.
     */
    public void lock_HELP(User from, String item_name, int key_number, boolean[] open_flags) {
        String msg = item_name + ": DO while standing next to it to open, close (it is ";
        if (open_flags[OPEN_BIT])
            msg = msg + "open now).";
        else
            msg = msg + "closed now).";
        if (key_number != 0) {
            msg = msg + "  Uses key #" + key_number;
            if (open_flags[UNLOCKED_BIT])
                msg = msg + " but is currently unlocked.";
            else
                msg = msg + " and is currently locked.";
        }
        send_reply_msg(from, msg);
    }
    
    /**
     * Attempt to open [and lock] this container.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void generic_OPENCONTAINER(User from) {
        HabitatMod held = ((Container) avatar(from)).contents(HANDS);
        boolean have_key = (held != null) && (held.HabitatClass() == CLASS_KEY)
                && (((Key) held).key_number_hi == key_hi) && (((Key) held).key_number_lo == key_lo);
        if (!open_flags[OPEN_BIT] && // OPEN
                (have_key || open_flags[UNLOCKED_BIT]) && // Holding Key OR
                                                          // UNLOCKED
                container().noid == THE_REGION) { // IN THE REGION (and nothing
                                                  // else.)
            open_flags[OPEN_BIT] = true; // TODO Not sure why setting the
                                         // following state wasn't here in the
                                         // original.
            open_flags[UNLOCKED_BIT] = true;
            gr_state = 1;
            gen_flags[MODIFIED] = true;
            checkpoint_object(this);
            send_reply_success(from); // TODO This reply wasn't here in the
                                      // original. Why?
            get_container_contents(from);
        } else {
            object_say(from, noid, "It is locked.");
            send_reply_error(from); // TODO This reply wasn't here in the
                                    // original. Why?
        }
    }
    
    /**
     * Attempt to close [and lock] this container.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void generic_CLOSECONTAINER(User from) {
        HabitatMod held = ((Container) avatar(from)).contents(HANDS);
        boolean have_key = (held != null) && (held.HabitatClass() == CLASS_KEY)
                && (((Key) held).key_number_hi == key_hi) && (((Key) held).key_number_lo == key_lo);
        
        if (open_flags[OPEN_BIT]) {
            open_flags[OPEN_BIT] = false;
            open_flags[UNLOCKED_BIT] = !have_key;
            gr_state = 0;
            gen_flags[MODIFIED] = true;
            checkpoint_object(this);
            send_neighbor_msg(from, this.noid, "CLOSECONTAINER$", "cont", noid, "open_flags", packBits(open_flags));
            close_container(from);
            send_reply_success(from);
        } else
            send_reply_error(from);
    }
    
}
