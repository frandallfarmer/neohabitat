
package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Magical;

/**
 * Habitat Knick_knack Mod (attached to an Elko Item.)
 * 
 * The Knick_knack is a potentially magical room prop. It's isn't 
 * portable and most of them *aren't* magical at all. See HELP 
 * for descriptions.
 * 
 * @author randy
 *
 */

public class Knick_knack extends Magical {

	public int		HabitatClass 	 () { return CLASS_KNICK_KNACK; }
	public String	HabitatModName	 () { return "Knick_knack"; }
	public int		capacity 		 () { return 0; }
	public int		pc_state_bytes 	 () { return 7; };
	public boolean	known 			 () { return true; }
	public boolean	opaque_container () { return false; }
	public boolean	filler 			 () { return false; }

	/**
	 *  Constructor.
	 *  
	 * See the @see Magical constructor for documentation on state.
	 * 
	 * Knick-knacks have no additional state beyond being potentially magical.
	 * 
	 */

	@JSONMethod({ "style", "x", "y","orientation", "gr_state", "magic_type", "charges", "magic_data", "magic_data2", "magic_data3", "magic_data4", "magic_data5"})   
	public Knick_knack (
			OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
			OptInteger magic_type, OptInteger charges, OptInteger magic_data, OptInteger magic_data2,
			OptInteger magic_data3, OptInteger magic_data4, OptInteger magic_data5 ) {
		super(style, x, y, orientation, gr_state,
				magic_type, charges, magic_data, magic_data2, magic_data3, magic_data4, magic_data5);
		/* knick_knacks don't have any additional state beyond being potentially magical */
	}

	@Override
	public JSONLiteral encode(EncodeControl control) {
		JSONLiteral result = super.encodeMagical(new JSONLiteral(HabitatModName(), control));
		result.finish();
		return result;
	}
	
	public void TEST (User from) {
		charges = charges - 1;
	    gen_flags[MODIFIED] = true;
		checkpoint_object(this);
		trace_msg("Checkpointed " + HabitatModName() + " " + object().name() + " charges = " + charges);
	}
	
	/**
	 * Verb (Specific): Get HELP for this.
	 * 
	 * @param from User representing the connection making the request.
	 */
	@JSONMethod
	public void HELP (User from)	{ knick_knack_HELP(from); }

	/**
	 * Verb (Generic): Pick this item up.
	 * 
	 * @param from User representing the connection making the request.
	 */
	@JSONMethod
	public void GET (User from)	{ generic_GET(from); }


	/**
	 * Verb (Generic): Put this item into some container or on the ground.
	 * 
	 * @param from User representing the connection making the request.
	 * @param containerNoid The Habitat Noid for the target container THE_REGION is default.
	 * @param x If THE_REGION is the new container, the horizontal position. Otherwise ignored.
	 * @param y If THE_REGION: the vertical position, otherwise the target container slot (e.g. HANDS/HEAD or other.)
	 * @param orientation The new orientation for the object being PUT.
	 */
	@JSONMethod ({"containerNoid", "x", "y", "orientation"})
	public void PUT (User from,
			OptInteger containerNoid,
			OptInteger x,
			OptInteger y,
			OptInteger orientation)	{
		generic_PUT(from,
				containerNoid.value(THE_REGION),
				x.value(avatar(from).x), 
				y.value(avatar(from).y),
				orientation.value(avatar(from).orientation));
	}

	/**
	 * Verb (Generic): Throw this across the Region
	 * 
	 * @param from User representing the connection making the request.
	 * @param x Destination horizontal position
	 * @param y Destination vertical position (lower 7 bits) 
	 */
	@JSONMethod ({"targetNoid", "x", "y"})
	public void THROW (User from,
			int targetNoid, int x, int y) { 
		generic_THROW(from, targetNoid, x, y);
	}

	/**
	 * Verb (Magical): Magic activation
	 * 
	 * @param from User representing the connection making the request. 
	 * @param target The noid of the object being pointed at in case the magic effects it!
	 */
	@JSONMethod({"target"})
	public void MAGIC (User from, OptInteger target)	{ super.MAGIC(from, target);  }

	/**
	 * Reply with the knick_knack description, and if if magical, display that as well.
	 * 
	 * @param from User representing the connection making the request. 
	 */
	public void knick_knack_HELP (User from) {

		final String[] kkhelp_strings = {
				/*  0 */  "This is a candelabra, but it doesn't work.",
				/*  1 */  "The Voorzhimmer Award for Distinguishable Service",  /* trophy */
				/*  2 */  "Carol's Tacky Knick-Knack Industries, Inc.",  /* knick-knack */
				/*  3 */  "Bernie's Floral Junk Shop, Quantumgrad",  /* vase of flowers */
				/*  4 */  "Juggle 'til you drop!",  /* juggling balls */
				/*  5 */  "Chainsaw (out of gas)",
				/*  6 */  "This is Aloysius",  /* teddy bear */
				/*  7 */  "Rubber ducky",
				/*  8 */  "Answering machine.  (Not much good without a telephone).",
				/*  9 */  "Telephone.  I don't know how this got here.  There are no telephones in Habitat.",
				/* 10 */  "Towel.  Now you know where your towel is!",
				/* 11 */  "Microphone.  If you TALK while holding this, everyone in the region will hear you.",
				/* 12 */  "Yuck!",  /* road pizza */
				/* 13 */  "Cup.  Holds your place in the conversation."
		};

		String result = "";

		if (0 <= style && style <= 13) { 
			result = kkhelp_strings[style];
		} else {
			result = "This is some kind of knick-knack.";
		}
		if (magic_type != 0) {
			result += " It's magic!";
		}
		send_reply_msg(from, result);
		if (magic_type != 0) {
			object_say(from, noid, magic_vendo_info(/* magic_type */));
		}
	}

}
