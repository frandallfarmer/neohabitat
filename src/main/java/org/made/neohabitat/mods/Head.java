package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Container;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Head Mod (attached to an Elko Item.)
 * 
 * The Head is a complex object. When it's sitting in the region or a container,
 * it acts like any other object.
 * 
 * But, when carried (HANDS slot) or worn (HEAD slot) it is generally treated as
 * part of the containing avatar's body.
 * 
 * @author randy
 *
 */

public class Head extends HabitatMod implements Copyable {
    
    public int true_head = 0; //Replacement for true_head_style
    
    public int HabitatClass() {
        return CLASS_HEAD;
    }
    
    public String HabitatModName() {
        return "Head";
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
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "true_head" })
    public Head(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted, OptInteger true_head) {
        super(style, x, y, orientation, gr_state, restricted);
        this.true_head = style.value(0);
    }

    public Head(int style, int x, int y, int orientation, int gr_state, boolean restricted, int true_head) {
        super(style, x, y, orientation, gr_state, restricted);
        this.true_head = style;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Head(style, x, y, orientation, gr_state, restricted, true_head);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
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
        head_HELP(from);
    }
    
    /**
     * Verb (Generic): Pick this item up.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void GET(User from) {
        head_WEAR(from);
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
     * Verb (Specific): Move this head from my avatar's HANDS to the HEAD slot.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void WEAR(User from) {
        head_WEAR(from);
    }
    
    /**
     * Verb (Specific): Move this head from my avatar's HEAD to the HANDS slot.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    @JSONMethod
    public void REMOVE(User from) {
        head_REMOVE(from);
    }
    
    /**
     * Move this head from my avatar's HANDS to the HEAD slot.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void head_WEAR(User from) {
        Avatar avatar = avatar(from);
        Container cont = container();
        
        if (holding(avatar, this)) { // First handle putting the head "on" from
                                     // HANDS to HEAD slot.
            if (null != avatar.contents(HEAD)) {
                send_reply_error(from);
                return;
            } else if (!change_containers(this, avatar, HEAD, false)) {
                send_reply_error(from);
                trace_msg("*ERR* change_containers failed in head_WEAR for " + from.ref());
                return;
            }
            gr_state = 0;
            gen_flags[MODIFIED] = true;
            checkpoint_object(this);
            avatar.true_head_style = style;
            avatar.inc_record(HS$body_changes);
            send_neighbor_msg(from, avatar.noid, "WEAR$");
            send_reply_success(from);
        } else if (cont.HabitatClass() != CLASS_AVATAR || cont.noid == avatar.noid) {
            generic_GET(from); // Otherwise, get it from pocket or another
                               // container the normal way.
        } else {
            send_reply_error(from); // Should only happen when trying to grab a
                                    // head out of someones else's pocket.
        }
    }
    
    /**
     * Verb (Specific): Move this head from my avatar's HEAD to the HANDS slot.
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void head_REMOVE(User from) {
        Avatar avatar = avatar(from);
        int success = FALSE;
        
        if (avatar.curse_type == CURSE_COOTIES || avatar.curse_type == CURSE_SMILEY
                || avatar.curse_type == CURSE_MUTANT)
            object_say(from, noid, "You can't remove the head.  It is cursed.");
        else if (wearing(avatar, this) && empty_handed(avatar)) {
            if (change_containers(this, avatar, HANDS, false)) {
                success = TRUE;
                gr_state = HEAD_GROUND_STATE;
                gen_flags[MODIFIED] = true;
                checkpoint_object(this);
                send_neighbor_msg(from, avatar.noid, "REMOVE$", "target", noid);
            }
        }
        send_reply_err(from, this.noid, success);
    }
    
    /**
     * Reply with HELP for Heads
     * 
     * @param from
     *            User representing the connection making the request.
     */
    public void head_HELP(User from) {
        HabitatMod cont = container();
        if (cont.noid != THE_REGION) {
            if (cont.HabitatClass() == CLASS_AVATAR) {
                avatar((User) cont.object()).avatar_IDENTIFY(from,
                        this.noid); /* Warning! Tricky stuff here! */
                return;
            }
        }
        send_reply_msg(from,
                "HEAD: point at your body and select PUT to wear head.  GETing the head will remove it if you are wearing it.");
    }
}
