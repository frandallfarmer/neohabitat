package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Drugs Mod
 *
 * A drug object is represented as a pill bottle. The bottle
 * contains a certain number of pills. This number is decremented
 * each time you take one. When they run out the bottle is no longer
 * effective. Taking a pill causes something to happen. There are
 * a variety of possible effects.
 * 
 *
 * @author TheCarlSaganExpress
 */
public class Drugs extends HabitatMod implements Copyable
{
	public int HabitatClass() {
		return CLASS_DRUGS;
	}

	public String HabitatModName() {
		return "Drugs";
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
	public static final int NUMBER_OF_DRUG_EFFECTS = 3;
	public int count = 3; //See struct_drugs.incl.pl1
	public int effect = NUMBER_OF_DRUG_EFFECTS; //Variables with /*Host Private:*/ variables should not be encoded
	public static final String[] drug_help = new String[] {
			"",						/* Blank space for initialization */
			"Healing pills: good for what ails you.", 	/* 1 -- heal_avatar */
			"DANGER!!  POISON!!",				/* 2 -- poison_avatar */
			"Darkening tablets."				/* 3 -- turn_avatar_black */
	};
	
	
	@JSONMethod({ "style", "x", "y", "orientation", "gr_state", "count", "effect"})
	public Drugs(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptInteger count, OptInteger effect) {
		super(style, x, y, orientation, gr_state);
		this.count = count.value(3);
		this.effect = effect.value(0);
	 
	}
	
	public Drugs(int style, int x, int y, int orientation, int gr_state, int count, int effect) {
        	super(style, x, y, orientation, gr_state);
        	this.count = count;
        	this.effect = effect;
	}
	
	@Override
	public HabitatMod copyThisMod() {
		return new Drugs(style, x, y, orientation, gr_state, count, effect);
	}
	
	@Override
	public JSONLiteral encode(EncodeControl control) {
		JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
		result.addParameter("count", count);
		if (control.toRepository()) {
	        	result.addParameter("effect", effect);
	    	}
		result.finish();
		return result;
	}
	
   	@JSONMethod
    	public void HELP(User from) {
    		drugs_HELP(from);
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
    
    
    	@JSONMethod
    	public void TAKE(User from){ 
    		Avatar curAvatar = avatar(from);
    		if((effect < 1) || (NUMBER_OF_DRUG_EFFECTS < effect)){
   		 	trace_msg("drugs_TAKE: drug object ", noid, "has illegal effect #", effect);
    	}
    	else if (holding(curAvatar, this) && count > 0){
    		count -= 1;
    		gen_flags[MODIFIED] = true;
    		send_neighbor_msg(from, curAvatar.noid, "TAKE$");
    		send_reply_msg(from, noid, "TAKE_SUCCESS", TRUE);
    		if(count <= 0){
    			destroy_object(this);
    			object_say(from, noid, "All gone!");
    		}
    	}
    	send_reply_error(from);
    	switch(effect) {
    	case 1:
    		heal_avatar(from);
    		break;
    	case 2:
    		poison_avatar(from);
   	 	break;
    	case 3:
   	 	turn_avatar_black(from);
   	 	break;
    	}
    }
    	
    
    public void heal_avatar(User from){
    	Avatar curAvatar = avatar(from);
    	curAvatar.health = 255;
    	object_say(from, curAvatar.noid, "I feel much better now.");
	checkpoint_object(this);
    }
    
    
    public void poison_avatar(User from ){
    	Avatar curAvatar = avatar(from);
    	object_say(from, curAvatar.noid, "I feel very sick.");
    	HabitatMod target =  current_region().noids[curAvatar.noid];
    	trace_msg("Killing Avatar %s...", target.obj_id());
    	kill_avatar((Avatar)target); 
    }
    
    
    public void turn_avatar_black(User from){
     	Avatar curAvatar = avatar(from);
    	HabitatMod curHeadObj = curAvatar.contents(Avatar.HEAD);
    	Head curHead = (Head) curHeadObj;
    	object_say(from, curAvatar.noid, "I feel very odd.");
    	curAvatar.custom[0] = 17;
    	curAvatar.custom[1] = 17;
    	send_fiddle_msg(THE_REGION, curAvatar.noid, C64_ORIENT_OFFSET, new int[]{curAvatar.custom[0],curAvatar.custom[1]});
    	if(curHeadObj != null){
    		curHeadObj = curAvatar.contents(curHead.noid);
    		curHead.gen_flags[MODIFIED] = true;
    		curHead.orientation = (curHead.orientation & 0x87);
    		curHead.orientation = (curHead.orientation | 0x8);
    		send_fiddle_msg(THE_REGION, curHead.noid, C64_ORIENT_OFFSET, new int[]{curHead.orientation});
    	}
    }
    
  
    public String vendo_info(){
    	if(effect < 1){
    		return "Illegal drugs.";
    	}
    	else if(effect > NUMBER_OF_DRUG_EFFECTS){
    		return "DRUGS, no information available (yet).";
    	}
		return drug_help[effect];
    }
    
 
    public void drugs_HELP(User from){
    	if(effect < 1 || effect > NUMBER_OF_DRUG_EFFECTS){
    		send_reply_msg(from, "Illegible Latin scrawl.");
    	}
    	else
    		send_reply_msg(from, "DRUGS: select do to consume. This pill bottle has " + count + " pills remaining. This bottle contians:");
    	object_say(from, noid, drug_help[effect]);
    }
}
