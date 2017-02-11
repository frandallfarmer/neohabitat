package org.made.neohabitat;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.server.context.User;
import org.made.neohabitat.mods.Avatar;
import org.elkoserver.json.JSONLiteral;

/**
 * an Elko Habitat superclass for Oracular objects - you can talk to them!
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 */
public abstract class Oracular extends HabitatMod {

	/** The weight of this object - only ever 1 (immobile) or 0 (portable) */
	protected int live = 0;

	public Oracular(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
			OptInteger live) {
		super(style, x, y, orientation, gr_state);
		this.live = live.value(0);
	}

	public JSONLiteral encodeOracular(JSONLiteral result) {
		result = super.encodeCommon(result);
		if (result.control().toRepository()) {
			result.addParameter("live", live);
		}
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

	public void generic_ASK(User from, OptString text) {
		String question = text.value("");
		Avatar avatar   = (Avatar) from.getMod(Avatar.class);
		if (question.toLowerCase().indexOf("to:") == 0) {
			object_say(from, "I don't do ESP.  Point somewhere else.");
		} else {
			if (question.length() < 4) 
				question = " " + question + " ";
			object_say(from, avatar.noid, question);
			message_to_god(this, avatar, question);
			if (this.HabitatClass() == CLASS_FOUNTAIN) {
				object_say(from, noid, "Someday, I'll see what I can do.");
				if (question.toLowerCase().equals("willy willy nilly billy")) {
					object_say(from, noid, "That IS the correct phrase.");
				}
				if (avatar.curse_type > 0) {
					object_say(from, noid, "By the way, to remove the curse you must give it to someone else." );
				}
			}
		}
	}

}
