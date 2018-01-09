package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;

/**
 * Habitat Game Piece Mod
 *
 * Simple items that fly from the ground to the avatar's hand and back.
 * NOTE: Meant to be used with the restricted property in board-game regions to keep all the pieces in place.
 *
 * @author randy
 */
public class Game_piece extends HabitatMod implements Copyable {

    public int HabitatClass() {
        return CLASS_GAME_PIECE;
    }

    public String HabitatModName() {
        return "Game_piece";
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
    
    public static final int CHECKER_PIECE   = 6;
    public static final int CHECKER_KING    = 7;

    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted" })
    public Game_piece(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    public Game_piece(int style, int x, int y, int orientation, int gr_state, boolean restricted) {
        super(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Game_piece(style, x, y, orientation, gr_state, restricted);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
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
    
    @JSONMethod
    public void HELP(User from) {
        String msg = "Game piece: GET brings it to you. DO the board to throw piece to desired spot.";
        if (gr_state == CHECKER_PIECE)
            msg += " DO the piece itself to \"king\" it.";
        else
            msg += " DO the piece itself to \"unking\" it.";
        send_reply_msg(from, msg);
    }
    
    @JSONMethod
    public void KING(User from) {
        if (gr_state == CHECKER_PIECE)
            gr_state = CHECKER_KING;
        else if (gr_state == CHECKER_KING)
            gr_state = CHECKER_PIECE;
        gen_flags[MODIFIED] = true;
        send_neighbor_msg(from, noid, "ROLL$", "state", gr_state);
        this.send_reply_msg(from, noid, "state", gr_state);
    }
    
    
}
