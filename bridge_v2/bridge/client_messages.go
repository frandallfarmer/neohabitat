package bridge

var ObjectClientMessages = make(map[string]map[uint8]string)

func init() {
	ObjectClientMessages["portable"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
	}
	ObjectClientMessages["document"] = map[uint8]string{
		0: "HELP",
		4: "READ",
	}
	ObjectClientMessages["Region"] = map[uint8]string{
		0: "HELP",
		1: "DESCRIBE",
		2: "LEAVE",
		3: "IMALIVE",
		4: "CUSTOMIZE",
		5: "FINGER_IN_QUE",
		6: "I_AM_HERE",
		7: "PROMPT_REPLY",
	}

	ObjectClientMessages["Avatar"] = map[uint8]string{
		0:  "HELP",
		4:  "GRAB",
		5:  "HAND",
		6:  "POSTURE",
		7:  "SPEAK",
		8:  "WALK",
		9:  "NEWREGION",
		10: "DISCORPORATE",
		11: "ESP",
		12: "SITORSTAND",
		13: "TOUCH",
		14: "FNKEY",
	}

	ObjectClientMessages["Grenade"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "PULLPIN",
	}

	ObjectClientMessages["Ghost"] = map[uint8]string{
		0:  "HELP",
		8:  "WALK",
		9:  "NEWREGION",
		10: "CORPORATE",
	}

	ObjectClientMessages["Head"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		6: "WEAR",
		7: "REMOVE",
	}

	ObjectClientMessages["portableContainer"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "CLOSECONTAINER",
		5: "OPENCONTAINER",
	}

	ObjectClientMessages["Die"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "ROLL",
	}

	ObjectClientMessages["Door"] = map[uint8]string{
		0: "HELP",
		4: "CLOSE",
		5: "OPEN",
	}

	ObjectClientMessages["Drugs"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "TAKE",
	}

	ObjectClientMessages["Table"] = map[uint8]string{
		0: "HELP",
		4: "CLOSECONTAINER",
		5: "OPENCONTAINER",
	}

	ObjectClientMessages["Safe"] = map[uint8]string{
		0: "HELP",
		4: "CLOSECONTAINER",
		5: "OPENCONTAINER",
	}

	ObjectClientMessages["Fake_gun"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "FAKESHOOT",
		5: "RESET",
	}

	ObjectClientMessages["Flashlight"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "OFF",
		5: "ON",
	}

	ObjectClientMessages["Sensor"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "SCAN",
	}

	ObjectClientMessages["Movie_camera"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "OFF",
		5: "ON",
	}

	ObjectClientMessages["Spray_can"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "SPRAY",
	}

	ObjectClientMessages["Changomatic"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "CHANGE",
	}

	ObjectClientMessages["Floor_lamp"] = map[uint8]string{
		0: "HELP",
		4: "OFF",
		5: "ON",
	}

	ObjectClientMessages["Chest"] = map[uint8]string{
		0: "HELP",
		4: "CLOSECONTAINER",
		5: "OPENCONTAINER",
	}

	ObjectClientMessages["Countertop"] = map[uint8]string{
		0: "HELP",
		4: "CLOSECONTAINER",
		5: "OPENCONTAINER",
	}

	ObjectClientMessages["Bed"] = map[uint8]string{
		0: "HELP",
		4: "CLOSECONTAINER",
		5: "OPENCONTAINER",
	}

	ObjectClientMessages["Compass"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "DIRECT",
	}

	ObjectClientMessages["Fountain"] = map[uint8]string{
		0: "HELP",
		4: "ASK",
	}

	ObjectClientMessages["Crystal_ball"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "ASK",
	}

	ObjectClientMessages["Teleport"] = map[uint8]string{
		0: "HELP",
		4: "PAY",
		5: "ZAPTO",
	}

	ObjectClientMessages["Tokens"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "PAYTO",
		5: "SPLIT",
	}

	ObjectClientMessages["Stun_gun"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		5: "STUN",
	}

	ObjectClientMessages["Coke_machine"] = map[uint8]string{
		0: "HELP",
		4: "PAY",
	}

	ObjectClientMessages["Fortune_machine"] = map[uint8]string{
		0: "HELP",
		4: "PAY",
	}

	ObjectClientMessages["Atm"] = map[uint8]string{
		0: "HELP",
		1: "DEPOSIT",
		2: "WITHDRAW",
	}

	ObjectClientMessages["Sex_changer"] = map[uint8]string{
		0: "HELP",
		4: "SEXCHANGE",
	}

	ObjectClientMessages["Garbage_can"] = map[uint8]string{
		0: "HELP",
		6: "FLUSH",
	}

	ObjectClientMessages["Pawn_machine"] = map[uint8]string{
		0: "HELP",
		6: "MUNCH",
	}

	ObjectClientMessages["Dropbox"] = map[uint8]string{
		0: "HELP",
		5: "SENDMAIL",
	}

	ObjectClientMessages["Bottle"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		4: "FILL",
		5: "POUR",
	}

	ObjectClientMessages["Display_case"] = map[uint8]string{
		0: "HELP",
		4: "CLOSECONTAINER",
		5: "OPENCONTAINER",
	}

	ObjectClientMessages["Book"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "READ",
	}

	ObjectClientMessages["Bureaucrat"] = map[uint8]string{
		0: "HELP",
		4: "ASK",
	}

	ObjectClientMessages["Vendo_inside"] = map[uint8]string{
		0: "HELP",
	}

	ObjectClientMessages["Vendo_front"] = map[uint8]string{
		0: "HELP",
		4: "VEND",
		5: "VSELECT",
	}

	ObjectClientMessages["Escape_device"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "BUGOUT",
	}

	ObjectClientMessages["Elevator"] = map[uint8]string{
		0: "HELP",
		5: "ZAPTO",
	}

	ObjectClientMessages["Shovel"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		4: "DIG",
	}

	ObjectClientMessages["Hole"] = map[uint8]string{
		0: "HELP",
		4: "CLOSECONTAINER",
		5: "OPENCONTAINER",
	}

	ObjectClientMessages["Hand_of_god"] = map[uint8]string{
		0: "HELP",
	}

	ObjectClientMessages["Matchbook"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "README",
	}

	ObjectClientMessages["Paper"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "READ",
		5: "WRITE",
		6: "PSENDMAIL",
	}

	ObjectClientMessages["magical"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "MAGIC",
	}

	ObjectClientMessages["weapon"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		5: "ATTACK",
	}

	ObjectClientMessages["help"] = map[uint8]string{
		0: "HELP",
	}

	ObjectClientMessages["Magic_staff"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		4: "MAGIC",
	}

	ObjectClientMessages["Magic_lamp"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "RUB",
		5: "WISH",
	}

	ObjectClientMessages["Magic_immobile"] = map[uint8]string{
		0: "HELP",
		4: "MAGIC",
	}

	ObjectClientMessages["Windup_toy"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "WIND",
	}

	ObjectClientMessages["Aquarium"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "FEED",
	}

	ObjectClientMessages["Game_piece"] = map[uint8]string{
		0: "HELP",
		1: "GET",
		2: "PUT",
		3: "THROW",
		4: "KING",
	}

	ObjectClientMessages["Amulet"] = ObjectClientMessages["magical"]
	ObjectClientMessages["Bag"] = ObjectClientMessages["portableContainer"]
	ObjectClientMessages["Ball"] = ObjectClientMessages["portable"]
	ObjectClientMessages["Box"] = ObjectClientMessages["portableContainer"]
	ObjectClientMessages["Bridge"] = ObjectClientMessages["help"]
	ObjectClientMessages["Building"] = ObjectClientMessages["help"]
	ObjectClientMessages["Bush"] = ObjectClientMessages["help"]
	ObjectClientMessages["Chair"] = ObjectClientMessages["help"]
	ObjectClientMessages["Club"] = ObjectClientMessages["weapon"]
	ObjectClientMessages["Couch"] = ObjectClientMessages["help"]
	ObjectClientMessages["Fence"] = ObjectClientMessages["help"]
	ObjectClientMessages["Flag"] = ObjectClientMessages["portable"]
	ObjectClientMessages["Flat"] = ObjectClientMessages["help"]
	ObjectClientMessages["Frisbee"] = ObjectClientMessages["portable"]
	ObjectClientMessages["Gemstone"] = ObjectClientMessages["magical"]
	ObjectClientMessages["Glue"] = ObjectClientMessages["help"]
	ObjectClientMessages["Ground"] = ObjectClientMessages["portable"]
	ObjectClientMessages["Gun"] = ObjectClientMessages["weapon"]
	ObjectClientMessages["Hot_tub"] = ObjectClientMessages["help"]
	ObjectClientMessages["House_cat"] = ObjectClientMessages["help"]
	ObjectClientMessages["Key"] = ObjectClientMessages["portable"]
	ObjectClientMessages["Knick_knack"] = ObjectClientMessages["magical"]
	ObjectClientMessages["Knife"] = ObjectClientMessages["weapon"]
	ObjectClientMessages["Magic_wand"] = ObjectClientMessages["magical"]
	ObjectClientMessages["Mailbox"] = ObjectClientMessages["help"]
	ObjectClientMessages["Picture"] = ObjectClientMessages["portable"]
	ObjectClientMessages["Plant"] = ObjectClientMessages["portable"]
	ObjectClientMessages["Plaque"] = ObjectClientMessages["document"]
	ObjectClientMessages["Pond"] = ObjectClientMessages["help"]
	ObjectClientMessages["Ring"] = ObjectClientMessages["magical"]
	ObjectClientMessages["Rock"] = ObjectClientMessages["portable"]
	ObjectClientMessages["Roof"] = ObjectClientMessages["help"]
	ObjectClientMessages["Short_sign"] = ObjectClientMessages["help"]
	ObjectClientMessages["Sign"] = ObjectClientMessages["help"]
	ObjectClientMessages["Sky"] = ObjectClientMessages["help"]
	ObjectClientMessages["Street"] = ObjectClientMessages["help"]
	ObjectClientMessages["Streetlamp"] = ObjectClientMessages["help"]
	ObjectClientMessages["Super_trapezoid"] = ObjectClientMessages["help"]
	ObjectClientMessages["Trapezoid"] = ObjectClientMessages["help"]
	ObjectClientMessages["Tree"] = ObjectClientMessages["help"]
	ObjectClientMessages["Wall"] = ObjectClientMessages["portable"]
	ObjectClientMessages["Window"] = ObjectClientMessages["help"]
}
