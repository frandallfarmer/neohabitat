package org.made.neohabitat;

import java.util.HashMap;
import java.util.Iterator;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.JSONArray;
import org.elkoserver.json.JSONDecodingException;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.json.JSONObject;
import org.elkoserver.server.context.User;
import org.elkoserver.util.ArgRunnable;
import org.elkoserver.util.trace.Trace;
import org.made.neohabitat.mods.Region;

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
    
	private static final String NO_PAGES[]		= {};
	private static final String MISSING_PAGES[]	= new String[] { "[Missing Document]" };
	
    /** Local document body */
    protected String pages[]   = NO_PAGES;
    /** TODO URL/Path to external resource FUTURE FEATURE */
    protected String path      = "";
    /** The last page read, shared with client */
    protected int    last_page = 1;
    /** The page last read in this document (by any user/avatar) */
    protected int    next_page = 1;
    
    public Document(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            int last_page, String pages[], OptString path) {
        super(style, x, y, orientation, gr_state);
        setDocumentState( (pages != null && pages.length > 0) ? pages.length : last_page,
        		 		  (pages != null && pages.length > 0) ? pages        : MISSING_PAGES,
        				  path.value(""));
    }

    public Document(int style, int x, int y, int orientation, int gr_state, int last_page,
        String[] pages, String path) {
        super(style, x, y, orientation, gr_state);
        setDocumentState(last_page, pages, path);
    }
    
    protected void setDocumentState(int last_page, String[] pages, String path) {
		this.last_page	= last_page;
		this.path		= path;	
		this.pages 		= pages;
    }
    
    /** If the text for this document is on disk, we have to go and get that now... */
    public void objectIsComplete() {
		super.objectIsComplete();
		if (!path.isEmpty()) {
			// Get the text for this document from the DB.
	        JSONObject findPattern = new JSONObject();
	        findPattern.addProperty("ref", path);
			context().contextor().queryObjects(findPattern, null, 1, finishTextRead);
    	}
    }
    
    protected ArgRunnable finishTextRead = new ArgRunnable() {
		@Override
		public void run(Object obj) {
			if (null == obj) {
				pages = MISSING_PAGES;
			} else {
				try {
					Object[] 			args 		= (Object[]) obj;
					JSONArray 			textBlocks	= ((JSONObject) args[0]).getArray("pages");
					Iterator<Object>	textPage 	= textBlocks.iterator();
					last_page	=  textBlocks.size();
					pages		= new String[last_page];
					for (int i = 0 ; i < last_page ; i++) {
						pages[i] = (String) textPage.next();
					}
				} catch (JSONDecodingException e) {
					e.printStackTrace();
					pages = MISSING_PAGES;
				}
			}
		}
    };
    
    public JSONLiteral encodeDocument(JSONLiteral result) {
        result = super.encodeCommon(result);
        result.addParameter("last_page", last_page);
        if (result.control().toRepository()) {
        	if (path.isEmpty()) {
                result.addParameter("pages", pages);
        	} else {
        		result.addParameter("path", path);
        	}
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
    
    protected String getTextPage(String path, int page_to_read) {
        return pages[Math.max(Math.min(page_to_read, last_page), 1) - 1];
    }
    
}
