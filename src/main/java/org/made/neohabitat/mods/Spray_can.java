package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;


/**
 * Habitat Spray Can Mod
 *
 * Spray cans allow users to change the style of their Habitat avatar.  They
 * provide a fixed number of sprays (known as the charge) and are typically
 * sold within Vendos.
 *
 * @author steve
 */
public class Spray_can extends HabitatMod implements Copyable {

    public int HabitatClass() {
        return CLASS_SPRAY_CAN;
    }

    public String HabitatModName() {
        return "Spray_can";
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

    public static final String HELP_TEXT =
        "BODY SPRAYER: Point at desired limb, then select DO to color that limb. This "+
        "sprayer has %d sprays remaining.";

    public static final int LEG_LIMB = 0;
    public static final int TORSO_LIMB = 1;
    public static final int ARM_LIMB = 2;
    public static final int FACE_LIMB = 3;

    protected int charge = 100;

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "charge" })
    public Spray_can(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
        OptInteger gr_state, OptInteger charge) {
        super(style, x, y, orientation, gr_state);
        this.charge = charge.value(100);
    }

    public Spray_can(int style, int x, int y, int orientation, int gr_state, int charge) {
        super(style, x, y, orientation, gr_state);
        this.charge = charge;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Spray_can(style, x, y, orientation, gr_state, charge);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        if (result.control().toRepository()) {
            result.addParameter("charge", this.charge);
        }
        result.finish();
        return result;
    }

    protected int getPattern() {
        // PL/1 translation: pattern = and_bit(self.orientation, '0000000001111000'b);
        return this.orientation & 0x78;
    }

    @JSONMethod
    public void HELP(User from) {
        send_reply_msg(from, String.format(HELP_TEXT, this.charge));
    }

    @JSONMethod
    public void GET(User from) {
        generic_GET(from);
    }

    @JSONMethod({ "containerNoid", "x", "y", "orientation" })
    public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation) {
        generic_PUT(from, containerNoid.value(THE_REGION), avatar(from).x, avatar(from).y, avatar(from).orientation);
    }

    @JSONMethod({ "limb" })
    public void SPRAY(User from, OptInteger limb) {
        int curLimb = limb.value(TORSO_LIMB);
        int newPattern = getPattern();
        Avatar curAvatar = avatar(from);

        // Doesn't spray if we're not holding the sprayer.
        if (!holding(curAvatar, this)) {
            send_reply_msg(from, noid, "success", FALSE, "custom_1", curAvatar.custom[0], "custom_2",
                curAvatar.custom[1]);
            return;
        }

        // Doesn't spray if we've run out of charges.
        if (charge <= 0) {
            send_reply_msg(from, noid, "success", FALSE, "custom_1", curAvatar.custom[0], "custom_2",
                curAvatar.custom[1]);
            object_say(from, noid, "This sprayer has run out.");
            return;
        }

        // Applies the pattern represented by this Spray Can to the Avatar's selected limb.
        boolean success = false;
        switch(curLimb) {
            case TORSO_LIMB:
                success = true;
                newPattern = newPattern >> 3;
                int avatarTorsoLimbPattern = curAvatar.custom[0] & 0xF0;
                curAvatar.custom[0] = avatarTorsoLimbPattern | newPattern;
                break;
            case LEG_LIMB:
                success = true;
                newPattern = newPattern << 1;
                int avatarLegLimbPattern = curAvatar.custom[0] & 0xF;
                curAvatar.custom[0] = avatarLegLimbPattern | newPattern;
                break;
            case ARM_LIMB:
                success = true;
                newPattern = newPattern << 1;
                int avatarArmLimbPattern = curAvatar.custom[1] & 0xF;
                curAvatar.custom[1] = avatarArmLimbPattern | newPattern;
                break;
            case FACE_LIMB:
                HabitatMod curHeadObj = curAvatar.contents(Avatar.HEAD);
                if (curHeadObj != null && curHeadObj instanceof Head) {
                    // If we're modifying the Avatar's Head, applies Head-specific pattern change logic.
                    success = true;
                    Head curHead = (Head) curHeadObj;
                    curHead.orientation = (curHead.orientation & 0x87) | newPattern;
                    curHead.gen_flags[MODIFIED] = true;
                    curHead.checkpoint_object(curHead);
                    send_fiddle_msg(THE_REGION, curHead.noid, C64_ORIENT_OFFSET, new int[]{curHead.orientation});
                }
                break;
        }

        // Tells the Avatar's client whether the spray was a success and what the Avatar's new custom[] is.
        send_reply_msg(from, noid,
            "SPRAY_SUCCESS", success ? TRUE : FALSE,
        	"SPRAY_CUSTOMIZE_0", curAvatar.custom[0],
        	"SPRAY_CUSTOMIZE_1", curAvatar.custom[1]);
        
        if (success) {
            // The spray succeeded, so tells the Avatar's neighbors about the change and handles charge reduction.
        	this.send_neighbor_msg(from, noid, "SPRAY$",
        		"SPRAY_SPRAYEE", curAvatar.noid,
        		"SPRAY_CUSTOMIZE_0", curAvatar.custom[0],
        		"SPRAY_CUSTOMIZE_1", curAvatar.custom[1]);
            charge--;
            gen_flags[MODIFIED] = true;
            checkpoint_object(this);
            curAvatar.checkpoint_object(curAvatar);
            if (charge == 0) {
                object_say(from, noid, "This sprayer has run out.");
                send_goaway_msg(noid);
                destroy_object(this);
            }
        }
    }

    @JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
        generic_THROW(from, target, x, y);
    }

}
