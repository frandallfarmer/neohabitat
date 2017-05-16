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
 * Habitat Windup Toy (attached to an Elko Item.)
 * 
 * You wind this up and see what it does...
 * 
 * @author randy
 *
 */
public class Windup_toy extends HabitatMod implements Copyable {
    
    public int HabitatClass() {
        return CLASS_WINDUP_TOY;
    }
    
    public String HabitatModName() {
        return "Windup_toy";
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
    
    /* The number of times this has been wound. */
    private int	wind_level = 0;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "wind_level"})
    public Windup_toy(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptInteger wind_level) {
        super(style, x, y, orientation, gr_state, restricted);
        // FRF: On read from database, let's reset the windup_toy (since there is no other way to do that!)
        this.wind_level = 0;
        this.gr_state   = 0;
    }

    public Windup_toy(int style, int x, int y, int orientation, int gr_state, boolean restricted, int wind_level) {
        super(style, x, y, orientation, gr_state, restricted);
        this.wind_level = wind_level;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Windup_toy(style, x, y, orientation, gr_state, restricted, wind_level);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("wind_level", wind_level);
        result.finish();
        return result;
    }
    
    
    @JSONMethod
    public void WIND(User from) {
    	if (holding(avatar(from), this)) {
    		wind_level = Math.min(wind_level + 1, 4);
    		gr_state   = 1;
    		gen_flags[MODIFIED] = true;
    		send_neighbor_msg(from, noid, "WIND$");    		
    	}
    	this.send_reply_success(from);
    	// Strangely, there is no "wrap around" for winding, so I decided that it would reset on object db load.
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

}
