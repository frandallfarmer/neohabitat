package org.made.neohabitat.mods;

import org.elkoserver.foundation.json.JSONMethod;
import org.elkoserver.foundation.json.OptBoolean;
import org.elkoserver.foundation.json.OptInteger;
import org.elkoserver.json.EncodeControl;
import org.elkoserver.json.JSONLiteral;
import org.elkoserver.server.context.Item;
import org.elkoserver.server.context.User;
import org.made.neohabitat.Copyable;
import org.made.neohabitat.HabitatMod;
import org.made.neohabitat.Magical;
import org.made.neohabitat.Openable;

/**
 * Habitat Vendo_FRONT Mod (attached to an Elko Item.)
 * 
 * TODO FRF Documentation Missing
 * 
 * @author randy
 *
 */

public class Vendo_front extends Openable implements Copyable {
    
    public int HabitatClass() {
        return CLASS_VENDO_FRONT;
    }
    
    public String HabitatModName() {
        return "Vendo_front";
    }

    public int capacity() {
        return 10;
    }
    
    public int pc_state_bytes() {
        return 5;
    };
    
    public boolean known() {
        return true;
    }
    
    public boolean opaque_container() {
        return true;
    }
    
	public boolean  changeable		 () { return true; }

    public boolean filler() {
        return false;
    }

    /** The price for the item most recently put on display */
    private int		item_price		= 0;
    /** The item (slot) number currently on display */
    private int		display_item	= 0;
    /** SERVER ONLY: The prices for each item in this machine */
    private	int[]	prices			= {0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    /** SERVER ONLY: Total vending machine sales */
    private int		take			= 0;
    
    @JSONMethod({ "style", "x", "y", "orientation", "gr_state", "restricted", "open_flags", "key_lo", "key_hi", "item_price", "display_item", "take", "prices" })
    public Vendo_front(OptInteger style, OptInteger x, OptInteger y, OptInteger orientation, OptInteger gr_state, OptBoolean restricted,
        OptInteger open_flags, OptInteger key_lo, OptInteger key_hi,
        OptInteger item_price, OptInteger display_item, OptInteger take, int[] prices) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
        setVendoFrontState(item_price.value(0), display_item.value(0), take.value(0), prices); 
    }

    public Vendo_front(int style, int x, int y, int orientation, int gr_state,
    		boolean restricted, boolean[] open_flags, int key_lo, int key_hi,
    		int item_price, int display_item, int take, int[] prices) {
        super(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi);
        setVendoFrontState(item_price, display_item, take, prices);
    }
    
