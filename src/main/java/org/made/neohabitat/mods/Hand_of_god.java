package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Hand of God Mod
 * 
 * The hand of god is a giant animated hand that comes down off the top of the
 * screen and destroys the designated victim. This class was orgiginally unfinished 
 * and utilizes an unusual implementation that can be found in Magical.java
 *
 * gr_state: 1 Pile of cinder
 * gr_state: 2 "Static" Lightning bolt
 * gr_state: 3 Animation
 * gr_state: 4 Small dot/cinder
 *
 * @author TheCarlSaganExpress
 *
 */
public class Hand_of_god extends HabitatMod implements Copyable {
        
    public int HabitatClass() {
        return CLASS_HAND_OF_GOD;
    }
    
    public String HabitatModName() {
        return "Hand_of_god";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 1;
    }
    
    public boolean known() {
        return true;
    }
    
    public boolean opaque_container() {
        return false;
    }
    
    public boolean changeable() { 
        return false;
    }

    public boolean filler() {
        return false;
    }
    
    public int state = 0;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "state"})
    public Hand_of_god(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger state) {
        super(style, x, y, orientation, gr_state, restricted);
        this.state = state.value(0);
    }

    public Hand_of_god(int style, int x, int y, int orientation, int gr_state, boolean restricted, int state) {
        super(style, x, y, orientation, gr_state, restricted);
        this.state = state;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Hand_of_god(style, x, y, orientation, gr_state, restricted, state);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("state", state);
        result.finish();
        return result;
    }
    
    @JSONMethod
    public void HELP(User from) {
        generic_HELP(from);
    }
}
