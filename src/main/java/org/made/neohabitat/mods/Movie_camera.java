package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Toggle;

/**
 * Habitat Movie Camera Mod (attached to an Elko Item.)
 * 
 * This class was never finished, for now it's just a switch.
 * 
 * @author randy
 *
 */
public class Movie_camera extends Toggle implements Copyable {
    
    public int HabitatClass() {
        return CLASS_MOVIE_CAMERA;
    }
    
    public String HabitatModName() {
        return "Movie_camera";
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "on" })
    public Movie_camera(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger on) {
        super(style, x, y, orientation, gr_state, restricted, on);
    }

    public Movie_camera(int style, int x, int y, int orientation, int gr_state, boolean restricted, int on) {
        super(style, x, y, orientation, gr_state, restricted, on);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Movie_camera(style, x, y, orientation, gr_state, restricted, on);
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
        generic_HELP(from);
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
        generic_PUT(from, containerNoid.value(THE_REGION), x.value(avatar(from).x), y.value(avatar(from).y),
        		orientation.value(avatar(from).orientation));
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
     * Verb (Toggle): Turn this OFF
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void OFF(User from) {
        generic_OFF(from);
    }
    
    /**
     * Verb (Toggle): Turn this ON
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void ON(User from) {
        generic_ON(from);
    }
}