    public void setVendoFrontState(int item_price, int display_item, int take, int[] prices) {
    	this.item_price		= item_price;
    	this.display_item	= display_item;
    	this.take			= take;
    	if (prices == null) {
    		prices = new int[] { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
    	}
    	this.prices			= prices;
    }

    @Override
    public HabitatMod copyThisMod() {
        return new Vendo_front(style, x, y, orientation, gr_state, restricted, open_flags, key_lo, key_hi, item_price, display_item, take, prices);
    }

    @Override
    public JSONLiteral encode(EncodeControl control) {    	
        JSONLiteral result = super.encodeOpenable(new JSONLiteral(HabitatModName(), control));
        result.addParameter("display_item", display_item);
        if (control.toClient()) {
        	int price_lo = item_price % 256;
           	result.addParameter("price_lo", price_lo );
        	result.addParameter("price_hi", (item_price - price_lo) / 256 );
        }
        if (control.toRepository()) {
            result.addParameter("item_price", item_price);
        	result.addParameter("take", take);
        	result.addParameter("prices", prices);
        }
        result.finish();
        return result;
    }
    
    /**
     * Vendo HELP is special because it also displays information about the object on display.     * 
     */
    @JSONMethod
    public void HELP(User from) {
        vendo_HELP(from);
    }
    
    @JSONMethod
    public void VSELECT(User from) {
    	Vendo_front		front	= this;
    	Vendo_inside	inside	= (Vendo_inside) this.container();
    	HabitatMod		display = (HabitatMod) inside.contents(1);
    	if (display == null || front.contents(display_item) != null ) {
    		select_out_of_order(from, "bad config");
    		return;
    	}
    	int new_display_item	= display_item;
    	boolean found			= false;
    	for (int i = 0; i < front.capacity() - 1; i++) {
    		new_display_item = (new_display_item + 1) % front.capacity();
    		if (front.contents(new_display_item) != null) {
    			found = true;
    			break;
    		}
    	}
    	if (!found) {
    		select_out_of_order(from, "no stock");
    		return;
    	}
    	if (new_display_item >= prices.length) {
    		select_out_of_order(from, "missing price");
    		return;
    	}
    	HabitatMod newDisplay = (HabitatMod) front.contents(new_display_item);
    	int		   newClass   = newDisplay.HabitatClass();
    	if (new_display_item >= prices.length) {
    		int newPrices[] = new int[10];
    		System.arraycopy(prices, 0, newPrices, 0, prices.length);
    		prices = newPrices;
    	}
    	if (prices[new_display_item] == 0) {								  // 0 price == 125% of Pawn Value
    		prices[new_display_item] = (Pawn_machine.pawn_values[newClass] * 125) / 100;
    	}
    	if (prices[new_display_item] < Pawn_machine.pawn_values[newClass]) {  // NEOHABITAT FIX for KNOWN BUG/EXPLOIT. FRF
    		select_out_of_order(from, "price: " + prices[new_display_item] + " < pawn value:" + Pawn_machine.pawn_values[newClass]);
    		return;
    	}
    	if (!change_containers(display, front, display_item, true)) {
    		select_out_of_order(from, "reloading stock");
    		return;
    	}
    	if (!change_containers(newDisplay, inside, 1, true)) {
    		change_containers(display, inside, 1, true);	// Try to put it back
    		select_out_of_order(from, "loading display");
    		return;
    	}
    	display_item		= new_display_item;
    	item_price			= prices[display_item];
    	gen_flags[MODIFIED]	= true;
    	checkpoint_object(this);
    	send_reply_msg(from, noid, "price_lo", item_price % 256, "price_hi", (int) (item_price / 256), "display_item", display_item);
        send_neighbor_msg(from, avatar(from).noid, "POSTURE$", "new_posture", OPERATE);
    	send_neighbor_msg(from, noid, "VSELECT$", "price_lo", (int) (item_price % 256), "price_hi", (int) (item_price / 256), "display_item", display_item);    	    	
    }

    
    private void select_out_of_order(User from, String err) {
    	object_say(from, noid, "This machine is out of order.");
    	send_reply_msg(from, noid, "price_lo", 0, "price_hi", 0, "display_item", 255); /* fail */
    	trace_msg("Broken vendo: %s (%s)", object().ref(), err);
    }  
    
    /**
     * Put tokens in, get cloned items out!
     * 
     * @param from
     */
    @JSONMethod
    public void VEND(User from) {
    	Avatar			avatar	= (Avatar) from.getMod(Avatar.class);
    	Region			region	= (Region) current_region();
    	Vendo_inside	inside	= (Vendo_inside) this.container();
    	Copyable		display = (Copyable) inside.contents(1);
    	
    	if (Tokens.spend(from, item_price, Tokens.CLIENT_DESTROYS_TOKEN) == TRUE) {    		
    		HabitatMod vended	= (HabitatMod) display.copyThisMod();
    		vended.x = inside.x + 8;
    		vended.y = inside.y | 0x80;
    		Item item = create_object(((HabitatMod) display).HabitatModName().toLowerCase(), vended, region, false);
    		if (item == null) {
    			Tokens.spend(from, -(item_price), Tokens.CLIENT_DESTROYS_TOKEN);
    			send_reply_err(from, noid, BOING_FAILURE);
    			return;
    		}
    		checkpoint_object(vended);
    		JSONLiteral itemLiteral = item.encode(EncodeControl.forClient);
    		take += item_price;
    		gen_flags[MODIFIED] = true;
    		
    		JSONLiteral msg = new_neighbor_msg(noid, "SELL$");
			msg.addParameter("buyer", 			avatar.noid);
	        msg.addParameter("item_price_lo",	item_price % 256);
	        msg.addParameter("item_price_hi",	item_price / 256);
	        msg.addParameter("object",			itemLiteral);
	        msg.finish();
	        context().sendToNeighbors(from, msg);

	        msg = new_reply_msg(noid);
	        msg.addParameter("success",			TRUE);
	        msg.addParameter("item_price_lo",	item_price % 256);
	        msg.addParameter("item_price_hi",	item_price / 256);
	        msg.addParameter("object",			itemLiteral);
	        msg.finish();
	        from.send(msg);
	        return;
    	} else {
    		object_say(from,  "You don't have enough money.  This costs $" +  item_price +  ".");
    	}
    	send_reply_error(from);
    }
      
    
    private static String[] info_messages = {
    		"i",                                     /*   0 -- region */
    		"i",                                     /*   1 -- avatar */
    		"m",                                     /*   2 -- amulet */
    		"-",                                     /*   3 */
    		"i",                                     /*   4 -- atm */
    		"GAME PIECE, for board games of all kinds.", /*   5 -- game piece */
    		"BAG, a useful container.",              /*   6 -- bag */
    		"BALL, for throwing and playing.",       /*   7 -- ball */
    		"-",                                     /*   8 */
    		"-",                                     /*   9 */
    		"b",                                     /*  10 -- book */
    		"BOOMERANG, non-functional.",            /*  11 -- boomerang */
    		"BOTTLE, holds water.",                  /*  12 -- bottle */
    		"BOX, a useful container.",              /*  13 -- box */
    		"-",                                     /*  14 */
    		"-",                                     /*  15 */
    		"CLUB.",                                 /*  16 -- club */
    		"COMPASS, shows direction of West Pole.",/*  17 -- compass */
    		"i",                                     /*  18 -- countertop */
    		"-",                                     /*  19 */
    		"i",                                     /*  20 -- crystal ball */
    		"DIE, for immediate acess to random numbers.", /*  21 -- die */
    		"i",                                     /*  22 -- display case */
    		"i",                                     /*  23 -- door */
    		"i",                                     /*  24 -- dropbox */
    		"d",                                     /*  25 -- drugs */
    		"ESCAPE DEVICE, takes you home in a panic.", /*  26 -- escape device */
    		"GUN.",                                  /*  27 -- fake gun */
    		"i",                                     /*  28 -- elevator */
    		"i",                                     /*  29 -- flag */
    		"LIGHT, illuminates the dark places.",   /*  30 -- flashlight */
    		"FRISBEE, for throwing and playing",     /*  31 -- frisbee */
    		"i",                                     /*  32 -- garbage can */
    		"m",                                     /*  33 -- gemstone */
    		"-",                                     /*  34 */
    		"GRENADE.",                              /*  35 -- grenade */
    		"i",                                     /*  36 -- ground */
    		"GUN",                                   /*  37 -- gun */
    		"i",                                     /*  38 -- hand of god */
    		"-",                                     /*  39 -- hat */
    		"INSTANT OBJECT PILL",                   /*  40 -- instant object pill */
    		"-",                                     /*  41 -- jacket */
    		"k" ,                                    /*  42 -- key */
    		"KNICK-KNACK of some sort",              /*  43 -- knick knack */
    		"KNIFE.",                                /*  44 -- knife */
    		"i",                                     /*  45 -- magic lamp */
    		"m",                                     /*  46 -- magic staff */
    		"m",                                     /*  47 -- magic wand */
    		"i",                                     /*  48 -- mailbox */
    		"i",                                     /*  49 -- matchbook */
    		"-",                                     /*  50 */
    		"-",                                     /*  51 */
    		"MOVIE CAMERA.",                         /*  52 -- movie camera */
    		"-",                                     /*  53 */
    		"PAPER, for notes and mail.",            /*  54 -- paper */
    		"-",                                     /*  55 */
    		"i",                                     /*  56 -- short sign */
    		"i",                                     /*  57 -- sign */
    		"i",                                     /*  58 -- plant */
    		"-",                                     /*  59 */
    		"m",                                     /*  60 -- ring */
    		"i",                                     /*  61 -- rock */
    		"-",                                     /*  62 */
    		"SECURITY DEVICE.",                      /*  63 -- security device */
    		"s",                                     /*  64 -- sensor */
    		"-",                                     /*  65 */
    		"-",                                     /*  66 */
    		"-",                                     /*  67 */
    		"-",                                     /*  68 */
    		"i",                                     /*  69 -- sky */
    		"i",                                     /*  70 -- stereo */
    		"i",                                     /*  71 -- tape */
    		"-",                                     /*  72 */
    		"-",                                     /*  73 */
    		"i",                                     /*  74 -- teleport booth */
    		"i",                                     /*  75 -- ticket */
    		"i",                                     /*  76 -- tokens */
    		"-",                                     /*  77 */
    		"-",                                     /*  78 */
    		"-",                                     /*  79 */
    		"i",                                     /*  80 -- wall */
    		"-",                                     /*  81 */
    		"WINDUP TOY.",                           /*  82 -- windup toy */
    		"-",                                     /*  83 */
    		"CHANGE-O-MATIC, lets you change your Turf.", /*  84 -- changomatic */
    		"i",                                     /*  85 -- vendo front */
    		"i",                                     /*  86 -- vendo inside */
    		"i",                                     /*  87 -- trapezoid */
    		"i",                                     /*  88 -- hole */
    		"SHOVEL, for digging holes.",            /*  89 -- shovel */
    		"i",                                     /*  90 -- sex changer */
    		"STUN GUN.",                             /*  91 -- stun gun */
    		"i",                                     /*  92 -- super trapezoid */
    		"i",                                     /*  93 -- flat */
    		"TEST OBJECT!",                          /*  94 -- test */
    		"BODY SPRAYER, lets you change your body colors.", /*  95 -- spray can */
    		"i",                                     /*  96 -- pawn machine */
    		"i",                                     /*  97 -- switch / immobile magic */
    		"i",                                     /*  98 -- "glue" */
    		"-",                                     /*  99 */
    		"-",                                     /* 100 */
    		"-",                                     /* 101 */
    		"-",                                     /* 102 */
    		"-",                                     /* 103 */
    		"-",                                     /* 104 */
    		"-",                                     /* 105 */
    		"-",                                     /* 106 */
    		"-",                                     /* 107 */
    		"-",                                     /* 108 */
    		"-",                                     /* 109 */
    		"-",                                     /* 110 */
    		"-",                                     /* 111 */
    		"-",                                     /* 112 */
    		"-",                                     /* 113 */
    		"-",                                     /* 114 */
    		"-",                                     /* 115 */
    		"-",                                     /* 116 */
    		"-",                                     /* 117 */
    		"-",                                     /* 118 */
    		"-",                                     /* 119 */
    		"-",                                     /* 120 */
    		"-",                                     /* 121 */
    		"-",                                     /* 122 */
    		"-",                                     /* 123 */
    		"-",                                     /* 124 */
    		"-",                                     /* 125 */
    		"-",                                     /* 126 */
    		"HEAD.",                                 /* 127 -- head */
    		"-",                                     /* 128 */
    		"i",                                     /* 129 -- aquarium */
    		"i",                                     /* 130 -- bed */
    		"i",                                     /* 131 -- bridge */
    		"i",                                     /* 132 -- building */
    		"i",                                     /* 133 -- bush */
    		"i",                                     /* 134 -- chair */
    		"i",                                     /* 135 -- chest */
    		"i",                                     /* 136 -- coke machine */
    		"i",                                     /* 137 -- couch */
    		"i",                                     /* 138 -- fence */
    		"i",                                     /* 139 -- floor lamp */
    		"i",                                     /* 140 -- fortune machine */
    		"i",                                     /* 141 -- fountain */
    		"-",                                     /* 142 */
    		"i",                                     /* 143 -- house cat */
    		"i",                                     /* 144 -- hot tub */
    		"i",                                     /* 145 -- jukebox */
    		"-",                                     /* 146 */
    		"i",                                     /* 147 -- pond */
    		"i",                                     /* 148 -- river */
    		"i",                                     /* 149 -- roof */
    		"i",                                     /* 150 -- safe */
    		"-",                                     /* 151 */
    		"i",                                     /* 152 -- picture */
    		"i",                                     /* 153 -- street */
    		"i",                                     /* 154 -- streetlamp */
    		"i",                                     /* 155 -- table */
    		"i",                                     /* 156 -- tree */
    		"i",                                     /* 157 -- window */
    		"i"                                      /* 158 -- bureaucrat */
    };
    
    public void vendo_HELP(User from) {
    	Vendo_front		front	= this;
    	Vendo_inside	inside	= (Vendo_inside) this.container();
    	HabitatMod		display = (HabitatMod) inside.contents(1);
    	String 			msg		= info_messages[display.HabitatClass()];
    	switch (msg) {
    	case "-":
	          msg = "This object does not exist.";
	          break;
    	case "m":
	          msg = ((Magical) display).magic_vendo_info();
	          break;
    	case "k":
	          msg = ((Key) display).key_vendo_info((Key)display);
	          break;
    	case "b":
	          msg = ((Book) display).book_vendo_info();
			  break;
    	case "d":
	          msg = ((Drugs) display).drugs_vendo_info();
			  break;
    	case "s":
    		  msg = "BUG: MISSING vendo specific HELP for this object."; // TODO
	          break;
    	case "i":
    		display.trace_msg("Impossible vendo help request, class " + display.HabitatClass());
	        msg = "Hey!  This thing shouldn't be in a VenDroid";
	        break;
    	}
    	front.send_reply_msg(from, "VENDO: DO displays next selection.  PUT tokens here to purchase item on display.");
    	front.object_say(from, front.noid, msg + " $" + front.item_price);
    }
}
