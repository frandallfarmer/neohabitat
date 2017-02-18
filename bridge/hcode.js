/**
 * @author Randy Farmer
 * @fileOverview Support functions to [en|de]code messages between a Habitat Client/Server
 */

/* jslint bitwise: true */
/* jshint esversion: 6 */

this.MICROCOSM_ID_BYTE	= 0x55;
this.ESCAPE_CHAR		= 0x5D;
this.END_OF_MESSAGE		= 0x0D;
this.ESCAPE_XOR			= 0x55;
this.BYTE_MASK			= 0b00000000000000000000000011111111;
this.PHANTOM_REQUEST	= 0xFA;

this.MAX_PACKET_SIZE    = 110;	// Really about half 255 - account for every char being 'escaped'
this.SPLIT_START		= 0x20;
this.SPLIT_MIDDLE		= 0x40;
this.SPLIT_END			= 0x80;
this.SPLIT_MASK			= ~(this.SPLIT_START | this.SPLIT_MIDDLE | this.SPLIT_END) & this.BYTE_MASK ;

this.REGION_NOID			= 0;
this.NORM					= 0;

this.MESSAGE_DESCRIBE		=	1;
this.MESSAGE_I_QUIT			=	2;
this.MESSAGE_IM_ALIVE		=	3;
this.MESSAGE_CUSTOMIZE		=	4;
this.MESSAGE_FINGER_IN_QUE	=	5;		// while catchup
this.MESSAGE_HERE_I_AM		=	6;		// materialize!
this.MESSAGE_PROMPT_REPLY	=	7;
this.MESSAGE_HEREIS			=	8;
this.MESSAGE_GOAWAY			=	9;		// object has left
this.MESSAGE_PORT			=	10;		// we have moved!
this.MESSAGE_UPDATE_DISK	=	11;		// update disk..
this.MESSAGE_FIDDLE			=	12;		// fiddle with object
this.MESSAGE_LIGHTING		=	13;		// change light level
this.MESSAGE_MUSIC			=	14;		// play a tune
this.MESSAGE_OBJECT_TALKS	=	15;		// an object speaks!
this.MESSAGE_WAIT_FOR_ANI	=	16;		// wait for an object
this.MESSAGE_CAUGHT_UP		=	17;
this.MESSAGE_APPEAR			=	18;
this.MESSAGE_CHANGE_CONT	=	19;
this.MESSAGE_PROMPT_USER	=	20;
this.MESSAGE_BEEN_MOVED		=	21;
this.MESSAGE_HOST_DUMP		=	22;

//object messages
this.MESSAGE_answer			=	4;
this.MESSAGE_askoracle		=	4;
this.MESSAGE_attack			=	4;
this.MESSAGE_bash			=	5;
this.MESSAGE_bugout			=	4;
this.MESSAGE_catalog		=	5;
this.MESSAGE_close			=	4;
this.MESSAGE_closecontainer	=	4;
this.MESSAGE_deposit		=	1;
this.MESSAGE_dial			=	5;
this.MESSAGE_fakeshoot		=	4;
this.MESSAGE_feed			=	4;
this.MESSAGE_fill			=	4;
this.MESSAGE_flush			=	6;
this.MESSAGE_get			=	1;
this.MESSAGE_grab			=	4;
this.MESSAGE_hand			=	5;
this.MESSAGE_hang			=	6;
this.MESSAGE_load			=	6;
this.MESSAGE_magic			=	4;
this.MESSAGE_newregion		=	9;
this.MESSAGE_off			=	4;
this.MESSAGE_offplayer		=	4;
this.MESSAGE_on				=	5;
this.MESSAGE_onplayer		=	5;
this.MESSAGE_open			=	5;
this.MESSAGE_opencontainer	=	5;
this.MESSAGE_pay			=	4;
this.MESSAGE_payto			=	4;
this.MESSAGE_playmessage	=	4;
this.MESSAGE_posture		=	6;
this.MESSAGE_pour			=	5;
this.MESSAGE_pullpin		=	4;
this.MESSAGE_put			=	2;
this.MESSAGE_read			=	4;
this.MESSAGE_readlabel		=	4;
this.MESSAGE_readmail		=	4;
this.MESSAGE_readme			=	4;
this.MESSAGE_reset			=	5;
this.MESSAGE_roll			=	4;
this.MESSAGE_rub			=	4;
this.MESSAGE_scan			=	4;
this.MESSAGE_select			=	6;
this.MESSAGE_sendmail		=	5;
this.MESSAGE_setanswer		=	5;
this.MESSAGE_speak			=	7;
this.MESSAGE_take			=	4;
this.MESSAGE_talk			=	7;
this.MESSAGE_throw			=	3;
this.MESSAGE_throwaway		=	3;
this.MESSAGE_unhook			=	8;
this.MESSAGE_unload			=	7;
this.MESSAGE_walk			=	8;
this.MESSAGE_wind			=	4;
this.MESSAGE_wish			=	5;
this.MESSAGE_withdraw		=	2;
this.MESSAGE_write			=	5;
this.MESSAGE_zapto			=	5;
this.MESSAGE_esp_speak		=	11;

