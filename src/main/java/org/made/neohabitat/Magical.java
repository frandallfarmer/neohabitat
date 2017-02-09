package org.made.neohabitat;

import java.util.regex.Pattern;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.mods.Avatar;
import org.made.neohabitat.mods.Region;

/**
 * an Elko Habitat superclass to handle magic state and specific behaviors.
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 */
public abstract class Magical extends HabitatMod {
    
    /** An index to the magic method to call for this item. 0 == not magical. */
    protected int magic_type  = 0;
    /** How many more times can this magical item be activated? */
    protected int charges     = 0;
    /** Per-type magic state - true type to be bound at execution time */
    protected int magic_data  = 0;
    /** Per-type magic state - true type to be bound at execution time */
    protected int magic_data2 = 0;
    /** Per-type magic state - true type to be bound at execution time */
    protected int magic_data3 = 0;
    /** Per-type magic state - true type to be bound at execution time */
    protected int magic_data4 = 0;
    /** Per-type magic state - true type to be bound at execution time */
    protected int magic_data5 = 0;
    
    public Magical(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger magic_type, OptInteger charges, OptInteger magic_data, OptInteger magic_data2,
            OptInteger magic_data3, OptInteger magic_data4, OptInteger magic_data5) {
        super(style, x, y, orientation, gr_state);
        this.magic_type = magic_type.value(0);
        this.charges = charges.value(0);
        this.magic_data = magic_data.value(0);
        this.magic_data2 = magic_data2.value(0);
        this.magic_data3 = magic_data3.value(0);
        this.magic_data4 = magic_data4.value(0);
        this.magic_data5 = magic_data5.value(0);
    }
    
    public JSONLiteral encodeMagical(JSONLiteral result) {
        result = super.encodeCommon(result);
        if (0 != magic_type) {
            result.addParameter("magic_type", magic_type);
        }
        if (0 != charges) {
            result.addParameter("charges", charges);
        }
        if (0 != magic_data) {
            result.addParameter("magic_data", magic_data);
        }
        if (0 != magic_data2) {
            result.addParameter("magic_data2", magic_data2);
        }
        if (0 != magic_data3) {
            result.addParameter("magic_data3", magic_data3);
        }
        if (0 != magic_data4) {
            result.addParameter("magic_data4", magic_data4);
        }
        if (0 != magic_data5) {
            result.addParameter("magic_data5", magic_data4);
        }
        return result;
    }
    
    /** The number of magical methods available. NOTE: This is expandable */
    private final static int NUMBER_OF_MAGICS = 29; /* This should grow! */
    
    /**
     * Verb (Magical): Activate any magic on this, if there are charges left.
     * 
     * @param from
     *            User representing the connection making the request.
     * @param target
     *            TODO Why would we trust the client to specify a magic type?
     */
    @JSONMethod({ "target" })
    public void MAGIC(User from, OptInteger target) {
        JSONLiteral msg = new JSONLiteral("changeposture", EncodeControl.forClient);
        msg.addParameter("noid", avatar(from).noid);
        msg.addParameter("newposture", OPERATE);
        context().sendToNeighbors(from, msg);
        HabitatMod targetMod = current_region().noids[target.value(0)];
        switch (magic_type) {
            case 0:
                /* not magical */
                break;
            case 1:
                magic_default(from, targetMod);
                break;
            case 2:
                make_target_avatar_jump(from, targetMod);
                break;
            case 3:
                magic_default(from, targetMod);
                break;
            case 4:
                magic_default(from, targetMod);
                break;
            case 5:
                magic_default(from, targetMod);
                break;
            case 6:
                magic_default(from, targetMod);
                break;
            case 7:
                magic_default(from, targetMod);
                break;
            case 8:
                magic_default(from, targetMod);
                break;
            case 9:
                magic_default(from, targetMod);
                break;
            case 10:
                magic_default(from, targetMod);
                break;
            case 11:
                magic_default(from, targetMod);
                break;
            case 12:
                magic_default(from, targetMod);
                break;
            case 13:
                magic_default(from, targetMod);
                break;
            case 14:
                magic_default(from, targetMod);
                break;
            case 15:
                magic_default(from, targetMod);
                break;
            case 16:
                magic_default(from, targetMod);
                break;
            case 17:
                god_tool(from, targetMod);
                break;
            case 18:
                magic_default(from, targetMod);
                break;
            case 19:
                magic_default(from, targetMod);
                break;
            case 20:
                magic_default(from, targetMod);
                break;
            case 21:
                magic_default(from, targetMod);
                break;
            case 22:
                magic_default(from, targetMod);
                break;
            case 23:
                magic_default(from, targetMod);
                break;
            case 24:
                magic_default(from, targetMod);
                break;
            case 25:
                magic_default(from, targetMod);
                break;
            case 26:
                magic_default(from, targetMod);
                break;
            case 27:
                magic_default(from, targetMod);
                break;
            case 28:
                magic_default(from, targetMod);
                break;
            case 29:
                magic_default(from, targetMod);
                break;
        }
    }
    
