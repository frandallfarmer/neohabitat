package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Switch;

/**
 * Habitat Flashlight Mod (attached to an Elko Item.)
 * 
 * A Flashlight may be switched on/off, and it effects room lighting.
 * 
 * @author randy
 *
 */
public class Flashlight extends Switch implements Copyable {
    
    public int HabitatClass() {
        return CLASS_FLASHLIGHT;
    }
    
    public String HabitatModName() {
        return "Flashlight";
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
    public Flashlight(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state,
            OptInteger on) {
        super(style, x, y, orientation, gr_state, on);
    }

    public Flashlight(int style, int x, int y, int orientation, int gr_state, int on) {
        super(style, x, y, orientation, gr_state, on);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Flashlight(style, x, y, orientation, gr_state, on);
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
        flashlight_HELP(from);
    }
    
    /**
     * Verb (Generic): Pick this item up.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void GET(User from) {
        generic_GET(from);
    }
    
    /**
     * Verb (Generic): Put this item into some container or on the ground.
     * 
     * @param from
     *            User representing the connection making the request.
     * @param containerNoid
     *            The Habitat Noid for the target container THE_REGION is
     *            default.
     * @param x
     *            If THE_REGION is the new container, the horizontal position.
     *            Otherwise ignored.
     * @param y
     *            If THE_REGION: the vertical position, otherwise the target
     *            container slot (e.g. HANDS/HEAD or other.)
     * @param orientation
     *            The new orientation for the object being PUT.
     */
    @JSONMethod({ "containerNoid", "x", "y", "orientation" })
    public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
        generic_PUT(from, containerNoid.value(THE_REGION), avatar(from).x, avatar(from).y, avatar(from).orientation);
    }
    
    /**
     * Verb (Generic): Throw this across the Region
     * 
     * @param from
     *            User representing the connection making the request.
     * @param x
     *            Destination horizontal position
     * @param y
     *            Destination vertical position (lower 7 bits)
     */
    @JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
        generic_THROW(from, target, x, y);
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
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void ON(User from) {
        generic_ON(from);
    }
    
    /**
     * Reply with HELP for Flashlights
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void flashlight_HELP(User from) {
        if (on == FALSE)
            send_reply_msg(from, "LIGHT: DO while holding turns light on or off.  This light is now off.");
        else
            send_reply_msg(from, "LIGHT: DO while holding turns light on or off.  This light is now on.");
    }
    
}
