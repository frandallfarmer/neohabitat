package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Oracular;

/**
 * Habitat Magic Lamp Mod (attached to an Elko Item.)
 * 
 * Summon the Genie and make a wish!
 * 
 * @author randy
 *
 */
public class Magic_lamp extends Oracular implements Copyable {
    
    public int HabitatClass() {
        return CLASS_MAGIC_LAMP;
    }
    
    public String HabitatModName() {
        return "Magic_lamp";
    }
    
    public int capacity() {
        return 0;
    }
    
    public int pc_state_bytes() {
        return 2;
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
    
    /* Client shared state */
    public int 	lamp_state	= 0;
    /* Client shared state */
    public int 	wisher	= 0;

    /* Server only state */
    public int		lampNoid	= UNASSIGNED_NOID;
    public boolean	gaveWarning = false;
    public User		wisherUser	= null;
    
    private static final int GENIE_TIMEOUT = 30; // seconds
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "live", "lamp_state", "wisher" })
    public Magic_lamp(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger live, OptInteger lamp_state, OptInteger wisher) {
        super(style, x, y, orientation, new OptInteger(MAGIC_LAMP_WAITING), restricted, live);		// Reading from disk? Always reset.
        this.lamp_state = lamp_state.value(MAGIC_LAMP_WAITING);
        this.wisher = wisher.value(UNASSIGNED_NOID);
    }

    public Magic_lamp(int style, int x, int y, int orientation, int gr_state, boolean restricted, int live, int lamp_state, int wisher) {
        super(style, x, y, orientation, gr_state, restricted, live);
        this.lamp_state = lamp_state;
        this.wisher = wisher;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Magic_lamp(style, x, y, orientation, MAGIC_LAMP_WAITING, restricted, live, MAGIC_LAMP_WAITING, UNASSIGNED_NOID); // reset dupes.
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeOracular(new JSONLiteral(HabitatModName(), control));
        result.addParameter("lamp_state", lamp_state);
        result.addParameter("wisher", wisher);
        result.finish();
        return result;
    }
    
    @JSONMethod
    public void RUB(User from) {
    	Avatar 	avatar = avatar(from);
    	int		success = FALSE;
    	String	genie_speech = "";
    	
    	if (holding(avatar, this) && lamp_state == MAGIC_LAMP_WAITING) {
            lamp_state			= MAGIC_LAMP_GENIE;
            gr_state			= MAGIC_LAMP_GENIE;
            wisher				= avatar.noid;
            success 			= TRUE;
            lampNoid			= noid;
            gaveWarning			= false;
        	new Thread(Genie_Gets_Impatient).start();        	 
            genie_speech = "Oh, Master " + avatar.object().name() + ", your wish is my command!";
            send_neighbor_msg(from, noid, "RUB$", "RUB_MESSAGE", genie_speech);
    	}
    	JSONLiteral msg = this.new_reply_msg(noid);
    	msg.addParameter("RUB_SUCCESS", success);
    	msg.addParameter("RUB_MESSAGE", genie_speech);
    	msg.finish();
    	from.send(msg);
    }

    @JSONMethod({ "text" })
    public void WISH(User from, String text) {
    	Avatar 	avatar = avatar(from);    	
    	send_broadcast_msg(avatar.noid, "SPEAK$", "text", text);
    	if (wisher == avatar.noid) {
    		lampNoid = UNASSIGNED_NOID;
    		message_to_god(this, avatar, text);
    		send_broadcast_msg(noid, "WISH$", "WISH_MESSAGE", "Very well, I'll see what I can do.");
    		destroy_object(this);
    	} else {
    		if (wisher != UNASSIGNED_NOID) {
    			object_broadcast("Buzz off " + avatar.object().name()  + ", you creep!  It's not *your* wish.");
    		}
    	}
    }
    
    protected Runnable Genie_Gets_Impatient = new Runnable() {
    	@Override
    	public void run() {
    		try {
    			Thread.sleep(GENIE_TIMEOUT * 1000);
    			Magic_lamp lamp = (Magic_lamp) ((lampNoid == UNASSIGNED_NOID) ? null : current_region().noids[lampNoid]);
    			if (null != lamp && CLASS_MAGIC_LAMP == lamp.HabitatClass()) {
    				if (!gaveWarning) {
    					object_broadcast("Come on now, I don't have all day!");
    					gaveWarning = true;
    					new Thread(Genie_Gets_Impatient).start();        	 
    					return;
    				}
    				send_broadcast_msg(noid, "WISH$", "WISH_MESSAGE", "Sorry, I just don't have time for indecisiveness!");
    				destroy_object(lamp);
    			}
    		} catch (Exception e) {
    			trace_msg("Genie thread did not run to completion correctly. Something interrupted the flow.");
    		}    		
    	}
    };

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
