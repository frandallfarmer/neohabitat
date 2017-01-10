package org.made.neohabitat;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.JSONLiteral;

/**
 * an Elko Habitat superclass to handle massive state.
 * 
 * 1988 PL1 didn't understand classes.
 * Chip wrote the Habitat code, simulating structures, classes, and a form of class inheritance by
 * concatenating include files and careful management of procedure references.
 * 
 * There are no default verb methods here, as this field is simply interrogated by other operations.
 */
public abstract class Massive extends HabitatMod {
	
	/** The weight of this object - only ever 1 (immobile) or 0 (portable) */
	protected int mass = 0;

	public Massive (
			OptInteger style, OptInteger x, OptInteger y,
			OptInteger orientation, OptInteger gr_state,
			OptInteger mass ) {
		super(style, x, y, orientation, gr_state);
		this.mass	= mass.value(0);
	} 

	public JSONLiteral encodeMassive(JSONLiteral result) {
		result = super.encodeCommon(result);
		if (0 != mass)	{ result.addParameter("mass", mass); }
		return result;
	}

}
