package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.*;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.User;

import org.elkoserver.util.ArgRunnable;
import org.made.neohabitat.Constants;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

import java.util.Arrays;
import java.util.Iterator;


/**
 * Habitat Paper Mod
 *
 * The Paper mod is similar to a Document; however, it can be modified
 * in-world, contains only a single page of ASCII text, and may be used
 * to send Mails to other Avatars.
 *
 * @author steve
 */
public class Paper extends HabitatMod implements Copyable {

    public static final int FROM_GROUND = 0;
    public static final int FROM_POCKET = 1;

    public static final int PAPER_BLANK_STATE = 0;
    public static final int PAPER_WRITTEN_STATE = 1;
    public static final int PAPER_LETTER_STATE = 2;

    public static final int MAX_TITLE_LENGTH = 32;

    public static final String EMPTY_PAPER_REF = "text-emptypaper";

    public static final int[] EMPTY_PAPER = new int[16];
    public static final int[] PAPER_TITLE_BEGINNING = convert_to_petscii("This paper begins \"", 24);
    public static final int[] PAPER_TITLE_ENDING = convert_to_petscii("\".", 2);

    public int HabitatClass() {
        return CLASS_PAPER;
    }

    public String HabitatModName() {
        return "Paper";
    }

    public int capacity() {
        return 0;
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

    public boolean filler() {
        return false;
    }

    /** Contains the MongoDB ref to a path of text to base an empty Paper off of. */
    private String text_path = EMPTY_PAPER_REF;

    /** Contains the current PETSCII text of the Paper, retrieved from a PaperContents record in MongoDB. */
    protected int ascii[] = EMPTY_PAPER;

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "text_path" })
    public Paper(OptInteger style, OptInteger x, OptInteger y,
        OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptString text_path) {
        super(style, x, y, orientation, gr_state, restricted);
        this.ascii = EMPTY_PAPER;
        this.text_path = text_path.value(EMPTY_PAPER_REF);
    }

    public Paper(int style, int x, int y, int orientation, int gr_state,
        boolean restricted, String text_path) {
        super(style, x, y, orientation, gr_state, restricted);
        this.ascii = EMPTY_PAPER;
        this.text_path = text_path;
    }

    public boolean is_blank() {
        return text_path.equals(EMPTY_PAPER_REF);
    }

    /**
     * Queries the DB for the state of the Paper; if none exists, attempts to create it from the
     * provided text_path, if specified.
     */
    public void objectIsComplete() {
        retrievePaperContents();
        super.objectIsComplete();
    }

    public String paper_path() {
        return String.format("paper-%s", object().ref());
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Paper(style, x, y, orientation, gr_state, restricted, text_path);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        if (control.toRepository()) {
            result.addParameter("text_path", text_path);
        }
        result.finish();
        return result;
    }

    @JSONMethod({ "page" })
    public void READ(User from, int page) {
        Avatar avatar = avatar(from);
        if (holding(avatar, this)) {
            if (!is_blank()) {
                showPaper(from);
            } else {
                showEmptyPaper(from);
            }
        } else {
            showEmptyPaper(from);
        }
    }

    @JSONMethod({ "request_ascii" })
    public void WRITE(User from, int[] request_ascii) {
        Avatar avatar = avatar(from);
        boolean success;
        boolean fiddle_flag = false;

        if (holding(avatar, this)) {
            success = true;
            // If we've been given an empty string, clears out the Paper's contents.
            if (request_ascii == null || request_ascii.length == 16) {
                trace_msg("Avatar %s requested clearing of contents for Paper %s",
                    from.name(), text_path);
                ascii = EMPTY_PAPER;
                deletePaperContents();
                if (gr_state != PAPER_BLANK_STATE) {
                    gr_state = PAPER_BLANK_STATE;
                    fiddle_flag = true;
                }
                gen_flags[MODIFIED] = true;
            } else {
                trace_msg("Avatar %s setting Paper %s contents to: %s",
                    from.name(), text_path, Arrays.toString(request_ascii));
                ascii = request_ascii;
                savePaperContents();
                gr_state = PAPER_WRITTEN_STATE;
                gen_flags[MODIFIED] = true;
            }
            checkpoint_object(this);
        } else {
            success = false;
        }

        if (success) {
            send_reply_success(from);
        } else {
            send_reply_error(from);
        }

        if (fiddle_flag) {
            trace_msg("Sending PAPER_BLANK_STATE fiddle for Paper %s", text_path);
            send_fiddle_msg(
                THE_REGION,
                noid,
                C64_GR_STATE_OFFSET,
                PAPER_BLANK_STATE
            );
        }
    }

    @JSONMethod
    public void HELP(User from) {
        if (ascii.length > 0) {
            int titleLength = ascii.length;
            if (titleLength > MAX_TITLE_LENGTH) {
                titleLength = MAX_TITLE_LENGTH;
            }
            int[] boundedAscii = new int[titleLength];
            System.arraycopy(ascii, 0, boundedAscii, 0, titleLength);
            JSONLiteral msg = new_reply_msg(noid);
            if (!is_blank()) {
                msg.addParameter("ascii",
                    concat_int_arrays(PAPER_TITLE_BEGINNING, boundedAscii, PAPER_TITLE_ENDING));
            } else {
                msg.addParameter("text", "");
            }
            msg.finish();
            from.send(msg);
        }
    }

    /**
     * Verb (Generic): Pick this item up.
     *
     * @param from User representing the connection making the request.
     */
    @JSONMethod
    public void GET(User from) {
        Avatar avatar = avatar(from);
        HabitatMod container = container(this);
        if (container.noid != avatar.noid) {
            generic_GET(from);
            return;
        }

        boolean announce_it = false;
        int how;
        boolean success;

        Item paperItem = null;

        if (empty_handed(avatar) && getable(this) &&
            accessable(this) && container.HabitatClass() != CLASS_GLUE) {
            if (container.noid == avatar.noid) {
                how = FROM_POCKET;
            } else {
                how = FROM_GROUND;
            }
            boolean special_get = (container.noid == avatar.noid &&
              position() == MAIL_SLOT);
            if (!change_containers(this, avatar, HANDS, true)) {
                trace_msg("Could not change containers to Avatar %s for Paper %s",
                    from.name(), text_path);
                send_reply_error(from);
                return;
            }
            success = true;

            // If special_get is true, we're either getting mail or creating a new Paper sheet.
            if (special_get) {
                trace_msg("Special GET is true for Paper %s, either a mail or Paper sheet creation",
                    text_path);
                Paper blankPaper = new Paper(
                    0, 0, MAIL_SLOT, 16, PAPER_BLANK_STATE, false, EMPTY_PAPER_REF);
                paperItem = create_object("paper", blankPaper, avatar, false);
                if (paperItem == null) {
                    // If this fails, put the Paper back in the Avatar's inventory.
                    change_containers(this, avatar, MAIL_SLOT, true);
                    send_reply_error(from);
                    return;
                }
                // TODO(steve): Fix this logic once PSENDMAIL is implemented.
                /*if (gr_state == PAPER_LETTER_STATE) {
                    get_mail_message(from);
                    return;
                }*/
                announce_it = true;
            }
            send_neighbor_msg(from, avatar.noid, "GET$", "target", noid, "how", how);
        } else {
            success = false;
        }

        if (success) {
            send_reply_success(from);
        } else {
            send_reply_error(from);
        }

        if (announce_it) {
            announce_object(paperItem, avatar);
        }
    }

    @JSONMethod
    public void PSENDMAIL(User from) {
        illegal(from, this.HabitatModName() + ".PSENDMAIL");
    }

    private boolean send_mail_message(User from) {
        return true;
    }

    /**
     * Verb (Generic): Put this item into some container or on the ground.
     *
     * @param from
     *            User representing the connection making the request.
     * @param containerNoid
     *            The Habitat Noid for the target container THE_REGION is
     *            default.
     * @param x
     *            If THE_REGION is the new container, the horizontal position.
     *            Otherwise ignored.
     * @param y
     *            If THE_REGION: the vertical position, otherwise the target
     *            container slot (e.g. HANDS/HEAD or other.)
     * @param orientation
     *            The new orientation for the object being PUT.
     */
    @JSONMethod({ "containerNoid", "x", "y", "orientation" })
    public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
        boolean put_success = generic_PUT(from, containerNoid.value(THE_REGION),
            x.value(avatar(from).x), y.value(avatar(from).y), orientation.value(avatar(from).orientation));
        trace_msg("PUT success for Paper %s: %b", text_path, put_success);
        if (put_success && is_blank()) {
            send_goaway_msg(noid);
            destroy_object(this);
        }
    }

    /**
     * Verb (Generic): Throw this across the Region
     *
     * @param from
     *            User representing the connection making the request.
     * @param x
     *            Destination horizontal position
     * @param y
     *            Destination vertical position (lower 7 bits)
     */
    @JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
        boolean throw_success = generic_THROW(from, target, x, y);
        trace_msg("THROW success for Paper %s: %b", text_path, throw_success);
        if (throw_success && is_blank()) {
            send_goaway_msg(noid);
            destroy_object(this);
        }
    }

    // Private classes and methods:

    /**
     * Class within which to serialize the JSON of a Paper's PETSCII contents, persisted
     * as a JSON object in MongoDB.
     */
    private class PaperContents implements Encodable {

        private int[] ascii;

        @JSONMethod({ "ascii" })
        public PaperContents(int[] ascii) {
            this.ascii = ascii;
        }

        public JSONLiteral encode(EncodeControl control) {
            JSONLiteral paper = new JSONLiteral(control);
            if (control.toRepository()) {
                paper.addParameter("ascii", ascii);
            }
            return paper;
        }

    }

    private void showPaper(User from) {
        trace_msg("Showing written Paper %s to Avatar %s", text_path, from.name());
        JSONLiteral msg = new_reply_msg(noid);
        msg.addParameter("nextpage", 0);
        msg.addParameter("ascii", ascii);
        msg.finish();
        from.send(msg);
    }

    private void showEmptyPaper(User from) {
        trace_msg("Showing empty Paper %s to Avatar %s", text_path, from.name());
        JSONLiteral msg = new_reply_msg(noid);
        msg.addParameter("nextpage", 0);
        msg.addParameter("ascii", EMPTY_PAPER);
        msg.finish();
        from.send(msg);
    }

    private void setAsciiFromTextResult(Object obj) {
        ascii = EMPTY_PAPER;
        if (obj != null) {
            Object[] args = (Object[]) obj;
            JSONArray textBlocks;
            try {
                textBlocks = ((JSONObject) args[0]).getArray("pages");
            } catch (JSONDecodingException e) {
                textBlocks = null;
            }
            // A Paper is a single Text page, so we take the first element of the "pages" array
            // if we find it within the results.
            if (textBlocks != null && textBlocks.size() > 0) {
                Iterator<Object> textPage = textBlocks.iterator();
                String text = (String) textPage.next();
                trace_msg("Obtained text for Paper at Text path %s: %s", text_path, text);
                ascii = convert_to_petscii(text, text.length());
            } else {
                // Otherwise, we take the first element of the "ascii" array, containing raw PETSCII runes.
                JSONArray byteBlocks = null;
                try {
                    byteBlocks = ((JSONObject) args[0]).getArray("ascii");
                } catch (JSONDecodingException e) {
                    return;
                }

                Iterator<Object> bytePage = byteBlocks.iterator();
                JSONArray byteArray = ((JSONArray) bytePage.next());
                Iterator<Object> chars = byteArray.iterator();

                ascii = new int[byteArray.size()];
                int i = 0;
                for (; chars.hasNext(); i++) {
                    int c = ((Double) chars.next()).intValue();
                    if (c == 0) {
                        break;
                    }
                    ascii[i] = c;
                }
                trace_msg("Obtained ASCII for Paper at Text path %s: %s",
                    text_path, Arrays.toString(ascii));
            }
        }
        if (ascii != EMPTY_PAPER) {
            if (gr_state == PAPER_BLANK_STATE) {
                gr_state = PAPER_WRITTEN_STATE;
                gen_flags[MODIFIED] = true;
                checkpoint_object(this);
            }
            // If our text reference was found, copies its contents to this Paper's contents DB reference.
            savePaperContents();
        } else {
            if (gr_state == PAPER_WRITTEN_STATE) {
                gr_state = PAPER_BLANK_STATE;
                gen_flags[MODIFIED] = true;
                checkpoint_object(this);
            }
        }
    }

    private void setAsciiFromPaperResult(Object obj) {
        ascii = EMPTY_PAPER;
        if (obj != null) {
            Object[] args = (Object[]) obj;
            JSONArray byteBlocks = null;
            try {
                JSONObject jsonObj = ((JSONObject) args[0]);
                byteBlocks = jsonObj.getArray("ascii");
            } catch (JSONDecodingException e) {
                return;
            }
            Iterator<Object> chars = byteBlocks.iterator();

            ascii = new int[byteBlocks.size()];
            int i = 0;
            for (; chars.hasNext(); i++) {
                int c = ((Long) chars.next()).intValue();
                if (c == 0) {
                    break;
                }
                ascii[i] = c;
            }
            trace_msg("Obtained ASCII for Paper at Paper path %s: %s",
                text_path, Arrays.toString(ascii));
        }
        if (ascii != EMPTY_PAPER && gr_state == PAPER_BLANK_STATE) {
            gr_state = PAPER_WRITTEN_STATE;
            gen_flags[MODIFIED] = true;
            checkpoint_object(this);
        }
    }

    private void retrievePaperContents() {
        // Get the text for this Paper from the DB.
        JSONObject findPattern = new JSONObject();
        findPattern.addProperty("ref", text_path);

        if (text_path.startsWith("text-") && !text_path.equals(EMPTY_PAPER_REF)) {
            context().contextor().queryObjects(findPattern, null, 1, finishTextRead);
        } else if (text_path.startsWith("paper-")) {
            context().contextor().queryObjects(findPattern, null, 1, finishPaperRead);
        }
    }

    private void savePaperContents() {
        trace_msg("Saving contents for Paper %s: %s", text_path, Arrays.toString(ascii));
        text_path = paper_path();
        PaperContents contents = new PaperContents(ascii);
        context().contextor().odb().putObject(text_path, contents, null, false, finishPaperWrite);
    }

    private void deletePaperContents() {
        if (text_path.equals(EMPTY_PAPER_REF)) {
            return;
        }
        trace_msg("Deleting contents of Paper %s", text_path);
        context().contextor().odb().removeObject(text_path, null, finishPaperDelete);
        text_path = EMPTY_PAPER_REF;
    }

    // Callback methods for DB operations:

    protected final ArgRunnable finishPaperDelete = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            if (obj != null) {
                String errorMsg = (String) obj;
                trace_msg("Received a DB error when removing Paper %s: %s", text_path, errorMsg);
            }
        }
    };

    protected final ArgRunnable finishPaperWrite = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            if (obj != null) {
                String errorMsg = (String) obj;
                trace_msg("Received a DB error when saving Paper %s: %s", text_path, errorMsg);
            }
        }
    };

    protected final ArgRunnable finishTextRead = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            // After any text read, sets text_path to point at the Paper's DB reference
            // for future CRUD operations.
            setAsciiFromTextResult(obj);
        }
    };

    protected final ArgRunnable finishPaperRead = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            setAsciiFromPaperResult(obj);
        }
    };

}
