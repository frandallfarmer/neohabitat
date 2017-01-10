package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Sign Mod (attached to an Elko Item.)
 * 
 * It's a sign that displays text.
 * 
 * @author randy
 *
 */
public class Sign extends HabitatMod {
		
	public int		HabitatClass 	 () { return CLASS_SIGN; }
	public String	HabitatModName	 () { return "Sign"; }
	public int		capacity 		 () { return 0; }
	public int		pc_state_bytes 	 () { return 40; };
	public boolean	known 			 () { return true; }
	public boolean	opaque_container () { return false; }
	public boolean	filler 			 () { return false; }

	/** The message to display on this sign */
	public String	text;
	
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "text" })  
	public Sign(OptInteger style, OptInteger x, OptInteger y,
			OptInteger orientation, OptInteger gr_state,
			OptString text) {
		super(style, x, y, orientation, gr_state);
		this.text = text.value("Sign is missing 40 characacters of text.");
	}

	@Override
	public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("text", text);
        result.finish();
        return result;
	}

}