    private boolean expendCharge(User from) {
        if (charges == 0) {
            object_say(from, noid, "This device is out of charge.");
            return false;
        }
        charges = charges - 1;
        gen_flags[MODIFIED] = true;
        checkpoint_object(this);
        return true;
    }
    
    private void magic_default(User from, HabitatMod target) {
        if (expendCharge(from)) {
            object_broadcast(noid, ">BAMPF<");
            send_reply_success(from);
        } else {
            send_reply_error(from);
        }
    }
    
    private void make_target_avatar_jump(User from, HabitatMod target) {
        if (target.HabitatClass() == CLASS_AVATAR && expendCharge(from)) {
            object_broadcast(noid, "Ha!");
            if (magic_data < AV_ACT_stand || magic_data > AV_ACT_sit_front) {
                send_broadcast_msg(target.noid, "POSTURE$", "new_posture", AV_ACT_jump);
            } else {
                send_broadcast_msg(target.noid, "POSTURE$", "new_posture", magic_data);
            }
            send_reply_success(from);
            return;
        } else {
            object_say(from, "Nothing happens.");
            send_reply_error(from);
        }
    }
    
    private String identifyTarget(HabitatMod target) {
        return "" + target.noid + ":" + target.obj_id();
    }
    
    private void god_tool(User from, HabitatMod target) {
        Avatar avatar = avatar(from);
        avatar.savedTarget = target; // Save the target for future GOD TOOL
                                     // commands. Does not persist.
        avatar.savedMagical = this; // We have to return to this object to keep
                                    // running GOD commands.
        if (!avatar.nitty_bits[GOD_FLAG]) {
            object_say(from, "Nothing happens.");
            message_to_god(this, avatar, "UNAUTHORIZED USE OF A GOD TOOL!");
            send_reply_error(from);
        } else {
            object_say(from, identifyTarget(target) + " - Remember to exit GOD MODE before changing regions.");
            send_private_msg(from, THE_REGION, from, "PROMPT_USER_$", GOD_TOOL_PROMPT + " ");
            send_reply_success(from);
        }
    }
    
    private void modify_variable(User from, HabitatMod target, int offset, int new_value) {
        target.gen_flags[MODIFIED] = true;
        send_broadcast_msg(THE_REGION, "FIDDLE_$", "target", target.noid, "offset", offset, "argCount", 1, "value",
                new_value);
    }
    
