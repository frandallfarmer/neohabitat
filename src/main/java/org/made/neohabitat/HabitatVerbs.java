package org.made.neohabitat;

import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.foundation.json.OptString;
import org.elkoserver.server.context.GeneralMod;
import org.elkoserver.server.context.User;

/**
 * This interface defines what methods are required by Habitat Mods and come in
 * two basic flavors: 1) Class fixed state getters: Such as HabitatClass() and
 * capacity(). 2) Required verbs - what messages each Habitat Class type must
 * respond to, even if only to report illegal access.
 * 
 * @author randy
 *
 */
public interface HabitatVerbs extends GeneralMod, Constants {
    
    public int HabitatClass();
    
    public String HabitatModName();
    
    public int capacity();
    
    public int pc_state_bytes();
    
    public boolean known();
    
    public boolean opaque_container();
    
    public boolean filler();
    
    public void HELP(User from);
    
    public void ASK(User from, OptString text);
    
    public void GET(User from);
    
    public void PUT(User from, OptInteger containerNoid, OptInteger x, OptInteger y, OptInteger orientation);
    
    public void THROW(User from, int target, int x, int y);
    
    public void DO(User from);
    
    public void RDO(User from);    
}
