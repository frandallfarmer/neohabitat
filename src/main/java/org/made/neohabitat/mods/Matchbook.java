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


/**
 * Habitat Matchbook Mod
 *
 * The Matchbook contains a small amount of text which is sent to
 * the client upon a README call.
 *
 * @author steve
 */
public class Matchbook extends HabitatMod implements Copyable {

    public final static int MAX_MATCHBOOK_TEXT_LENGTH = 84;

    public int HabitatClass() {
        return CLASS_MATCHBOOK;
    }

    public String HabitatModName() {
        return "Matchbook";
    }

    public int capacity() {
        return 0;
    }

    public int pc_state_bytes() {
        return 0;
    }

    public boolean known() {
        return true;
    }

    public boolean opaque_container() {
        return false;
    }

    public boolean filler() {
        return false;
    }

    private int ascii[] = {};

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "text", "ascii" })
    public Matchbook(OptInteger style, OptInteger x, OptInteger y,
        OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptString text, int[] ascii) {
        super(style, x, y, orientation, gr_state, restricted);
        if (ascii == null) {
            this.ascii = convert_to_petscii(text.value(""), MAX_MATCHBOOK_TEXT_LENGTH);
        } else {
            this.ascii = ascii;
        }
    }

    public Matchbook(int style, int x, int y, int orientation, int gr_state,
        boolean restricted, int[] ascii) {
        super(style, x, y, orientation, gr_state, restricted);
        this.ascii = ascii;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Matchbook(style, x, y, orientation, gr_state, restricted, ascii);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        if (control.toRepository()) {
            result.addParameter("ascii", ascii);
        }
        result.finish();
        return result;
    }

    @JSONMethod
    public void README(User from) {
        Avatar avatar = avatar(from);
        int[] readmeAscii = {};
        if (holding(avatar, this)) {
            readmeAscii = ascii;
        }
        JSONLiteral msg = new_reply_msg(noid);
        msg.addParameter("ascii", readmeAscii);
        msg.finish();
        from.send(msg);
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

}