this.SERVER_OPS = {
		"ANNOUNCE_$": 			{ reqno: 10 },
		"APPEARING_$": 			{ reqno: 18,
			toClient: function (o,b) {
				b.add(o.appearing);
			}
		},
		"ARRIVAL_$": 			{ reqno: 9 },
		"ATTACK$": 				{ reqno: 9,
			toClient: function (o, b) {
				b.add(o.ATTACK_TARGET);
				b.add(o.ATTACK_DAMAGE);
			}
		},
		"AUTO_TELEPORT_$": 		{ reqno: 21,
			toClient: function (o, b) {
				b.add(o.direction);
			}
		},
		"BASH$": 				{ reqno: 10,
			toClient: function (o, b) {
				b.add(o.BASH_TARGET);
				b.add(o.BASH_SUCCESS);
			}
		},
		"BEEP$": 				{ reqno: 8 },
		"BLAST$": 				{ reqno: 8 },
		"CAUGHT_UP_$":	 		{ reqno: 17,
			toClient: function (o, b) {
				b.add(o.err);
			},
		},
		"CHANGE$": 				{ reqno: 8 },
		"CHANGE_CONTAINERS_$":	{ reqno: 19,
			toClient: function (o, b) {
				b.add(o.object_noid);
				b.add(o.container_noid);
				b.add(o.x);
				b.add(o.y);
			}
		},
		"BUGOUT$": 				{ reqno: 8 },
		"CHANGESTATE$": 		{ reqno: 8 },
		"CHANGESTATE_$": 		{ reqno: 8 },
		"CLOSE$": 				{ reqno: 12,
			toClient: function (o,b) {
				b.add(o.target);
				b.add(o.open_flags);
			}
		},
		"CLOSECONTAINER$":	 	{ reqno: 13,
			toClient: function (o,b) {
				b.add(o.cont);
				b.add(o.open_flags);
			}
		},
		"DEPARTING_$": 			{ reqno: 10 },
		"DEPARTURE_$": 			{ reqno: 11 },
		"DIAL$": 				{ reqno: 10 },
		"DIE$": 				{ reqno: 11 },
		"DIG$": 				{ reqno: 8 },
		"DRIVE$": 				{ reqno: 8 },
		"EXPIRE_$": 			{ reqno: 9 },
		"EXPLODE_$": 			{ reqno: 8 },
		"FAKESHOOT$": 			{ reqno: 8 },
		"FIDDLE_$": 			{ reqno: 12,
			toClient: function (o,b) {
				b.add(o.target);
				b.add(o.offset);
				b.add(o.argCount);
				b.add(o.value);
			}
		},
		"FILL$": 				{ reqno: 8,
			toClient: function (o,b) {
				b.add(o.AVATAR_NOID);
			}
		},
		"FLUSH$": 				{ reqno: 8 },
		"GET$": 				{ reqno: 15,
			toClient: function (o,b) {
				b.add(o.target);
				b.add(o.how);
			}
		},
		"GOAWAY_$": 			{ reqno: 9,
			toClient: function (o,b) {
				b.add(o.target);
			}
		},
		"GRAB$": 				{ reqno: 16 },
		"GRABFROM$": 			{ reqno: 17 },
		"HANG$": 				{ reqno: 11 },
		"HEREIS_$":		 		{ reqno: 8,
			toClient: function (o, b, client) {
				b.add(client.backdoor.vectorize(client, o.object, o.container));
			}
		},
		"HUNGUP$": 				{ reqno: 12 },
		"LOAD$": 				{ reqno: 8 },
		"MAILARRIVED$":		 	{ reqno: 8 },
		"MUNCH$": 				{ reqno: 8 },
		"NEWHEAD$":	 			{ reqno: 31 },
		"OBJECTSPEAK_$":	 	{ reqno: 15, 
			toClient: function (o,b) {				
				b.add(o.speaker);
				b.add(o.text.getBytes());
			}
		},
		"OFF$":			 		{ reqno: 8 },
		"OFFLIGHT$":	 		{ reqno: 8 },
		"ON$": 					{ reqno: 9 },
		"ONLIGHT$": 			{ reqno: 9 },
		"OPEN$": 				{ reqno: 18,
			toClient: function (o,b) { 
				b.add(o.target);
			}
		},
		"OPENCONTAINER$": 		{ reqno: 19 },
		"ORACLESPEAK_$":	 	{ reqno: 8 },
		"PAID$":	 			{ reqno: 30,
			toClient: function (o, b, client) {
				b.add(o.payer);
				b.add(o.amount_lo);
				b.add(o.amount_hi);
				b.add(client.backdoor.vectorize(client, o.object, o.container));
			}
		},
		"PAY$": 				{ reqno: 8,
			toClient: function (o,b) {
				b.add(o.amount_lo);
				b.add(o.amount_hi);
			}
		},
		"PAYTO$":	 			{ reqno: 8,
			toClient: function (o,b) {
				b.add(o.payer);
				b.add(o.amount_lo);
				b.add(o.amount_hi);
			}
		},
		"PLAY_$": 				{ reqno: 14,
			toClient: function (o,b) {
				b.add(o.sfx_number);
				b.add(o.from_noid);
			}
		},
		"POSTURE$": 			{ reqno: 20,
			toClient: function (o,b) { 
				b.add(o.new_posture);
			}
		},
		"POUR$": 				{ reqno: 9,
			toClient: function (o,b) {
				b.add(o.AVATAR_NOID);
			}
		},
		"PROMPT_USER_$": 		{ reqno: 20,
			toClient: function (o,b) { 
				b.add(o.text.getBytes());
			}
		},
		"PUT$": 				{ reqno: 22,
			toClient: function (o,b) { 
				b.add(o.obj);
				b.add(o.cont);
				b.add(o.x);
				b.add(o.y);
				b.add(o.how);
				b.add(o.orient);
			}
		},
		"REINCARNATE$":		 	{ reqno: 23 },
		"REMOVE$":				{ reqno: 29 },
		"RESET$": 				{ reqno: 9 },
		"RETURN$": 				{ reqno: 1 },
		"CHANGELIGHT_$": 		{ reqno: 13,
			toClient: function (o, b) {
				b.add(o.SUCCESS);
			}
		},
		"ROLL$": 				{ reqno: 8 },
		"RUB$": 				{ reqno: 9 },
		"SCAN$":	 			{ reqno: 8 },
		"SELL$": 				{ reqno: 9 },
		"SEXCHANGE$": 			{ reqno: 8 },
		"SIT$": 				{ reqno: 16,
			toClient: function (o,b) {
				b.add(o.up_or_down);
				b.add(o.cont);
				b.add(o.slot);
			}
		},
		"SPEAK$":	 			{ reqno: 14, 
			toClient: function (o,b) {
				b.add(o.text.getBytes());
			}
		},
		"SPEAKFORTUNE$":	 	{ reqno: 10 },
		"SPRAY$": 				{ reqno: 8,
			toClient: function (o,b) {
				b.add(o.SPRAY_SPRAYEE);
				b.add(o.SPRAY_CUSTOMIZE_0);
				b.add(o.SPRAY_CUSTOMIZE_1);
			}
		},
		"TAKE$":		 		{ reqno: 8 },
		"TAKEMESSAGE$":		 	{ reqno: 8 },
		"THROW$": 				{ reqno: 24,
			toClient: function (o,b) {
				b.add(o.obj);
				b.add(o.x);
				b.add(o.y);
				b.add(o.hit);
			}
		},
		"THROWAWAY$": 			{ reqno: 8 },
		"TRANSFORM$": 			{ reqno: 8 },
		"UNHOOK$": 				{ reqno: 15 },
		"UPDATE$": 				{ reqno: 11 },
		"UNLOAD$": 				{ reqno: 8 },
		"VSELECT$": 			{ reqno: 8 },
		"WAITFOR_$": 			{ reqno: 16,
			toClient: function (o,b) {
				b.add(o.who);
			}
		},
		"WALK$":	 			{ reqno: 8,
			toClient: function (o,b) {
				b.add(o.x);
				b.add(o.y);
				b.add(o.how);
			} 
		},
		"WEAR$": 				{ reqno: 28 },
		"WIND$": 				{ reqno: 8 },
		"WISH$": 				{ reqno: 8 },
		"ZAPIN$":	 			{ reqno: 9 },
		"ZAPTO$": 				{ reqno: 10,
			toClient: function (o,b) { /* no args */ } 
		}
};

