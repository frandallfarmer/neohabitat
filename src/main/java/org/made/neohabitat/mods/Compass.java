package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.HabitatMod;


/**
 * Habitat Compass Mod
 *
 * The compass will always indicate the direction of the West Pole, aiding in
 * world navigation.
 *
 * @author steve
 */
public class Compass extends HabitatMod {

    public int HabitatClass() {
        return CLASS_COMPASS;
    }

    public String HabitatModName() {
        return "Compass";
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
    public Compass(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
                   OptInteger gr_state) {
        super(style, x, y, orientation, gr_state);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

    @JSONMethod
    public void HELP(User from) {
        generic_HELP(from);
    }

    @JSONMethod
    public void GET(User from) {
        generic_GET(from);
    }

    @JSONMethod({ "containerNoid", "x", "y", "orientation" })
    public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
        generic_PUT(from, containerNoid.value(THE_REGION), avatar(from).x, avatar(from).y, avatar(from).orientation);
    }

    @JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
        generic_THROW(from, target, x, y);
    }

    @JSONMethod
    public void DIRECT(User from) {
        String response = "WEST: ";
        switch(gr_state) {
            case 0:
                response += (char)124;
                break;
            case 1:
                response += (char)126;
                break;
            case 2:
                response += (char)125;
                break;
            case 3:
                response += (char)127;
                break;
            default:
                response += '?';
                break;
        }
        send_reply_msg(from, response);
    }

}
