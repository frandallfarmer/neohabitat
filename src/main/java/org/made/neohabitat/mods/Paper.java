package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.*;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.User;

import org.elkoserver.util.ArgRunnable;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.Document;
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

    public static final int[] EMPTY_PAGE = {};

    public static final int FROM_GROUND = 0;
    public static final int FROM_POCKET = 1;

    public static final int PAPER_BLANK_STATE = 0;
    public static final int PAPER_WRITTEN_STATE = 1;
    public static final int PAPER_LETTER_STATE = 2;

    public static final int MAX_TITLE_LENGTH = 24;

    public static final int[] EMPTY_PAPER = new int[Document.FULL_TEXT_PAGE];
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
    private String text_path = "";

    /** Whether this paper has any PETSCII text currently written to it. */
    protected boolean has_ascii = false;

    /** Contains the current PETSCII text of the Paper, retrieved from a PaperContents record in MongoDB. */
    protected int ascii[] = {};

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "text_path" })
    public Paper(OptInteger style, OptInteger x, OptInteger y,
        OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptString text_path) {
        super(style, x, y, orientation, gr_state, restricted);
        this.has_ascii = false;
        this.text_path = text_path.value("");
    }

    public Paper(int style, int x, int y, int orientation, int gr_state,
        boolean restricted, String text_path) {
        super(style, x, y, orientation, gr_state, restricted);
        this.has_ascii = false;
        this.text_path = text_path;
    }

    public String paper_path() {
        return String.format("paper-%s", object().ref());
    }

    public String new_paper_item_uuid() {
        return String.format("item-paper.%s.%s", object().ref(),
            java.util.UUID.randomUUID().toString());
    }

    /**
     * Queries the DB for the state of the Paper; if none exists, attempts to create it from the
     * provided text_path, if specified.
     */
    public void objectIsComplete() {
        super.objectIsComplete();
        retrievePaperContents();
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
            if (has_ascii) {
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
        boolean success = false;
        boolean fiddle_flag = false;

        if (holding(avatar, this)) {
            success = true;
            // If we've been given an empty string
            if (request_ascii == null || request_ascii.length == 16) {
                ascii = EMPTY_PAGE;
                savePaperContents();
                if (gr_state != PAPER_BLANK_STATE) {
                    gr_state = PAPER_BLANK_STATE;
                    fiddle_flag = true;
                }
            } else {
                ascii = request_ascii;
                savePaperContents();
                gr_state = PAPER_WRITTEN_STATE;
            }
        }

        if (success) {
            send_reply_success(from);
        } else {
            send_reply_error(from);
        }

        if (fiddle_flag) {
            send_fiddle_msg(
                THE_REGION,
                noid,
                C64_GR_STATE_OFFSET,
                new int[] { 1, PAPER_BLANK_STATE }
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
            msg.addParameter("ascii",
                concat_int_arrays(PAPER_TITLE_BEGINNING, boundedAscii, PAPER_TITLE_ENDING));
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
        int how = -1;
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
                send_reply_error(from);
                return;
            }
            success = true;

            // If special_get is true, we're either getting mail or creating a new Paper sheet.
            if (special_get) {
                Paper blankPaper = new Paper(0, 0, MAIL_SLOT, 16, PAPER_BLANK_STATE, false, "");
                paperItem = create_object(new_paper_item_uuid(), blankPaper, avatar);
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
            send_neighbor_msg(from, noid, "GET$", "target", noid, "how", how);
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
        if (put_success && !has_ascii) {
            send_broadcast_msg(noid, "GOAWAY_$");
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
        if (throw_success && !has_ascii) {
            send_broadcast_msg(noid, "GOAWAY_$");
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

        public PaperContents(int[] ascii) {
            this.ascii = ascii;
        }

        public JSONLiteral encode(EncodeControl control) {
            JSONLiteral paper = new JSONLiteral("paper", control);
            if (control.toRepository()) {
                paper.addParameter("ascii", ascii);
            }
            return paper;
        }

    }

    private void showPaper(User from) {
        JSONLiteral msg = new_reply_msg(noid);
        msg.addParameter("nextpage", 1);
        msg.addParameter("ascii", ascii);
        msg.finish();
        from.send(msg);
    }

    private void showEmptyPaper(User from) {
        JSONLiteral msg = new_reply_msg(noid);
        msg.addParameter("nextpage", 1);
        msg.addParameter("ascii", EMPTY_PAPER);
        msg.finish();
        from.send(msg);
    }

    private void setAsciiFromTextResult(Object obj) {
        ascii = EMPTY_PAGE;
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
                trace_msg("Obtained text for Paper at Text path %s: %s", paper_path(), text);
                ascii = convert_to_petscii(text, Document.FULL_TEXT_PAGE);
            } else {
                // Otherwise, we take the first element of the "ascii" array, containing raw PETSCII runes.
                JSONArray byteBlocks = null;
                try {
                    byteBlocks = ((JSONObject) args[0]).getArray("ascii");
                } catch (JSONDecodingException e) {
                    return;
                }
                Iterator<Object> bytePage = byteBlocks.iterator();
                ascii = new int[Document.FULL_TEXT_PAGE];
                Iterator<Object> chars = ((JSONArray) bytePage.next()).iterator();
                for (int i = 0; chars.hasNext(); i++) {
                    int c = ((Double) chars.next()).intValue();
                    if (c == 0) {
                        break;
                    }
                    ascii[i] = c;
                }
                trace_msg("Obtained ASCII for Paper at Text path %s: %s",
                    paper_path(), Arrays.toString(ascii));
            }
        }
        if (ascii != EMPTY_PAGE) {
            has_ascii = true;
            savePaperContents();
        }
    }

    private void setAsciiFromPaperResult(Object obj) {
        ascii = EMPTY_PAGE;
        if (obj != null) {
            Object[] args = (Object[]) obj;
            JSONArray byteBlocks = null;
            try {
                byteBlocks = ((JSONObject) args[0]).getArray("ascii");
            } catch (JSONDecodingException e) {
                return;
            }
            Iterator<Object> bytePage = byteBlocks.iterator();
            ascii = new int[Document.FULL_TEXT_PAGE];
            Iterator<Object> chars = ((JSONArray) bytePage.next()).iterator();
            for (int i = 0; chars.hasNext(); i++) {
                int c = ((Double) chars.next()).intValue();
                if (c == 0) {
                    break;
                }
                ascii[i] = c;
            }
            trace_msg("Obtained ASCII for Paper at Paper path %s: %s",
                paper_path(), Arrays.toString(ascii));
        }
        if (ascii != EMPTY_PAGE) {
            has_ascii = true;
        }
    }

    private void retrievePaperContents() {
        // Get the text for this Paper from the DB.
        JSONObject findPattern = new JSONObject();
        findPattern.addProperty("ref", paper_path());
        context().contextor().queryObjects(findPattern, null, 1, finishPaperRead);
    }

    private void savePaperContents() {
        PaperContents contents = new PaperContents(ascii);
        context().contextor().odb().putObject(paper_path(), contents, null, false, finishPaperWrite);
    }

    // Callback methods for DB operations:

    protected final ArgRunnable finishPaperWrite = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            if (obj != null) {
                String errorMsg = (String) obj;
                trace_msg("Received a DB error when saving Paper %s: %s", paper_path(), errorMsg);
            }
        }
    };

    protected final ArgRunnable finishTextRead = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            ascii = EMPTY_PAGE;
            setAsciiFromTextResult(obj);
        }
    };

    protected final ArgRunnable finishPaperRead = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            ascii = EMPTY_PAGE;
            if (obj == null && !text_path.isEmpty()) {
                JSONObject findPattern = new JSONObject();
                findPattern.addProperty("ref", text_path);
                context().contextor().queryObjects(findPattern, null, 1, finishTextRead);
            } else {
                setAsciiFromPaperResult(obj);
            }
        }
    };

}
