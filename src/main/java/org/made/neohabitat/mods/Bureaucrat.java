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

/**
 * Habitat Bureaucrat Mod 
 * 
 * Your basic Habitat civil servant.
 * The bureaucrat-in-a-box is a special type of Oracle.
 * It is a container that can hold one thing, which
 * should be a head. The head is displayed as the 
 * bureaucrat's face.
 *
 *
 * @author TheCarlSaganExpress
 *
 */
public class Bureaucrat extends Openable implements Copyable, Runnable {
        
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
    
    public String candidate1 = "";
    public String candidate2 = "";
    public String eventText  = "";
    public int candidateVote1 = 0;
    public int candidateVote2 = 0;
    public int minutes        = 1;
    public boolean isRunning = false;
            
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "open_flags", "key_lo", "key_hi" })
    public Bureaucrat(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger open_flags, OptInteger key_lo, OptInteger key_hi) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi, new OptInteger(0));
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
            switch(gr_state) { //Use the gr_state to differentiate the bureaucrats
            case 0:
                switch(command) {
                case "PROPERTY:":
                    remainder = remainder.replace('{', '_');
                    avatar.turf = remainder;
                    object_say(from, "You now live at " + avatar.turf);
                    break;
                default:
                    object_say(from, noid, "I'm the PA bureaucrat. Please proceed your message with SEND:");
                }
                break;
            case 1:
                switch(command) {
                case "CANDIDATE1:":
                    if(remainder.toLowerCase().equals("me")) {
                        candidate1 = from.name();
                    }
                    else
                        candidate1 = remainder;
                    object_say(from, noid, "The first candidate is " + candidate1);
                    break;
                case "CANDIDATE2:":
                    if(remainder.toLowerCase().equals("me")) {
                        candidate2 = from.name();
                    }
                    else
                        candidate2 = remainder;
                    object_say(from, noid, "The second candidate is " + candidate2);
                    break;
                case "WHO:":
                    object_say(from, noid, "It is " + candidate1 + " VS " + candidate2);
                    break;
                case "VOTE:":
                    if(remainder.equals(candidate1)) {
                        object_say(from, noid, "You voted for " + candidate1 + ". This message is private.");
                        candidateVote1++;
                    }
                    else if(remainder.equals(candidate2)) {
                        object_say(from, noid, "You voted for " + candidate2 + ". This message is private.");
                        candidateVote2++;
                    }
                    else
                        object_say(from, noid, "That is not a real candidate.");
                    break;
                case "BALLOT:":
                    object_say(from, noid, candidate1 + ": " + candidateVote1 + " " + candidate2 + ": " + candidateVote2);
                    break;
                case "RESET:":
                    candidate1 = "";
                    candidate2 = "";
                    candidateVote1 = 0;
                    candidateVote2 = 0;
                    break;
                default:
                    bureaucrat_HELP(from, 1);
                }
                break;
            case 2:
                switch(command) {
                case "COMPLAINT:":
                    if (remainder.length() > 0) {
                        message_to_god(this, avatar, remainder);
                        object_say(from, noid, "Mmm hmm. Well, we'll just see what we can do.");
                    }
                    break;
                default:
                    bureaucrat_HELP(from, 2);
                }
                break;
            case 3:
                switch(command) {
                case "SEND:":
                    if (remainder.length() > 0) {
                        Region.tellEveryone("Public Announcement on behalf of " + from.name() + ":", false);
                        Region.tellEveryone(remainder, true);
                    } 
                    break;
                case "MOTD:":
                    Region.SET_MOTD(from, remainder);
                    break;
                case "TIME:":
                    if (remainder.matches("[0-9]+") && !isRunning) {
                        minutes = Integer.parseInt(remainder);
                        object_say(from, noid, "Annoucement set for " + minutes + " minute(s) from now.");
                    }
                    else
                        object_say(from, noid, "You may only enter a number for the TIME: command.");
                    break;
                case "TEXT:":
                    eventText = remainder;
                    object_say(from, noid, "Event text has been set!");
                    break;
                case "START:":
                    if(!isRunning) {
                        isRunning = true;
                        Region.tellEveryone("A public event by " + from.name() + " will start " + minutes + " minutes from now.", false);
                        context().scheduleContextEvent(minutes * 1000 * 60, this); //TODO: Replace with actual timers
                    }
                    else
                        object_say(from, noid, "A timer is already running!");
                    break;
                default:
                    bureaucrat_HELP(from, 0);
                }
                break;
            }
        }
    }

    @JSONMethod({ "text" })
    public void ASK(User from, OptString text) {
        bureaucrat_ASK(from, text);
    }
    
    public void bureaucrat_HELP(User from, int count) {
        final String help_messages[] = { "ERROR: Must enter a message to announce an event.", /* 0 */
                "The commands are- CANDIDATE1:, CANDIDATE2:, WHO:, VOTE:, BALLOT:, RESET:", /* 1 */
                "Please proceed your message with COMPLAINT:", /* 2 */
                "Please proceed your message with SEND:, MOTD: TIME:, TEXT:, or START:", /* 3 */
        };
        object_say(from, help_messages[count]);
    }
    
    @JSONMethod
    public void HELP(User from) {
        generic_HELP(from);
    }

    @Override
    public void run() {
        Region.tellEveryone(eventText, true);
        isRunning = false;
    }
}
