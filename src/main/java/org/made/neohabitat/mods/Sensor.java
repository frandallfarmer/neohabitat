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
 * Habitat Sensor Mod 
 * 
 * Tells some property of a region, object or avatar.
 *
 * @author TheCarlSaganExpress
 *
 */
public class Sensor extends HabitatMod implements Copyable {
        
    public int HabitatClass() {
        return CLASS_SENSOR;
    }
    
    public String HabitatModName() {
        return "Sensor";
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
    
    public boolean changeable() { 
        return true;
    }

    public boolean filler() {
        return false;
    }
    
    public int scan_type = 0;
    public final static int NUMBER_OF_SCAN_TYPES = 1;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "scan_type"})
    public Sensor(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
            OptInteger scan_type) {
        super(style, x, y, orientation, gr_state, restricted);
        this.scan_type = scan_type.value(0);
    }

    public Sensor(int style, int x, int y, int orientation, int gr_state, boolean restricted, int scan_type) {
        super(style, x, y, orientation, gr_state, restricted);
        this.scan_type = scan_type;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Sensor(style, x, y, orientation, gr_state, restricted, scan_type);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {
        JSONLiteral result = super.encodeCommon(new JSONLiteral(HabitatModName(), control));
        result.addParameter("scan_type", scan_type);
        result.finish();
        return result;
    }
    
    @JSONMethod
    public void HELP(User from) {
        sensor_HELP(from);
    }
    
    public void sensor_HELP(User from) {
        send_reply_msg(from, "SENSOR: Select DO to operate.");
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
    public void SCAN(User from) {
        int result = 0;
        Avatar curAvatar = avatar(from);
        if(holding(curAvatar, this)) {
            if(scan_type < 1) {
                object_say(from, "This sensor is broken.");
                result = FALSE;
            }
            else
                for(int i = 0; i < 255; i++) {
                    HabitatMod obj = current_region().noids[i];
                    if(obj != null && 
                            ((obj.HabitatClass() == CLASS_GUN)  ||
                            (obj.HabitatClass() == CLASS_KNIFE) ||
                            (obj.HabitatClass() == CLASS_CLUB)  ||
                            (obj.HabitatClass() == CLASS_GRENADE))){
                        result = TRUE;
                        break;
                    }
                        result = FALSE;
                }
                gr_state = result;
                gen_flags[MODIFIED] = true;
                send_neighbor_msg(from, noid, "SCAN$", "scan_type", result);  
        }
        else
            result = FALSE;
        send_reply_msg(from, noid, "SCAN_DETECTION", result);
    }
    
    public String sensor_vendo_info() {
        return "SENSOR, no information available (yet).";
    }
}
