package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.Document;
import org.made.neohabitat.HabitatMod;


/**
 * Habitat Book Mod (attached to an Elko Item.)
 *
 * This is a portable, READ-only text document with a title. Responds to HELP messages.
 *
 * @author steve
 */
public class Book extends Document implements Copyable {

    public int HabitatClass() {
        return CLASS_BOOK;
    }

    public String HabitatModName() {
        return "Book";
    }

    public int capacity() {
        return 0;
    }

    public int pc_state_bytes() {
        return 1;
    };

    public boolean known() {
        return true;
    }

    public boolean opaque_container() {
        return false;
    }

    public boolean filler() {
        return false;
    }

    private String title;

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "last_page", "pages", "ascii", "path", "title" })
    public Book(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        int last_page, String pages[], int[][] ascii, OptString path, OptString title) {        
        super(style, x, y, orientation, gr_state, restricted, last_page, pages, ascii, path);       
        this.title = title.value("");
    }

    public Book(int style, int x, int y, int orientation, int gr_state, boolean restricted, int last_page, String[] pages, String path,
        String title) {
        super(style, x, y, orientation, gr_state, restricted, last_page, pages, path);
        this.title = title;
    }

    public Book(int style, int x, int y, int orientation, int gr_state, boolean restricted, int last_page, int ascii[][], String path,
            String title) {
            super(style, x, y, orientation, gr_state, restricted, last_page, ascii, path);
            this.title = title;
    }
    
    @Override
    public HabitatMod copyThisMod() {
        return new Book(style, x, y, orientation, gr_state, restricted, last_page, ascii, path, title);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeDocument(new JSONLiteral(HabitatModName(), control));
        if (control.toRepository()) {
            result.addParameter("title", title);
        }
        result.finish();
        return result;
    }

    @JSONMethod({ "page" })
    public void READ(User from, OptInteger page) {
        int page_to_read = page.value(0);
        if (page_to_read == 254) { // aka -1: BACK pressed on UI.
            page_to_read = Math.max(1, next_page - 2);
        } else if (page_to_read == 0) {
            page_to_read = next_page;
        }
        if (page_to_read > last_page) {
            page_to_read = 1;
        }
        if (holding(avatar(from), this)) {
            next_page = page_to_read + 1;
            show_text_page(from, path, page_to_read, next_page);
        } else {
            int[] textPage = getTextPage(path, page_to_read);
            send_reply_msg(from, textPage.toString().substring(0, 16));
        }
    }

    /**
     * Verb (Generic): Pick this item up.
     *
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void GET(User from) {
        generic_GET(from);
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
        generic_PUT(from, containerNoid.value(THE_REGION), x.value(avatar(from).x), y.value(avatar(from).y),
                orientation.value(avatar(from).orientation));
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
        generic_THROW(from, target, x, y);
    }    
    @JSONMethod
    public void HELP(User from) {
        send_reply_msg(from, "BOOK: DO while holding to read the book.");
        object_say(from, noid, get_title_page(title, BOOK$HELP));
    }
    
    public String book_vendo_info() {
        return get_title_page(title, BOOK$VENDO);
    }    


}