this.CLASSES 			= {		
		"Region":	0,   0:"Region",
		"Avatar":	1,   1:"Avatar",
		"Amulet":	2,   2:"Amulet",
		"Ghost":	3,   3:"Ghost",
		"Atm":		4,   4:"Atm",
		"Bag":		6,   6:"Bag",
		"Ball":		7,   7:"Ball",
		"Book":		10, 10:"Book",
		"Boomerang":11, 11:"Boomerang",
		"Bottle":	12, 12:"Bottle",
		"Box":		13, 13:"Box",
		"Club":		16, 16:"Club",
		"Compass":	17, 17:"Compass",
		"Countertop":18, 18:"Countertop",
		"Crystal_ball":20, 20:"Crystal_ball",
		"Display_case":22, 22:"Display_case",
		"Door":		23, 23:"Door",
		"Dropbox":	24, 24:"Dropbox",
		"Drugs":	25, 25:"Drugs",
		"Escape_device":26, 26:"Escape_device",
		"Fake_gun":	27, 27:"Fake_gun",
		"Flag":		29, 29:"Flag",
		"Flashlight":30, 30:"Flashlight",
		"Frisbee":	31, 31:"Frisbee",
		"Garbage_can":32, 32:"Garbage_can",
		"gemstone":	33, 33:"gemstone",
		"Grenade":	35, 35:"Grenade",
		"Ground":	36, 36:"Ground",
		"Gun":		37, 37:"Gun",
		"Hand_of_god":38, 38:"Hand_of_god",
		"Hat":		39, 39:"Hat",
		"Instant_object_pill":40, 40:"Instant_object_pill",
		"Key":		42, 42:"Key",
		"Knick_knack":43, 43:"Knick_knack",
		"Knife":	44, 44:"Knife",
		"Magic_lamp":45, 45:"Magic_lamp",
		"Magic_staff":46, 46:"Magic_staff",
		"Magic_wand":47, 47:"Magic_wand",
		"Mailbox":	48, 48:"Mailbox",
		"Matchbook":49, 49:"Matchbook",
		"Movie_camera":	52, 52:"Movie_camera",
		"Paper":	54, 54:"Paper",
		"Plaque":	55, 55:"Plaque",
		"Short_sign":56, 56:"Short_sign",
		"Sign":		57, 57:"Sign",
		"Plant":	58, 58:"Plant",
		"Ring":		60, 60:"Ring",
		"Rock":		61, 61:"Rock",
		"Security_device":63, 63:"Security_device",
		"Sensor":	64, 64:"Sensor",
		"Sky":		69, 69:"Sky",
		"Stereo":	70, 70:"Stereo",
		"Tape":		71, 71:"Tape",
		"Teleport":	74, 74:"Teleport",
		"Ticket":	75, 75:"Ticket",
		"Tokens":	76, 76:"Tokens",
		"Wall":		80, 80:"Wall",
		"Wind_up_toy":82, 82:"Wind_up_toy",
		"Changomatic":84, 84:"Changomatic",
		"Vendo_front":85, 85:"Vendo_front",
		"Vendo_inside":86, 86:"Vendo_inside",
		"Trapezoid":87, 87:"Trapezoid",
		"Hole":		88, 88:"Hole",
		"Shovel":	89, 89:"Shovel",
		"Sex_changer":90, 90:"Sex_changer",
		"Stun_gun":	91, 91:"Stun_gun",
		"Super_trapezoid":92, 92:"Super_trapezoid",
		"Flat":		93, 93:"Flat",
		"Test":		94, 94:"Test",
		"Spray_can":95, 95:"Spray_can",
		"Pawn_machine":	96, 96:"Pawn_machine",
		"Magic_immobile":97, 97:"Magic_immobile",
		"Glue":		98, 98:"Glue",
		"Head":		127, 127:"Head",
		"Aquarium":	129, 129:"Aquarium",
		"Bed":		130, 130:"Bed",
		"Bridge":	131, 131:"Bridge",
		"Building":	132, 132:"Building",
		"Bush":		133, 133:"Bush",
		"Chair":	134, 134:"Chair",
		"Chest":	135, 135:"Chest",
		"Coke_machine":	136, 136:"Coke_machine",
		"Couch":	137, 137:"Couch",
		"Fence":	138, 138:"Fence",
		"Floor_lamp":139, 139:"Floor_lamp",
		"Fortune_machine":140, 140:"Fortune_machine",
		"Fountain":	141, 141:"Fountain",
		"House_cat":143, 143:"House_cat",
		"Hot_tub":	144, 144:"Hot_tub",
		"Jukebox":	145, 145:"Jukebox",
		"Pond":		147, 147:"Pond",
		"River":	148, 148:"River",
		"Roof":		149, 149:"Roof",
		"Safe":		150, 150:"Safe",
		"Picture":	152, 152:"Picture",
		"Street":	153, 153:"Street",
		"Streetlamp":154, 154:"Streetlamp",
		"Table":	155, 155:"Table",
		"Tree":		156, 156:"Tree",
		"Window":	157, 157:"Window",
		"Zone":		255, 255:"Zone"
};

