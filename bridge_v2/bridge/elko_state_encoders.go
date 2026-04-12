package bridge

import "github.com/rs/zerolog/log"

var ElkoStateEncoders = make(map[string]func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf)

func init() {
	// All encoders below mirror the JS bridge defaults: missing fields fall
	// back to 0 (or their domain-specific default) instead of panicking.

	ElkoStateEncoders["common"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		if buf == nil {
			buf = NewHabBufEmpty()
		}
		buf.AddInt(u8or(state.Style, 0))
		buf.AddInt(u8or(state.X, 0))
		buf.AddInt(u8or(state.Y, 0))
		buf.AddInt(u8or(state.Orientation, 0))
		buf.AddInt(u8or(state.GrState, 0))
		buf.AddInt(container)
		return buf
	}

	ElkoStateEncoders["document"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.LastPage, 0))
		return buf
	}

	ElkoStateEncoders["magical"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.MagicType, 0))
		return buf
	}

	ElkoStateEncoders["massive"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.Mass, 0))
		return buf
	}

	ElkoStateEncoders["toggle"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.On, 0))
		return buf
	}

	ElkoStateEncoders["openable"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.OpenFlags, 0))
		buf.AddInt(u8or(state.KeyLo, 0))
		buf.AddInt(u8or(state.KeyHi, 0))
		return buf
	}

	ElkoStateEncoders["walkable"] = ElkoStateEncoders["common"]

	ElkoStateEncoders["polygonal"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.TrapezoidType, 0))
		buf.AddInt(u8or(state.UpperLeftX, 0))
		buf.AddInt(u8or(state.UpperRightX, 0))
		buf.AddInt(u8or(state.LowerLeftX, 0))
		buf.AddInt(u8or(state.LowerRightX, 0))
		buf.AddInt(u8or(state.Height, 0))
		return buf
	}

	ElkoStateEncoders["Region"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		if buf == nil {
			buf = NewHabBufEmpty()
		}
		buf.AddInt(u8or(state.TerrainType, 0))
		// Sets default Region lighting at 1 if no lighting specified.
		buf.AddInt(u8or(state.Lighting, 1))
		buf.AddInt(u8or(state.Depth, 32))
		buf.AddInt(u8or(state.RegionClass, 0))
		// WhoAmI is the avatar-noid placeholder; the legacy bridge writes
		// UNASSIGNED_NOID (256) here and patches it at ContentsVector.Send
		// time. We can't fit 256 in a uint8, so we write 0 and the
		// matching fixup in contents_vector.go:Send replaces a 0 at
		// container.data[4] with the player's real avatar noid.
		buf.AddInt(u8or(state.WhoAmI, 0))
		buf.AddInt(0) // Bank account balance is patched in once we have the avatar object for this connection.
		buf.AddInt(0)
		buf.AddInt(0)
		buf.AddInt(0)
		return buf
	}

	ElkoStateEncoders["Avatar"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.Activity, 0))
		buf.AddInt(u8or(state.Action, 0))
		buf.AddInt(u8or(state.Health, 255))
		buf.AddInt(u8or(state.Restrainer, 0))
		custom := i32sor(state.Custom, []int32{0, 0})
		if len(custom) == 0 {
			custom = []int32{0, 0}
		}
		buf.AddInt32Slice(custom)
		return buf
	}

	ElkoStateEncoders["Key"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.KeyNumberLo, 0))
		buf.AddInt(u8or(state.KeyNumberHi, 0))
		return buf
	}

	ElkoStateEncoders["Sign"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt32Slice(i32sor(state.ASCII, nil))
		return buf
	}

	ElkoStateEncoders["Street"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.Width, 0))
		buf.AddInt(u8or(state.Height, 0))
		return buf
	}

	ElkoStateEncoders["Super_trapezoid"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["polygonal"](state, container, buf)
		buf.AddInt(u8or(state.PatternXSize, 0))
		buf.AddInt(u8or(state.PatternYSize, 0))
		buf.AddInt32Slice(i32sor(state.Pattern, nil))
		return buf
	}

	ElkoStateEncoders["Grenade"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.Pinpulled, 0))
		return buf
	}

	ElkoStateEncoders["Glue"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["openable"](state, container, buf)
		buf.AddInt(u8or(state.XOffset1, 0))
		buf.AddInt(u8or(state.YOffset1, 0))
		buf.AddInt(u8or(state.XOffset2, 0))
		buf.AddInt(u8or(state.YOffset2, 0))
		buf.AddInt(u8or(state.XOffset3, 0))
		buf.AddInt(u8or(state.YOffset3, 0))
		buf.AddInt(u8or(state.XOffset4, 0))
		buf.AddInt(u8or(state.YOffset4, 0))
		buf.AddInt(u8or(state.XOffset5, 0))
		buf.AddInt(u8or(state.YOffset5, 0))
		buf.AddInt(u8or(state.XOffset6, 0))
		buf.AddInt(u8or(state.YOffset6, 0))
		return buf
	}

	ElkoStateEncoders["Die"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.State, 0))
		return buf
	}

	ElkoStateEncoders["Drugs"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.Count, 0))
		return buf
	}

	ElkoStateEncoders["Fake_gun"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.State, 0))
		return buf
	}

	ElkoStateEncoders["Hand_of_god"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.State, 0))
		return buf
	}

	ElkoStateEncoders["Flat"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.FlatType, 0))
		return buf
	}

	ElkoStateEncoders["Tokens"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.DenomLo, 0))
		buf.AddInt(u8or(state.DenomHi, 0))
		return buf
	}

	ElkoStateEncoders["Bottle"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.Filled, 0))
		return buf
	}

	ElkoStateEncoders["Bridge"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.Width, 0))
		buf.AddInt(u8or(state.Height, 0))
		return buf
	}

	ElkoStateEncoders["Bureaucrat"] = ElkoStateEncoders["common"]

	ElkoStateEncoders["Teleport"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.ActiveState, 0))
		return buf
	}

	ElkoStateEncoders["Picture"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["massive"](state, container, buf)
		buf.AddInt32Slice(i32sor(state.Picture, nil))
		return buf
	}

	ElkoStateEncoders["Roof"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		return ElkoStateEncoders["common"](state, container, buf)
	}

	ElkoStateEncoders["Vendo_front"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["openable"](state, container, buf)
		buf.AddInt(u8or(state.PriceLo, 0))
		buf.AddInt(u8or(state.DisplayItem, 0))
		return buf
	}

	ElkoStateEncoders["Escape_device"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.Charge, 0))
		return buf
	}

	ElkoStateEncoders["Elevator"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.ActiveState, 0))
		return buf
	}

	ElkoStateEncoders["Windup_toy"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.WindLevel, 0))
		return buf
	}

	ElkoStateEncoders["Magic_lamp"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.LampState, 0))
		buf.AddInt(u8or(state.Wisher, 0))
		return buf
	}

	ElkoStateEncoders["Aquarium"] = func(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
		buf = ElkoStateEncoders["common"](state, container, buf)
		buf.AddInt(u8or(state.Fed, 0))
		return buf
	}

	ElkoStateEncoders["Amulet"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Atm"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Bag"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Ball"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Bed"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Book"] = ElkoStateEncoders["document"]
	ElkoStateEncoders["Box"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Building"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Bush"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Chair"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Changomatic"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Chest"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Club"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Coke_machine"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Compass"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Couch"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Countertop"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Crystal_ball"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Display_case"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Door"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Dropbox"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Fence"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Flag"] = ElkoStateEncoders["massive"]
	ElkoStateEncoders["Flashlight"] = ElkoStateEncoders["toggle"]
	ElkoStateEncoders["Floor_lamp"] = ElkoStateEncoders["toggle"]
	ElkoStateEncoders["Fortune_machine"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Fountain"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Frisbee"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Gemstone"] = ElkoStateEncoders["magical"]
	ElkoStateEncoders["Game_piece"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Garbage_can"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Ghost"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Ground"] = ElkoStateEncoders["walkable"]
	ElkoStateEncoders["Gun"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Head"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Hole"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Hot_tub"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["House_cat"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Knick_knack"] = ElkoStateEncoders["magical"]
	ElkoStateEncoders["Knife"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Magic_immobile"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Magic_staff"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Magic_wand"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Mailbox"] = ElkoStateEncoders["massive"]
	ElkoStateEncoders["Matchbook"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Movie_camera"] = ElkoStateEncoders["toggle"]
	ElkoStateEncoders["Paper"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Pawn_machine"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Plant"] = ElkoStateEncoders["massive"]
	ElkoStateEncoders["Plaque"] = ElkoStateEncoders["document"]
	ElkoStateEncoders["Pond"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Ring"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Rock"] = ElkoStateEncoders["massive"]
	ElkoStateEncoders["Safe"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Sensor"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Sex_changer"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Short_sign"] = ElkoStateEncoders["Sign"]
	ElkoStateEncoders["Shovel"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Sky"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Spray_can"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Streetlamp"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Stun_gun"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Table"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Trapezoid"] = ElkoStateEncoders["polygonal"]
	ElkoStateEncoders["Tree"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Vendo_inside"] = ElkoStateEncoders["openable"]
	ElkoStateEncoders["Wall"] = ElkoStateEncoders["common"]
	ElkoStateEncoders["Window"] = ElkoStateEncoders["common"]
}

func EncodeElkoModState(state *HabitatMod, container uint8, buf *HabBuf) *HabBuf {
	log.Trace().Msgf("Encoding mod: %s", state)
	if state == nil || state.Type == nil {
		log.Error().Msg("EncodeElkoModState called with nil state or nil Type")
		if buf == nil {
			buf = NewHabBufEmpty()
		}
		return buf
	}
	encoder, found := ElkoStateEncoders[*state.Type]
	if !found {
		log.Error().Msgf("No ElkoStateEncoder registered for class %q", *state.Type)
		if buf == nil {
			buf = NewHabBufEmpty()
		}
		return buf
	}
	return encoder(state, container, buf)
}
