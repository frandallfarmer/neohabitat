package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Switch;

/**
 * Habitat Floor Light Mod
 *
 * A Flashlight may be switched on/off but not moved, like a Flashlight.
 *
 * @author steve
 */
public class Floor_lamp extends Switch {

    public int HabitatClass() {
        return CLASS_FLOOR_LAMP;
    }

    public String HabitatModName() {
        return "Floor_lamp";
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

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "on" })
    public Floor_lamp(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
                      OptInteger on) {
        super(style, x, y, orientation, gr_state, on);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeLighting(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    /**
     * Verb (Specific): Get HELP for this.
     *
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void HELP(User from) {
        floor_lamp_HELP(from);
    }

    /**
     * Verb (Switch): Turn this OFF
     *
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void OFF(User from) {
        generic_OFF(from);
    }

    /**
     * Verb (Switch): Turn this ON
     *
     * @param from User representing the connection making the request.
     */
    @JSONMethod
    public void ON(User from) {
        generic_ON(from);
    }

    /**
     * Reply with HELP for Floor_lamps
     *
     * @param from User representing the connection making the request.
     */
    public void floor_lamp_HELP(User from) {
        if (on == FALSE)
            send_reply_msg(from, "LAMP: DO turns lamp on or off.  This lamp is now off.");
        else
            send_reply_msg(from, "LAMP: DO turns lamp on or off.  This lamp is now on.");
    }

}