//HCode.requestToJSON is a list of functions that unpack binary client messages into JSON arguments for the server.
//If an op is not listed here the message has no additional arguments.
this.translate = {
		HELP:	 { 
			toClient: function(o, b) {
				if (o.text) {
					b.add(o.text.getBytes());
				} 
			}
		},
		GET:	 {
			toClient: function(o, b) {
				b.add(o.err);
			}
		},
		PUT:     {
			toServer: function(a, m) {
				m.containerNoid	= a[0];
				m.x				= a[1]; 
				m.y				= a[2];
				m.orientation	= a[3];
			},
			toClient: function(o, b) {
				b.add(o.err);
				b.add(o.pos);
			}		
		},
		WEAR:	{
			toClient: function(o, b) {
				b.add(o.err);
				b.add(o.err);
			}			
		},
		THROW:   {
			toServer: function(a, m) {
				m.target	= a[0];
				m.x			= a[1]; 
				m.y			= a[2];
			},
			toClient: function(o, b) {
				b.add(o.target);
				b.add(o.x);
				b.add(o.y);
				b.add(o.err);
			}
		},
		SPEAK: 	 {
			toServer: function(a, m) {
				m.esp	= a[0];
				m.text 	= String.fromCharCode.apply(null, a.slice(1));
			},
			toClient: function(o, b) {
				b.add(o.esp);
			} 
		},
		ASK:	{
			toServer: function(a, m) {
				m.text 	= String.fromCharCode.apply(null, a);
			},
		},
		POSTURE: { 
			toServer: function(a, m) {
				m.pose = a[0];
			},
			toClient: function(o, b) {
				b.add(o.err);
			}
		},		
		WALK: 	 {
			toServer: function(a, m) {
				m.x    = a[0]; 
				m.y    = a[1];
				m.how  = a[2];
			},
			toClient: function(o, b) {
				b.add(o.x);
				b.add(o.y);
				if ('how' in o) {
					b.add(o.how);
				}
			}
		},
		SITORSTAND: {
			toServer: function(a,m) {
				m.up_or_down	= a[0];
				m.seat_id		= a[1];
			},
			toClient: function(o,b) {
				b.add(o.err);
				b.add(o.slot);
			}
		},
		FNKEY:		{
			toServer: function(a, m) {
				m.key    = a[0]; 
				m.target = a[1];
			}
		},
		PROMPT_REPLY: {
			toServer: function(a,m) {
				m.text  = String.fromCharCode.apply(null, a);
			}
		},
		MAGIC:	{
			toClient: function(o, b) {
				b.add(o.err);
			},
			toServer: function(a,m) {
				m.target = a[0];
			}
		},
		OFF:	{
			toClient: function(o, b) {
				b.add(o.err);
			}
		},
		ON:		{
			toClient: function(o, b) {
				b.add(o.err);
			}
		},
		OPEN:	{
			toClient: function(o, b) {
				b.add(o.err);
			}			
		},
		CLOSE:	{
			toClient: function(o, b) {
				b.add(o.err);
			}			
		},
		OPENCONTAINER:	{
			toClient: function(o, b) {
				b.add(o.err);
			}			
		},
		CLOSECONTAINER:	{
			toClient: function(o, b) {
				b.add(o.err);
			}			
		},
		READ: {
			toServer: function(a, m) {
				m.page = a[0];
			},
			toClient: function(o, b) {
				b.add(o.nextpage);
				b.add(o.text.getBytes());
				return true;		// This reply should be split upon transmission to the client.
			}
 		},
		LEAVE: {
			toServer: function(a, m) {
				m.reason = a[0];
			}
		},
		NEWREGION: {
			toServer: function(a,m) {
				m.direction  = a[0];
				m.passage_id = a[1];
			},
			toClient: function(o, b) {
				b.add(o.err);
			}
		},
		SPRAY: {
			toServer: function(a, m) {
				m.limb = a[0];
			},
			toClient: function(o, b) {
				b.add(o.SPRAY_SUCCESS);
				b.add(o.SPRAY_CUSTOMIZE_0);
				b.add(o.SPRAY_CUSTOMIZE_1);
			}
		},
		DIRECT: {
			toClient: function(o, b) {
				b.add(o.text.getBytes());
			}
		},
		ATTACK: {
			toServer: function(a, m) {
				m.pointed_noid = a[0];
			},
			toClient: function(o, b) {
				b.add(o.ATTACK_result);
				b.add(o.ATTACK_target);
			}
		},
		PAYTO: {
			toServer: function(a,m) {
				m.target_id	= a[0];
				m.amount_lo = a[1];
				m.amount_hi = a[2];
			},
			toClient: function(o, b, client) {
				b.add(o.success);
				b.add(o.amount_lo);
				b.add(o.amount_hi);
				b.add(client.backdoor.vectorize(client, o.object, o.container));
			}
		},
		PAY: {
			toClient: function(o, b) {
				b.add(o.err);
				b.add(o.amount_lo);
				b.add(o.amount_hi);
				if ('text' in o) {
					b.add(o.text.getBytes());
				}
			}
		},
		SPLIT: {
			toServer: function(a,m) {
				m.amount_lo = a[0];
				m.amount_hi = a[1];
			},
			toClient: function(o, b) {
				b.add(o.err);
			}
		},
		STUN: {
			toServer: function(a,m) {
				m.target = a[0];
			},
			toClient: function(o, b) {
				b.add(o.err);
			}
		},
		DEPOSIT: {
			toServer: function(a, m) {
				m.token_noid = a[0];
			}
    },
		ZAPTO: {
			toServer: function(a,m) {
				m.port_number = String.fromCharCode.apply(null, a);
			},
			toClient: function(o, b) {
				b.add(o.err);
			}
		},
		WITHDRAW: {
			toServer: function(a, m) {
				m.amount_lo = a[0];
				m.amount_hi = a[1];
			},
			toClient: function(o, b) {
				b.add(o.amount_lo);
				b.add(o.amount_hi);
				b.add(o.result_code);
			}
		},
		FILL: {
			toClient: function(o, b) {
				b.add(o.err);
			}
		},
		POUR: {
			toClient: function(o, b) {
				b.add(o.err);
			}
		}
};

