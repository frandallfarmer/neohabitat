package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Openable;

/**
 * Habitat Door Mod (attached to an Elko Item.)
 * 
 * Doors provide portals to other regions.
 * This allows for mulitple exits from a region that
 * dont' involve walking to the edge.
 * 
 * @author randy
 *
 */
public class Door extends Openable implements Copyable {
    
    public int HabitatClass() {
        return CLASS_DOOR;
    }
    
    public String HabitatModName() {
        return "Door";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 3;
    };
    
    public boolean known() {
        return true;
    }
    
    public boolean opaque_container() {
        return false;
    }
    
	public boolean  changeable		 () { return true; }

    public boolean filler() {
        return false;
    }
    
    /** The region (context-ref) that this door leads to */
    public String connection;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "open_flags", "key_lo", "key_hi", "connection" })
    public Door(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptInteger open_flags, OptInteger key_lo, OptInteger key_hi,
        String connection) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
        this.connection = connection;
    }

    public Door(int style, int x, int y, int orientation, int gr_state, boolean restricted, boolean[] open_flags, int key_lo, int key_hi,
        String connection) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
        this.connection = connection;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Door(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi, connection);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
        if (control.toRepository()) {
            result.addParameter("connection", connection);
        }
        result.finish();
        return result;
    }
    
    /**
     * Verb (Specific): Get HELP for this.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void HELP(User from) {
        lock_HELP(from, "Door", key_hi * 256 + key_lo, open_flags);
    }
    
}
