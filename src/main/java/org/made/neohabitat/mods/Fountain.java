package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Oracular;

/**
 * Habitat Fountain Mod (attached to an Elko Item.)
 * 
 * You can ask the Oracle Fountain things. It's really lazy and rarely answers.
 * 
 * @author randy
 *
 */
public class Fountain extends Oracular {
    
    public int HabitatClass() {
        return CLASS_FOUNTAIN;
    }
    
    public String HabitatModName() {
        return "Fountain";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 0;
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "live" })
    public Fountain(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger live) {
        super(style, x, y, orientation, gr_state, live);
    }
    
    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOracular(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

	/**
	 * Verb (Specific): TODO Ask of the Oracle!
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param text
	 *            The string to ask!
	 */
    @Override
	@JSONMethod({ "text" })
	public void ASK(User from, OptString text) {
		generic_ASK(from, text);
	}
    
}
