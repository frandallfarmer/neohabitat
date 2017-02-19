package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Dropbox Mod
 *
 * A Dropbox allows for the sending of Habitat mail.
 *
 * @author steve
 */
public class Dropbox extends HabitatMod {

    public int HabitatClass() {
        return CLASS_DROPBOX;
    }

    public String HabitatModName() {
        return "Dropbox";
    }

    public int capacity() {
        return 0;
    }

    public int pc_state_bytes() {
        return 0;
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

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state" })
    public Dropbox(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @JSONMethod
    public void SENDMAIL(User from) {
        // TODO(steve): Implement mail because we await silent Trystero's empire.
        unsupported_reply(from, noid, "Dropbox.SENDMAIL not implemented yet.  Join us to help!");
    }

}
