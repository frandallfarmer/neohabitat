package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Container;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Openable;

/**
 * Habitat Garbage Can Mod
 *
 * A Garbage Can is an opaque container that allows you to flush it,
 * purging any mods contained within it from the clients and DB.
 *
 * @author steve
 */
public class Garbage_can extends Openable implements Copyable {

    public int HabitatClass() {
        return CLASS_GARBAGE_CAN;
    }

    public String HabitatModName() {
        return "Garbage_can";
    }

    public int capacity() {
        return 20;
    }

    public int pc_state_bytes() {
        return 3;
    };

    public boolean known() {
        return true;
    }

    public boolean opaque_container() {
        return true;
    }

    public boolean  changeable       () { return true; }

    public boolean filler() {
        return false;
    }

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "open_flags", "key_hi", "key_lo" })
    public Garbage_can(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted, 
        OptInteger open_flags, OptInteger key_hi, OptInteger key_lo) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_hi, key_lo);
    }

    public Garbage_can(int style, int x, int y, int orientation, int gr_state, boolean restricted,
            boolean[] open_flags, int key_hi, int key_lo) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_hi, key_lo);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Garbage_can(style, x, y, orientation, gr_state, restricted, open_flags, key_hi, key_lo);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @JSONMethod
    public void FLUSH(User from) {
        garbage_can_FLUSH(from);
    }

    public void garbage_can_FLUSH(User from) {
        // TODO: Correct destroy_contents() code after in-container deletes are working.
        destroy_contents();
        send_neighbor_msg(from, noid, "FLUSH$");
        send_reply_success(from);
    }

}