this.portable = {
		clientMessages:{
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			3:{ op:"THROW"}
		}
};


this.document	= {
		clientMessages: {
			0:{ op:"HELP" },
			4:{ op:"READ" }
		}
}

this.Region = {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"DESCRIBE" },
			2:{ op:"LEAVE" },
			3:{ op:"IMALIVE" },
			4:{ op:"CUSTOMIZE" },
			5:{ op:"FINGER_IN_QUE" },
			6:{ op:"I_AM_HERE" },
			7:{ op:"PROMPT_REPLY"}
		}
};

this.Avatar = { 
		clientMessages: {
			0: { op:"HELP" },
			4: { op:"GRAB" },
			5: { op:"HAND" },
			6: { op:"POSTURE" },
			7: { op:"SPEAK" },
			8: { op:"WALK" },
			9: { op:"NEWREGION" },
			10:{ op:"DISCORPORATE" },
			11:{ op:"ESP" },
			12:{ op:"SITORSTAND" },
			13:{ op:"TOUCH" },
			14:{ op:"FNKEY" }
		}
};

this.Head = {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			3:{ op:"THROW" },
			6:{ op:"WEAR" },
			7:{ op:"REMOVE" }
		}
};

this.portableContainer	= { 		
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			3:{ op:"THROW" },
			4:{ op:"CLOSECONTAINER" },
			5:{ op:"OPENCONTAINER" }
		}
};

