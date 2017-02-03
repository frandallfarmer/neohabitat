package org.made.neohabitat;

import java.util.Arrays;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.JSONLiteral;

/**
 * an Elko Habitat superclass to handle all kinds of signs
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 * There are no default verb methods here, as this field is simply interrogated
 * by other operations.
 */
public abstract class Poster extends HabitatMod {

	/** The message to display on this sign */
	private int ascii[];
	
	public void setTextBytes(String text) {
		for (int i = 0; i < text.length() && i < ascii.length; i++) {
			this.ascii[i] = (int) (text.charAt(i));
		}
	}
	
	public Poster(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
			OptString text, int[] ascii, int textLen) {
		super(style, x, y, orientation, gr_state);
		this.ascii = new int[textLen];
		Arrays.fill(this.ascii, 32);
		if (text.present()) {
			setTextBytes(text.value());
		} else {
			System.arraycopy(ascii, 0, this.ascii, 0, Math.min(ascii.length, this.ascii.length));
		}
	}

	public JSONLiteral encodePoster(JSONLiteral result) {
        result = super.encodeCommon(result);        
		result.addParameter("ascii", ascii);
		return result;
	}


}