    /**
     * CALLBACK for the GOD TOOL - it must reconstruct the context for
     * interpretation from an earlier request.
     * 
     * @param from
     *            The user holding the magical GOD TOOL object, and pointing at
     *            avatar.saveTargetNoid.
     */
    public void god_tool_revisited(User from, String request_string) {
        Avatar avatar = avatar(from);
        HabitatMod target = avatar.savedTarget;
        if (null == target || !avatar.nitty_bits[GOD_FLAG]) {
            object_say(from, "Nothing happens.");
            message_to_god(this, avatar, "UNAUTHORIZED USE OF A GOD TOOL!");
            send_reply_error(from);
            return;
        }
        int len = request_string.length();
        if (len > 0) {
            char command = request_string.charAt(0);
            int arg = 1;
            if (len > 1 && Pattern.matches("[0-9]+", request_string.substring(1))) {
                arg = Integer.parseInt(request_string.substring(1));
            }
            if (command != 'j') {
            	send_private_msg(from, THE_REGION, from, "PROMPT_USER_$", GOD_TOOL_PROMPT + " ");
            }
            switch (command) {
                case ARROW_R: // Move right 1 or more pixels
                    target.x += arg;
                    modify_variable(from, target, C64_XPOS_OFFSET, target.x);
                    break;
                case ARROW_L: // Move left 1 or more pixels
                    target.x -= arg;
                    modify_variable(from, target, C64_XPOS_OFFSET, target.x);
                    break;
                case ARROW_U: // Move up 1 or more pixels
                    target.y += arg;
                    modify_variable(from, target, C64_YPOS_OFFSET, target.y);
                    break;
                case ARROW_D: // Move down 1 or more pixels
                    target.y -= arg;
                    modify_variable(from, target, C64_YPOS_OFFSET, target.y);
                    break;
                case 'b': // Put object in background
                    target.y &= ~FOREGROUND_BIT;
                    modify_variable(from, target, C64_YPOS_OFFSET, target.y);
                    break;
                case 'f': // Put object in foreground
                    target.y |= FOREGROUND_BIT;
                    modify_variable(from, target, C64_YPOS_OFFSET, target.y);
                    break;
                case 's': // Set gr_state to arg's value
                    target.gr_state = arg;
                    modify_variable(from, target, C64_GR_STATE_OFFSET, arg);
                    break;
                case 'o': // Flip orientation left/right
                    target.orientation ^= 0b00000001;
                    modify_variable(from, target, C64_ORIENT_OFFSET, target.orientation);
                    break;
                case 'p': // Set pattern (arg 0-14)
                    target.orientation = (target.orientation & FACING_BIT) | (arg << 3 & PATTERN_BITS) & BYTE_MASK;
                    modify_variable(from, target, C64_ORIENT_OFFSET, target.orientation);
                    break;
                case 'c': // Set color (arg 0-63)
                    target.orientation = (target.orientation & FACING_BIT) | (COLOR_FLAG)
                            | (arg << 3 & COLOR_BITS) & BYTE_MASK;
                    modify_variable(from, target, C64_ORIENT_OFFSET, target.orientation);
                    break;
                
                case 'd': // dump object
                    object_say(from, identifyTarget(target));
                    String dump = target.encode(EncodeControl.forRepository).toString();
                    dump = dump.substring(1, dump.length() - 1);
                    int start = 0; // Offset in JSON string dump
                    int countdown = 2; // Word balloons before we give up
                                       // sending...
                    String chunk;
                    while (start < dump.length() && countdown > 0) {
                        chunk = dump.substring(start);
                        if (chunk.length() > MAX_WORD_BALLON_LEN) {
                            chunk = chunk.substring(0, MAX_WORD_BALLON_LEN);
                        }
                        if (start + chunk.length() < dump.length()) {
                            chunk = chunk.substring(0, chunk.lastIndexOf(',') + 1);
                        }
                        object_say(from, chunk);
                        start += chunk.length();
                        if (--countdown == 0) {
                            object_say(from, "...");
                        }
                    }
                    break;
                case 't': // Set text field value
                    int textlen = (target.HabitatClass() == CLASS_SIGN) ? 40
                            : (target.HabitatClass() == CLASS_SHORT_SIGN) ? 10 : 0;
                    if (textlen > 0) {
                        String workstring = request_string.substring(1);
                        if (workstring.length() > textlen) {
                            return;
                        }
                        while (workstring.length() < textlen) {
                            StringBuffer sbuf = new StringBuffer(workstring);
                            while (sbuf.length() < textlen) {
                                sbuf.append(' ');
                            }
                            workstring = sbuf.toString();
                        }
                        JSONLiteral msg = new_broadcast_msg(THE_REGION, "FIDDLE_$");
                        msg.addParameter("target", target.noid);
                        msg.addParameter("offset", C64_TEXT_OFFSET);
                        msg.addParameter("argCount", textlen);
                        msg.addParameter("value", workstring);
                        msg.finish();
                        context().send(msg);
                        ((Poster) target).setTextBytes(workstring);
                        target.gen_flags[MODIFIED] = true;
                    }
                    break;
                case 'n': // enter god mode on a noid (useful for unclickable
                          // objects)
                    HabitatMod new_target = current_region().noids[arg];
                    god_tool(from, new_target);
                    return;
                case 'l': // List of all the objects in the region, by noid
                    for (HabitatMod item : current_region().noids) {
                        if (item != null) {
                            object_say(from, identifyTarget(item));
                        }
                    }
                    break;
                case 'j':
                	String context = request_string.substring(1);
                	if (context.indexOf('-') == -1) {
                		context = "context-" + context;
                	}
                	context = context.replace('{', '_');			// There is no underscore in VICE
                    send_reply_error(from);							// Need to clear the GOD MODE flag on the client.
                    avatar.savedMagical = null;
                    avatar.savedTarget = null;              	
                	avatar.x = 80;
                	avatar.y = 132;
                	avatar.markAsChanged();
                	avatar.change_regions(context, AUTO_TELEPORT_DIR, TELEPORT_ENTRY);
                	break;
                case '?':
                case 'h':
                    object_say(from, "?-help l-list d-dump f-forgrnd b-back");
                    object_say(from, "o-flip  c#-color  p#-pattern  n#-noid");
                    object_say(from, "s#-gr.state  " + (char) ARROW_U + (char) ARROW_D + (char) ARROW_L + (char) ARROW_R
                            + "#-move jCONTEXT-jump");
                    object_say(from, "tTEXT - sign                         ");
                    break;
            }
            return;
        }
        avatar.savedMagical = null;
        avatar.savedTarget = null;
    }
    