this.Door	= { 		
		clientMessages: {
			0:{ op:"HELP" },
			4:{ op:"CLOSE" },
			5:{ op:"OPEN" }
		}
};

this.Table	= { 		
		clientMessages: {
			0:{ op:"HELP" },
			4:{ op:"CLOSECONTAINER" },
			5:{ op:"OPENCONTAINER" }
		}
};

this.Flashlight	= {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			3:{ op:"THROW" },
			4:{ op:"OFF" },
			5:{ op:"ON" }
		}		
};

this.Spray_can = {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			3:{ op:"THROW" },
			4:{ op:"SPRAY" }
		}
};

this.Floor_lamp	= {
		clientMessages: {
			0:{ op:"HELP" },
			4:{ op:"OFF" },
			5:{ op:"ON" }
		}		
};

this.Chest = {
	clientMessages: {
		0:{ op:"HELP" },
		4:{ op:"CLOSECONTAINER" },
		5:{ op:"OPENCONTAINER" }
	}
};

this.Countertop = {
	clientMessages: {
		0:{ op:"HELP" },
		4:{ op:"CLOSECONTAINER" },
		5:{ op:"OPENCONTAINER" }
	}
};

this.Bed = {
	clientMessages: {
		0:{ op:"HELP" },
		4:{ op:"CLOSECONTAINER" },
		5:{ op:"OPENCONTAINER" }
	}
};

