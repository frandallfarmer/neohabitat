package org.made.neohabitat;

import java.util.Arrays;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.JSONLiteral;

/**
 * an Elko Habitat superclass to handle seating
 * 
 * NOTE: This is part of a work-around. The Original habitat allowed Avatars 
 * to be contained by objects. Elko does not. So, with the help of the 
 * Bridge, we're going to pretend it works that way by keeping track of the
 * seated avatars seperately.
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 * There are no default verb methods here, as this field is simply interrogated
 * by other operations.
 */
public abstract class Seating extends Openable {

	/** This state is never persisted, but used by the Bridge to sort out the contents vector */
	public int sitters[] = {0, 0};

	public Seating(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
			OptInteger open_flags) {
		super(style, x, y, orientation, gr_state, open_flags);
	}

	public JSONLiteral encodeSeating(JSONLiteral result) {
		result = super.encodeOpenable(result); 
		if (result.control().toClient()) {
			result.addParameter("sitters", Arrays.copyOfRange(sitters, 0, this.capacity()));
		}
		return result;
	}

}
