package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Oracular;

/**
 * Habitat Crystal_ball Mod (attached to an Elko Item.)
 * 
 * You can ask the Crystal Ball things and you can carry it.
 * It's really lazy and rarely answers.
 * 
 * @author randy
 *
 */
public class Crystal_ball extends Oracular implements Copyable {
    
    public int HabitatClass() {
        return CLASS_CRYSTAL_BALL;
    }
    
    public String HabitatModName() {
        return "Crystal_ball";
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "live" })
    public Crystal_ball(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger live) {
        super(style, x, y, orientation, gr_state, restricted, live);
    }

    public Crystal_ball(int style, int x, int y, int orientation, int gr_state, boolean restricted, int live) {
        super(style, x, y, orientation, gr_state, restricted, live);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Crystal_ball(style, x, y, orientation, gr_state, restricted, live);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOracular(new JSONLiteral(HabitatModName(), control));
        result.finish();
        return result;
    }

	/**
	 * Verb (Specific): TODO Ask of the Oracle!
	 * 
	 * @param from
	 *            User representing the connection making the request.
	 * @param text
	 *            The string to ask!
	 */
    @Override
	@JSONMethod({ "text" })
	public void ASK(User from, OptString text) {
		generic_ASK(from, text);
	}


    @JSONMethod
    public void HELP(User from) {
        super.HELP(from);
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
