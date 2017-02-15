package org.made.neohabitat;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.server.context.User;
import org.elkoserver.json.JSONLiteral;

/**
 * an Elko Habitat superclass to handle Coin-operated devices.
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 */
public abstract class Coinop extends HabitatMod {

	/** A server-only field. How many tokens has this coin operated device taken in? */
	protected int take = 0;

	public Coinop(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
			OptInteger take) {
		super(style, x, y, orientation, gr_state);
		this.take = take.value(0);
	}

	public JSONLiteral encodeCoinop(JSONLiteral result) {
		result = super.encodeCommon(result);
		if (result.control().toRepository()) {
			result.addParameter("take", take);
		}
		return result;
	}
	
	public void addToTake(int amount) {
		take += amount;
		gen_flags[MODIFIED] = true;	
	}
}
