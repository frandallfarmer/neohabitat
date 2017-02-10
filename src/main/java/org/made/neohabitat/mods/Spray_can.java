package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
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
public class Spray_can extends HabitatMod {

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

    protected int charge = 4;

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "charge" })
    public Spray_can(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation,
                     OptInteger gr_state, OptInteger charge) {
        super(style, x, y, orientation, gr_state);
        this.charge = charge.value(4);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("charge", this.charge);
        result.finish();
        return result;
    }

    protected int getPattern() {
        // PL/1 translation: pattern = and_bit(self.orientation, '0000000001111000'b);
        return this.orientation & 0x78;
    }

    /**
     * Tells the region to spray an avatar with the provided customization.
     *
     * @param noid
     * @param custom_1
     * @param custom_2
     */
    protected void send_spray_msg(int noid, int custom_1, int custom_2) {
        JSONLiteral msg = new_broadcast_msg(noid, "SPRAY$");
        msg.addParameter("noid", noid);
        msg.addParameter("custom_1", custom_1);
        msg.addParameter("custom_2", custom_2);
        msg.finish();
        context().send(msg);
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
        if (charge <= 0) {
            send_reply_msg(from, noid, "success", 0, "custom_1", curAvatar.custom[0], "custom_2", curAvatar.custom[1]);
            object_say(from, noid, "This sprayer has run out.");
            return;
        }

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
                    success = true;
                    Head curHead = (Head) curHeadObj;
                    curHead.orientation = (curHead.orientation & 0x87) | newPattern;
                    curHead.gen_flags[MODIFIED] = true;
                    curHead.checkpoint_object(curHead);
                    send_fiddle_msg(curHead.noid, C64_ORIENT_OFFSET, new int[]{curHead.orientation});
                }
                break;
        }
        send_reply_msg(from, noid, "success", success ? 1 : 0, "custom_1", curAvatar.custom[0], "custom_2",
            curAvatar.custom[1]);
        if (success) {
            send_spray_msg(curAvatar.noid, curAvatar.custom[0], curAvatar.custom[1]);
            charge--;
            gen_flags[MODIFIED] = true;
            curAvatar.checkpoint_object(curAvatar);
            if (charge == 0) {
                object_say(from, noid, "This sprayer has run out.");
                // TODO: Uncomment when object deletion is implemented.
                // send_goaway_msg(noid);
                // destroy_object(this);
            } else {
                checkpoint_object(this);
            }
        }
    }

    @JSONMethod({ "target", "x", "y" })
    public void THROW(User from, int target, int x, int y) {
        generic_THROW(from, target, x, y);
    }

}
