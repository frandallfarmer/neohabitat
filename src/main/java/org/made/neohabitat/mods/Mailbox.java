package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Mailbox Mod (attached to an Elko Item.)
 * 
 * In the early days of the Habitat project (1985) Chip and Randy were, like many othere since,
 * seduced by the siren song of metaphore as UI design - and so the mailbox was going to be
 * the interface to your in-game email.  This was dumb. The class is still here, but it has been 
 * stripped of all utility and is just a relic. 
 * 
 * @author Randy
 *
 */
public class Mailbox extends HabitatMod implements Copyable {
    
    public int HabitatClass() {
        return CLASS_MAILBOX;
    }
    
    public String HabitatModName() {
        return "Mailbox";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 1;					// THIS IS VESTIGIAL.
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted" })
    public Mailbox(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    public Mailbox(int style, int x, int y, int orientation, int gr_state, boolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Mailbox(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }
    
}
