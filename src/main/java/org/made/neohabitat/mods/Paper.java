package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.*;
import org.elkoserver.objdb.ObjDB;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.User;

import org.elkoserver.util.ArgRunnable;
import org.made.neohabitat.*;

import java.text.SimpleDateFormat;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;


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

    public static final String EMPTY_PAPER_REF = "text-emptypaper";

    public static final Pattern ADDRESS_REGEX = Pattern.compile("[Tt][Oo]:(.*)");
    public static final SimpleDateFormat POSTMARK_DATE_FORMAT = new SimpleDateFormat("yy-MM-dd");

    public static final int[] EMPTY_PAPER = new int[16];

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
    public String text_path = EMPTY_PAPER_REF;

    /** Contains the time at which this Paper was sent as a Mail message. */
    public int sent_timestamp = 0;

    /** Contains the current PETSCII text of the Paper, retrieved from a PaperContents record in MongoDB. */
    protected int ascii[] = EMPTY_PAPER;

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "text_path", "sent_timestamp" })
    public Paper(OptInteger style, OptInteger x, OptInteger y,
        OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptString text_path, OptInteger sent_timestamp) {
        super(style, x, y, orientation, gr_state, restricted);
        this.ascii = EMPTY_PAPER;
        this.text_path = text_path.value(EMPTY_PAPER_REF);
        this.sent_timestamp = sent_timestamp.value(0);
    }

    public Paper(int style, int x, int y, int orientation, int gr_state,
        boolean restricted, String text_path, Integer sent_timestamp) {
        super(style, x, y, orientation, gr_state, restricted);
        this.ascii = EMPTY_PAPER;
        this.text_path = text_path;
        this.sent_timestamp = sent_timestamp;
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
        return new Paper(style, x, y, orientation, gr_state, restricted, text_path, sent_timestamp);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        if (control.toRepository()) {
            result.addParameter("text_path", text_path);
            result.addParameter("sent_timestamp", sent_timestamp);
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
            send_gr_state_fiddle(gr_state);
        } else {
            send_reply_error(from);
        }
    }

    @JSONMethod
    public void HELP(User from) {
        JSONLiteral msg = new_reply_msg(noid);
        if (!is_blank()) {
            msg.addParameter("text", get_title_page(getFirstLine(), PAPER$HELP));
        } else {
            msg.addParameter("text", "");
        }
        msg.finish();
        from.send(msg);
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
        boolean success = false;
        boolean is_letter = false;
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

            // If special_get is true, we need to replace the Paper we just removed from the
            // Avatar's MAIL_SLOT.
            if (special_get) {
                trace_msg("Special GET is true for Paper %s, either a mail or Paper sheet creation",
                    text_path);

                Paper newPaper = new Paper(
                    0, 0, MAIL_SLOT, 16, PAPER_BLANK_STATE, false, EMPTY_PAPER_REF, 0);
                paperItem = create_object("paper", newPaper, avatar, false);
                if (paperItem == null) {
                    // If this fails, puts the Paper back in the Avatar's inventory.
                    change_containers(this, avatar, MAIL_SLOT, true);
                    send_reply_error(from);
                    return;
                }

                announce_it = true;
            }
            send_neighbor_msg(from, avatar.noid, "GET$",
                "target", noid,
                "how", how);
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

        // If the Paper is a LETTER, checks the Avatar's MailQueue and replaces the Paper
        // with either a LETTER or a BLANK depending upon its status.
        if (gr_state == PAPER_LETTER_STATE) {
            send_gr_state_fiddle(PAPER_WRITTEN_STATE);
            avatar.update_mail_slot(false);
        }
    }

    @JSONMethod
    public void PSENDMAIL(User from) {
        Avatar avatar = avatar(from);
        boolean success;
        Paper paperInHands = null;
        HabitatMod inHands = avatar.contents(HANDS);

        // Parse the addressee (To: somebody) from the Paper's ASCII contents.
        String addressee = findAddressee();
        if (addressee == null) {
            send_reply_error(from);
            return;
        }

        if (holding(avatar, this)) {
            if (inHands instanceof Paper) {
                paperInHands = (Paper) inHands;
                paperInHands.addPostmark(from);
                paperInHands.sendMailToUser(from, addressee);
                success = true;
            } else {
                success = false;
            }
        } else {
            success = false;
        }

        if (success) {
            send_reply_success(from);
            send_goaway_msg(paperInHands.noid);
            destroy_object(paperInHands);
            avatar.inc_record(Constants.HS$mail_send_count);
        } else {
            send_reply_error(from);
        }
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

    public void send_gr_state_fiddle(int new_gr_state) {
        send_fiddle_msg(
            THE_REGION,
            noid,
            C64_GR_STATE_OFFSET,
            new_gr_state
        );
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

    /**
     * Returns the first line of this Paper as a String.
     *
     * @return a Java String representing the first line of this Paper
     */
    private String getFirstLine() {
        // Extracts the first line of the Paper.
        int lineWidth = Document.MAX_LINE_WIDTH;
        if (ascii.length < Document.MAX_LINE_WIDTH) {
            lineWidth = ascii.length;
        }
        List<Character> firstLine = new LinkedList<>();

        // Sanitizes out any PETSCII characters that won't parse as UTF-8,
        // replacing them with spaces.
        for (int i=0; i < lineWidth; i++) {
            int curChar = ascii[i];
            if (curChar >=32 && curChar <= 127) {
                // If a valid ASCII character, adds to String.
                firstLine.add((char) curChar);
            } else if (curChar == 10) { // 10 == \n (newline)
                // NUL-terminates the String if we reach a newline.
                firstLine.add((char) 0);
                break;
            } else {
                // Converts any non-parseable character to a space.
                firstLine.add((char) 32); // 32 == ' '
            }
        }

        // Parses List into a char[] and transforms it into a String.
        char[] firstLineChars = new char[firstLine.size()];
        for (int i=0; i < firstLine.size(); i++) {
            firstLineChars[i] = firstLine.get(i);
        }
        String firstLineString = new String(firstLineChars);

        trace_msg("First line of Paper %s, length %d:\n%s",
            text_path, firstLineString.length(), firstLineString);
        return firstLineString;
    }


    /**
     * Locates the addressee of the Mail within this paper, returning a lowercased
     * user name suitable for MailQueue lookup.
     *
     * @return
     */
    private String findAddressee() {
        // Looks for a matching address within the first line.
        String firstLineString = getFirstLine();
        Matcher addressMatcher = ADDRESS_REGEX.matcher(firstLineString);
        if (addressMatcher.matches()) {
            String address = addressMatcher.group(1).trim();
            trace_msg("Found addressee for Paper %s: %s", text_path, address);
            return address.toLowerCase();
        } else {
            trace_msg("Could not find addressee for Paper %s: %s",
                text_path, firstLineString);
            return null;
        }
    }

    /**
     * Replaces the address line (To:...) of a Mail-like Paper with a postmark:
     * From: someone   Postmark:05-19-17
     *
     * @param from User who is sending a Mail message with this Paper
     */
    private void addPostmark(User from) {
        // Figures out the mail sending timestamp from the current time.
        long currentTime = System.currentTimeMillis();
        Date currentDate = new Date(currentTime);
        sent_timestamp = (int) (currentTime / 1000L);

        // Creates a 40 character-long postmark String to append to the start
        // of this message.
        String postmarkFirstLine = String.format("From: %-14s Postmark: %s ",
            from.name(), POSTMARK_DATE_FORMAT.format(currentDate));
        trace_msg("Writing postmark to sent mail in Paper %s:\n%s",
            paper_path(), postmarkFirstLine);

        // Figures out where to insert the Postmark.
        int startOfLetterText = getFirstLine().length();
        int[] letterText = Arrays.copyOfRange(ascii, startOfLetterText, ascii.length);

        // Inserts the Postmark.
        ascii = concat_int_arrays(stringToIntArray(postmarkFirstLine), letterText);
        trace_msg("Postmarked ASCII for Paper %s: %s", paper_path(), Arrays.toString(ascii));

        // Saves the Paper's contents.
        savePaperContents();
        checkpoint_object(this);
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
                    int c = ((Long) chars.next()).intValue();
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

    public void retrievePaperContents() {
        trace_msg("Retrieving Paper contents for Paper %s at: %s", object().ref(), text_path);

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
        if (text_path.startsWith("text-")) {
            text_path = paper_path();
            gen_flags[MODIFIED] = true;
        }
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

    private void sendMailToUser(User from, String toUserName) {
        trace_msg("Sending Mail to User %s: %s", toUserName, text_path);

        String mailQueueRef = String.format("mail-%s", toUserName);

        JSONObject findPattern = new JSONObject();
        findPattern.addProperty("ref", mailQueueRef);

        User user = Region.getUserByName(toUserName);
        if (user != null) {
            Avatar avatar = avatar(user);
            HabitatMod mailMod = avatar.contents(MAIL_SLOT);
            if (mailMod != null && mailMod instanceof Paper) {
                Paper mailPaper = (Paper) mailMod;
                // If the Paper in the Avatar's MAIL_SLOT is already in a LETTER state,
                // appends it to the Avatar's MailQueue instead.
                if (mailPaper.gr_state == PAPER_LETTER_STATE) {
                    trace_msg("Appending Paper to online User's MailQueue %s: %s", mailQueueRef, text_path);
                    context().contextor().queryObjects(
                        findPattern, null, 1, new MailQueueUpdater(
                            from, toUserName, this, context().contextor().odb()));
                    return;
                }
                mailPaper.gr_state = PAPER_LETTER_STATE;
                mailPaper.text_path = text_path;
                mailPaper.sent_timestamp = sent_timestamp;
                mailPaper.gen_flags[MODIFIED] = true;
                mailPaper.checkpoint_object(mailPaper);
                mailPaper.retrievePaperContents();
                mailPaper.send_gr_state_fiddle(PAPER_LETTER_STATE);
                avatar.send_mail_arrived();
                avatar.inc_record(Constants.HS$mail_recv_count);
                trace_msg("Saving Paper to online User %s MAIL_SLOT: %s", toUserName, mailPaper.text_path);
            } else {
                trace_msg("No Paper in MAIL_SLOT for User %s", toUserName);
                return;
            }
        } else {
            trace_msg("Appending Mail to offline User's MailQueue %s: %s", mailQueueRef, text_path);
            context().contextor().queryObjects(
                findPattern, null, 1, new MailQueueUpdater(
                    from, toUserName, this, context().contextor().odb()));
        }
    }

    // Callback methods for DB operations:

    private class MailQueueUpdater implements ArgRunnable {

        private User from;
        private String toUserName;
        private Paper mailPaper;
        private ObjDB odb;

        public MailQueueUpdater(User from, String toUserName, Paper mailPaper, ObjDB odb) {
            this.from = from;
            this.toUserName = toUserName;
            this.mailPaper = (Paper) mailPaper.copyThisMod();
            this.odb = odb;
        }

        @Override
        public void run(Object obj) {
            try {
                MailQueue newQueue = new MailQueue();
                if (obj != null) {
                    Object[] args = (Object[]) obj;
                    try {
                        JSONObject jsonObj = ((JSONObject) args[0]);
                        newQueue = new MailQueue(jsonObj);
                    } catch (JSONDecodingException e) {
                        trace_msg("Could not decode Mail queue: %s", getTracebackString(e));
                        return;
                    }
                }
                newQueue.addNewMail(from, mailPaper);
                odb.putObject(
                        String.format("mail-%s", toUserName), newQueue, null, false,
                        finishMailQueueWrite);
            } catch (Exception e) {
                trace_exception(e);
            }
        }

    }

    protected final ArgRunnable finishMailQueueWrite = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            try {
                if (obj != null) {
                    trace_msg("Could not write mail queue for Paper %s: %s", text_path, obj);
                    return;
                }
            } catch (Exception e) {
                trace_exception(e);
            }
        }
    };

    protected final ArgRunnable finishPaperDelete = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            try {
                if (obj != null) {
                    trace_msg("Received a DB error when removing Paper %s: %s", text_path, obj);
                }
            } catch (Exception e) {
                trace_exception(e);
            }
        }
    };

    protected final ArgRunnable finishPaperWrite = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            try {
                if (obj != null) {
                    trace_msg("Received a DB error when saving Paper %s: %s", text_path, obj);
                }
            } catch (Exception e) {
                trace_exception(e);
            }
        }
    };

    protected final ArgRunnable finishTextRead = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            try {
                // After any text read, sets text_path to point at the Paper's DB reference
                // for future CRUD operations.
                setAsciiFromTextResult(obj);
            } catch (Exception e) {
                trace_exception(e);
            }
        }
    };

    protected final ArgRunnable finishPaperRead = new ArgRunnable() {
        @Override
        public void run(Object obj) {
            try {
                setAsciiFromPaperResult(obj);
            } catch (Exception e) {
                trace_exception(e);
            }
        }
    };

}