    /** The messages describing each magical type */
    private static final String magic_help[] = { "Down, down, down, down takes you up.",
            /* 1 -- change_user_height */
            "Twylla probably wouldn't be amused.",
            /* 2 -- make_target_avatar_jump */
            "You got me singing the blues...",
            /* 3 -- make_other_avatars_turn_blue */
            "Home is where the target is.",
            /* 4 -- send_target_avatar_home */
            "Cryptic remark!",
            /* 5 -- not yet used? */
            "Oooh!  Don't press this button!!",
            /* 6 -- switch_give_user_cooties */
            "CAPTURE-THE-FLAG: Press button to reset flags.",
            /* 7 -- switch_start_end_capture_flag */
            "Press button to win Region Rally",
            /* 8 -- switch_region_rally_winner */
            "Going in style!",
            /* 9 -- change_avatar_style */
            "BUZZ!",
            /* 10 -- switch_gameshow_buzzer */
            "Everybody's talking about a new way of walking!",
            /* 11 -- make_user_moonwalk */
            "CHESS: Press button to reset board",
            /* 12 -- switch_reset_chess */
            "CHECKERS: Press button to reset board",
            /* 13 -- switch_reset_checkers */
            "BACKGAMMON: Press button to reset board",
            /* 14 -- switch_reset_backgammon */
            "Amulet Of Wonderous Worth. Property of DadaSalesh",
            /* 15 -- recover_amulet */
            "Press button to vote.",
            /* 16 -- vote in election */
            "God Tool: If Found, Dispose of immediately. Severe penalty for unauthorized use ",
            /* 17 -- God Tool */
            "Publishing Machine: Cost $2 per document to bind. DO to operate",
            /* 18 -- Publishing Machine */
            "Bursting Machine: Cost $5 per page burst out of book.  DO to operate",
            /* 19 -- Bursting Machine */
            "Copy Machine: Cost $2 per page of document to copy. DO to operate",
            /* 20 -- Copy Machine */
            "Where, oh where, have you gone?",
            /* 21 -- Take me to an avatar */
            "A voice booms out:I AM THE VAULTKEEPER!",
            /* 22 -- The VaultKeeper */
            "Push once for an Item of Significance",
            /* 23 -- Free Dispenser */
            "The Money Tree",
            /* 24 -- Tokens dispenser */
            "Press me.",
            /* 25 -- Magic Opener */
            "Lottery Vendroid. Hold $50 and DO to purchase a ticket.",
            /* 26 -- lottery ticket machine */
            "Lottery Redemption Center. Hold ticket and DO to recieve $.",
            /* 27 -- lottery payoff machine */
            "DO to activate.",
            /* 28 -- death magic */
            "Try your luck."
            /* 29 -- Random Porter */
    };
    
    /**
     * Verb (Magical): Reply with the HELP for this magical item.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void HELP(User from) {
        String the_message = "Cryptic remark.";
        
        if (magic_type > 0 && magic_type <= NUMBER_OF_MAGICS) {
            the_message = magic_help[magic_type - 1];
        }
        send_reply_msg(from, the_message);
    }
    
    /**
     * Children call this to get a string describing the magical nature of this
     * the item.
     * 
     * @return Magical help string
     */
    public String magic_vendo_info() {
        if (magic_type < 1)
            return ("Dead magic item.");
        else if (magic_type > NUMBER_OF_MAGICS)
            return ("MAGIC, no information available (yet).");
        else
            return (magic_help[magic_type - 1]);
    }
    
}
