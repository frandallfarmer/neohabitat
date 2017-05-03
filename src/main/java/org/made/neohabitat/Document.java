package org.made.neohabitat;

import java.util.Iterator;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.JSONArray;
import org.elkoserver.json.JSONDecodingException;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.json.JSONObject;
import org.elkoserver.server.context.User;
import org.elkoserver.util.ArgRunnable;
import org.elkoserver.util.trace.Trace;

import com.mongodb.MongoException;

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

	private static final int	  NO_PAGES[][]	= {};
	private static final int MISSING_PAGES[][]	= new int[][] { {91, 77, 105, 115, 115, 105, 110, 103, 32, 68, 111, 99, 117, 109, 101, 110, 116, 93 } }; // [Missing Document]

	/** Local document body - char array provided for simple documents only.  Immediately converted to ascii byte array. */
	protected String pages[]   = {};
	/** ASCII version of document body - normal peristent form */
	protected int ascii[][]    = NO_PAGES;
	/** DB reference to static shared) page content to be read from DB */
	protected String path      = "";
	/** The last page read, shared with client */
	protected int    last_page = 1;
	/** The page last read in this document (by any user/avatar) */
	protected int    next_page = 1;

	public Document(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted, 
			int last_page, String pages[], int[][] ascii, OptString path) {
		super(style, x, y, orientation, gr_state, restricted);    	
		if (ascii != null && ascii.length > 0 ) {
			setDocumentState(	(ascii != null && ascii.length > 0) ? ascii.length : last_page,
					(ascii != null && ascii.length > 0) ? ascii        : MISSING_PAGES,
							path.value(""));
		} else {
			setDocumentState(	(pages != null && pages.length > 0) ? pages.length : last_page,
					convertPagesToAscii(pages),
					path.value(""));
		}
	}

	public Document(int style, int x, int y, int orientation, int gr_state, boolean restricted, 
			int last_page, String[] pages, String path) {
		super(style, x, y, orientation, gr_state, restricted);
		setDocumentState(last_page, convertPagesToAscii(pages), path);
	}

	public Document(int style, int x, int y, int orientation, int gr_state, boolean restricted, 
			int last_page, int[][] ascii, String path) {
		super(style, x, y, orientation, gr_state, restricted);
		setDocumentState(last_page, ascii, path);
	}

	protected void setDocumentState(int last_page, int[][] ascii, String path) {
		this.last_page	= last_page;
		this.path		= path;	
		this.ascii 		= ascii;
	}

	public static final int MAX_LINE_WIDTH = 40;
	public static final int LINES_PER_PAGE = 16;
	public static final int FULL_TEXT_PAGE = LINES_PER_PAGE * MAX_LINE_WIDTH; // 16 lines of 40 characters each.

	protected int[][] convertPagesToAscii(String[] pages) {
		int results[][] = MISSING_PAGES;
		if (pages != null && pages.length > 0) {
			results = new int[pages.length][FULL_TEXT_PAGE];
			for (int i = 0; i < pages.length; i++) {
				for (int c = 0; c < pages[i].length() && c < FULL_TEXT_PAGE; c++) {
					results[i][c] = (int) pages[i].charAt(c) & 0xff;
				}    			
			}
		}
		return results;
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
			ascii = MISSING_PAGES;
			if (null != obj) {
				Object[] 			args 		= (Object[]) obj;
				JSONArray 			textBlocks;
				try {
					textBlocks = ((JSONObject) args[0]).getArray("pages");
				} catch (JSONDecodingException e) {
					textBlocks = null;
				}
				if (textBlocks != null && textBlocks.size() > 0) {	// We need to convert the char-pages to ascii pages.
					Iterator<Object> textPage 	= textBlocks.iterator();
					last_page					= textBlocks.size();
					String textPages[]			= new String[last_page];

					for (int i = 0 ; i < last_page ; i++) {
						textPages[i] = (String) textPage.next();
					}
					ascii = convertPagesToAscii(textPages);
				} else {
					JSONArray byteBlocks = null;
					try {
						byteBlocks = ((JSONObject) args[0]).getArray("ascii");
					} catch (JSONDecodingException e) {
						trace_msg("Neither pages or ascii found for document.");
						return;
					}
					Iterator<Object> bytePage 	= byteBlocks.iterator();
					last_page					= byteBlocks.size();
					ascii = new int[last_page][FULL_TEXT_PAGE];
					for (int i = 0; i < last_page; i++) {
						Iterator<Object> chars = ((JSONArray) bytePage.next()).iterator();
						for (int j = 0; chars.hasNext() ; j++) {
							int c = ((Double) chars.next()).intValue();
							if (c == 0) {
								break;
							}
							ascii[i][j] = c;
						}
					}
				}
			}
		}
	};

	public JSONLiteral encodeDocument(JSONLiteral result) {
		result = super.encodeCommon(result);
		result.addParameter("last_page", last_page);
		if (result.control().toRepository()) {
			if (path.isEmpty()) {
				result.addParameter("ascii", ascii);
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
		msg.addParameter("ascii", getTextPage(path, page_to_read));
		msg.finish();
		from.send(msg);
	}

	protected int[] getTextPage(String path, int page_to_read) {
		return ascii[Math.max(Math.min(page_to_read, last_page), 1) - 1];
	}

}
