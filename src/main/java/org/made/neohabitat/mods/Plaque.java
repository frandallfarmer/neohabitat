package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.Document;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Plaque Mod (attached to an Elko Item.)
 * 
 * This is a non-portable, READ-only text document. Responds to HELP messages.
 * 
 * @author randy
 *
 */
public class Plaque extends Document implements Copyable {
    
    public int HabitatClass() {
        return CLASS_PLAQUE;
    }
    
    public String HabitatModName() {
        return "Plaque";
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "last_page", "pages", "path" })
    public Plaque(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            int last_page, String pages[], OptString path) {
        super(style, x, y, orientation, gr_state, last_page, pages, path);
    }

    public Plaque(int style, int x, int y, int orientation, int gr_state, int last_page, String[] pages, String path) {
        super(style, x, y, orientation, gr_state, last_page, pages, path);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Plaque(style, x, y, orientation, gr_state, last_page, pages, path);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeDocument(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @JSONMethod
    public void HELP(User from) {
        send_reply_msg(from,
                "PLAQUE: DO reads the plaque.  While reading, pointing at NEXT and pressing the button flips to the next page.");
        object_say(from, "Similarly, BACK flips to the previous page and QUIT stops reading.");
    }
}