this.Compass = {
	clientMessages: {
		0:{ op:"HELP" },
		1:{ op:"GET" },
		2:{ op:"PUT" },
		3:{ op:"THROW" },
		4:{ op:"DIRECT" }
	}
};

this.Fountain = {
		clientMessages: {
			0:{ op:"HELP" },
			4:{ op:"ASK" },
		}
};

this.Teleport = {
		clientMessages: {
			0:{ op:"HELP" },
			4:{ op:"PAY" },
			5:{ op:"ZAPTO" }
		}
}

this.Tokens = {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			3:{ op:"THROW" },
			4:{ op:"PAYTO" },
			5:{ op:"SPLIT" }
		}
};

this.Stun_gun = {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			5:{ op:"STUN" }
		}
};

this.Coke_machine = {
		clientMessages: {
			0:{ op:"HELP" },
			4:{ op:"PAY" }
		}
};

this.Fortune_machine = {
		clientMessages: {
			0:{ op:"HELP" },
			4:{ op:"PAY" }
		}
};

this.Atm	= {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"DEPOSIT" },
			2:{ op:"WITHDRAW" }
		}
};

this.Bottle  = {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			4:{ op:"FILL" },
			5:{ op:"POUR" }
		}
};

this.magical	= {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			3:{ op:"THROW" },
			4:{ op:"MAGIC" }
		}		
};

this.weapon = {
		clientMessages: {
			0:{ op:"HELP" },
			1:{ op:"GET" },
			2:{ op:"PUT" },
			5:{ op:"ATTACK" }
		}
};

this.help		= { 
		clientMessages: { 
			0:{ op:"HELP" }
		}
};

this.Bag				= this.portableContainer;
this.Box				= this.portableContainer;
this.Building			= this.help;
this.Bush				= this.help;
this.Glue				= this.help;
this.Ground				= this.portable;
this.Fence				= this.help;
this.Key				= this.portable;
this.Knick_knack		= this.magical;
this.Plaque				= this.document;
this.Rock				= this.portable;
this.Short_sign 		= this.help;
this.Sign 				= this.help;
this.Street				= this.help;
this.Tree				= this.help;
this.Wall				= this.portable;
this.Sky				= this.help;
this.Pond				= this.help;
this.House_cat		 	= this.help;
this.Roof				= this.help;
this.Couch				= this.help;
this.Window 			= this.help;
this.Chair				= this.help;
this.Plant				= this.portable;
this.Flag				= this.portable;
this.Trapezoid			= this.help;
this.Super_trapezoid 	= this.help;
this.Flat				= this.help;
this.Hot_tub		 	= this.help;
this.Gun       = this.weapon;
this.Knife   = this.weapon;
this.Club   = this.weapon;
this.Streetlamp = this.help;
