package org.made.neohabitat;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;

/**
 * an Elko Habitat superclass to text documents.
 * 
 * 1988 PL1 didn't understand classes.
 * Chip wrote the Habitat code, simulating structures, classes, and a form of class inheritance by
 * concatenating include files and careful management of procedure references.
 * 
 * NeoHabitat Variant Design: Document body is at resource/file URL/path. May be set with God Tool.
 */
public abstract class Document extends HabitatMod {
	
	/** URL/Path to document body */
	protected String path = "null.txt";
	/** The last page read, shared with client */
	protected int last_page = 1;
	/** The page last read in this docuement (by any user/avatar) */
	protected int current_page = 1;
	
	public Document (
			OptInteger style, OptInteger x, OptInteger y,
			OptInteger orientation, OptInteger gr_state,
			int last_page, String path ) {
		super(style, x, y, orientation, gr_state);
		this.last_page	= last_page;
		this.path		= path;
	} 

	public JSONLiteral encodeMassive(JSONLiteral result) {
		result = super.encodeCommon(result);
		result.addParameter("last_page", last_page);
		if ("" != path)	{ result.addParameter("path", path); }
		return result;
	}

	@JSONMethod ({"page"})
	public void READ (User from, OptInteger page) {
		int page_to_read = page.value(0);
		if (page_to_read == 0) {
			page_to_read = current_page;
		}
		if (page_to_read > last_page) {
			page_to_read = 1;
		}
		current_page = page_to_read +1;
		show_text_page(from, path, page_to_read, current_page);
	}

	public void show_text_page(User from, String path, int page_to_read, int current_page) {
		JSONLiteral msg = new_reply_msg(this.noid);
		msg.addParameter("nextpage", current_page);
		msg.addParameter("text", getTextPage(path, page_to_read));
		msg.finish();
		from.send(msg);		
	}
	
	/** TBD Read document from path and pagify. Large packets will be managed by the bridge? */
	private String getTextPage(String path, int page_to_read) {
		if (path.isEmpty()) {
			return "<This space left blank>";
		}
		return path + " remains unread. TBD.";	
	}	
}
