package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;

import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Teleporter;


/**
 * Habitat Elevator Mod (attached to an Elko Item.)
 *
 * Teleports an Avatar to another Elevator, prefixed by "otis-" and the Elevator's
 * area code.
 *
 * @author steve
 */
public class Elevator extends Teleporter implements Copyable {

    public int HabitatClass() {
        return CLASS_ELEVATOR;
    }

    public String HabitatModName() {
        return "Elevator";
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

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "activeState", "take", "address"})
    public Elevator(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
        OptInteger gr_state, OptBoolean restricted, OptInteger activeState,  OptInteger take,
        String address) {
        super(style, x, y, orientation, gr_state, restricted, activeState, take, address);
    }

    public Elevator(int style, int x, int y, int orientation, int gr_state, boolean restricted,
        int activeState, int take, String address) {
        super(style, x, y, orientation, gr_state, restricted, activeState, take, address);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Elevator(style, x, y, orientation, gr_state, restricted, activeState, take, address);
    }

    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeTeleporter(
            new JSONLiteral(HabitatModName(), control), control);
        result.finish();
        return result;
    }

    @JSONMethod({"port_number"})
    public void ZAPTO(User from, String port_number) {
        String elevator_destination = "otis-" + area_code() + squish(port_number.toLowerCase());
        activate_teleporter(from, lookupTeleportDestination(elevator_destination));
    }

    @Override
    @JSONMethod
    public void HELP(User from) {
        send_reply_msg(from, "ELEVATOR: stand in elevator and type desired floor followed by RETURN.");
        object_say(from, "This is elevator \"" + address.trim() + "\"");
    }

}
