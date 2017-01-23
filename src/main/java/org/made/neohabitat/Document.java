package org.made.neohabitat;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;

/**
 * an Elko Habitat superclass to text documents.
 * 
 * 1988 PL1 didn't understand classes. Chip wrote the Habitat code, simulating
 * structures, classes, and a form of class inheritance by concatenating include
 * files and careful management of procedure references.
 * 
 * NeoHabitat Variant Design: Document body is at resource/file URL/path. May be
 * set with God Tool.
 */
public abstract class Document extends HabitatMod {
    
    /** Local document body */
    protected String pages[]   = {};
    /** TODO URL/Path to external resource FUTURE FEATURE */
    protected String path      = "";
    /** The last page read, shared with client */
    protected int    last_page = 1;
    /** The page last read in this document (by any user/avatar) */
    protected int    next_page = 1;
    
    public Document(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            int last_page, String pages[], String path) {
        super(style, x, y, orientation, gr_state);
        this.pages = pages;
        this.last_page = (pages.length > 0) ? pages.length : last_page;
        this.path = path;
    }
    
    public JSONLiteral encodeDocument(JSONLiteral result) {
        result = super.encodeCommon(result);
        result.addParameter("last_page", last_page);
        if (result.control().toRepository()) {
            result.addParameter("path", path);
            result.addParameter("pages", pages);
        }
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
        next_page = page_to_read + 1;
        show_text_page(from, path, page_to_read, next_page);
    }
    
    public void show_text_page(User from, String path, int page_to_read, int next_page) {
        JSONLiteral msg = new_reply_msg(noid);
        msg.addParameter("nextpage", next_page);
        msg.addParameter("text", getTextPage(path, page_to_read));
        msg.finish();
        from.send(msg);
    }
    
    /**
     * TBD Read document from path and pagify. Large packets will be managed by
     * the bridge?
     */
    private String getTextPage(String path, int page_to_read) {
        if (pages.length == 0) {
            if (path.isEmpty()) {
                return "<This space left blank>";
            } else {
                return path + " remains unread. FEATURE TBD.";
            }
        }
        return pages[Math.max(Math.min(page_to_read, last_page), 1) - 1];
    }
    
}
