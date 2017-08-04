package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Openable;


public class Bureaucrat extends Openable implements Copyable {
	  public int HabitatClass() {
	        return CLASS_BUREAUCRAT;
	    }
	    
	    public String HabitatModName() {
	        return "Bureaucrat";
	    }
	    
	    public int capacity() {
	        return 1;
	    }
	    
	    public int pc_state_bytes() {
	        return 0;
	    }
	    
	    public boolean known() {
	        return true;
	    }
	    
	    public boolean opaque_container() {
	        return false;
	    }
	    
	    public boolean changeable() { 
	        return true;
	    }

	    public boolean filler() {
	        return false;
	    }
	    	    
	    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "open_flags", "key_lo", "key_hi" })
	    public Bureaucrat(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
	              OptInteger open_flags, OptInteger key_lo, OptInteger key_hi) {
	        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
	    }

	    public Bureaucrat(int style, int x, int y, int orientation, int gr_state, boolean restricted, boolean[] open_flags, int key_lo, int key_hi) {
	        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
	    }

	    @Override
	    public HabitatMod copyThisMod() {
	        return new Bureaucrat(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
	    }

	    @Override
	    public JSONLiteral encode(EncodeControl control) {
	        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
	        result.finish();
	        return result;
	    }
	    
		public void bureaucrat_ASK(User from, OptString text) {
			String question = text.value("");
			Avatar avatar   = avatar(from);
			if (question.toLowerCase().indexOf("to:") == 0) {
				object_say(from, "I don't do ESP. Point somewhere else.");
			} 
			else {
				String command = question.split(" ")[0];
				String[] commandSplit = question.split(command);
				String remainder = "";
				if (commandSplit.length > 0) {
					remainder = commandSplit[commandSplit.length - 1].trim();
				}
				switch (command) {
				case "SEND:":
					if (remainder.length() > 0) {
						Region.tellEveryone("Public Announcement on behalf of " + from.name() + ":", false);
						Region.tellEveryone(remainder, true);
					} else {
						 bureaucrat_HELP(from, 0);
					}
					break;
				case "//bu":
				case "//bureaucrat":
					if (remainder.length() > 0) {
						message_to_god(this, avatar, remainder);
						object_say(from, noid, "Mmm hmm. Well, we'll just see what we can do.");
					} else {
						 bureaucrat_HELP(from, 1);
					}
					break;
				default:
					object_say(from, noid, "I'm the PA bureaucrat. Please proceed your message with SEND:");
			    }

	      }

		}
		
	    @JSONMethod({ "text" })
	    public void ASK(User from, OptString text) {
	    	bureaucrat_ASK(from, text);
	    }
	    
	    //To be expanded upon when more functionality is added to the bureaucrat
		public void bureaucrat_HELP(User from, int count) {
			final String help_messages[] = { "ERROR: Must enter a message to announce an event.", /* 0 */
					"ERROR: Must enter a message to talk with a bureaucrat.", /* 1 */
					"TEMP2", /* 2 */
					"TEMP3", /* 3 */
             };
			object_say(from, help_messages[count]);
		}
	    
		@JSONMethod
	    public void HELP(User from) {
			generic_HELP(from);
	    }
}
