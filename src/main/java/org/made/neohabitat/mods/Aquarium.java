package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Massive;

/**
 * Habitat Aquarium Mod (attached to an Elko Item.)
 * 
 * The Aquarium was originally coded to work together with CLASS_FISH_FOOD
 * but that class was not shipped on the B disk of Club Caribe 1.0/Habitat Beta.
 * 
 * This implementation is a "stub" awaiting the day when we can rebuild
 * the B disk and add FISH_FOOD back into the release.
 * 
 * So, for now, this is a simple animating portable object.
 * 
 * @author randy
 *
 */
public class Aquarium extends HabitatMod implements Copyable {
    
    public int HabitatClass() {
        return CLASS_AQUARIUM;
    }
    
    public String HabitatModName() {
        return "Aquarium";
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
    
    /** The current state of being fed */
    private int fed = TRUE;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "fed" })
    public Aquarium(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptInteger fed) {
        super(style, x, y, orientation, gr_state, restricted);
        this.fed = fed.value(TRUE);
    }

    public Aquarium(int style, int x, int y, int orientation, int gr_state, boolean restricted, int fed) {
        super(style, x, y, orientation, gr_state, restricted);
        this.fed = fed;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Aquarium(style, x, y, orientation, gr_state, restricted, fed);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("fed", fed);
        result.finish();
        return result;
    }
    
    @JSONMethod
    public void GET(User from) {
        generic_GET(from);
    }

    
    @JSONMethod({ "containerNoid", "x", "y", "orientation" })
    public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
        generic_PUT(from, containerNoid.value(THE_REGION), x.value(avatar(from).x), y.value(avatar(from).y),
                orientation.value(avatar(from).orientation));
    }


    @JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
        generic_THROW(from, target, x, y);
    }
    
    /**
     * FEED verb is not implemented, because CLASS_FISH_FOOD is missing from the Habitat Beta/Club Caribe 1.0 B disc
     * 
     * @param from
     */
    @JSONMethod
    public void FEED(User from) {
        illegal(from, this.HabitatModName() + ".FEED");
    }
}
