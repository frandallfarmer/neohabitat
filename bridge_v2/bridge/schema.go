package bridge

import (
	"encoding/json"
	"fmt"
)

type ElkoMessage struct {
	Adjustment           *uint8         `json:"adjustment,omitempty"`
	AmountLo             *uint8         `json:"amount_lo,omitempty"`
	AmountHi             *uint8         `json:"amount_hi,omitempty"`
	// *uint16 (not *uint8) because Elko uses UNASSIGNED_NOID (256) as a
	// sentinel for an avatar that hasn't been assigned a region noid
	// yet — the bridge's binary path narrows to GHOST_NOID at encode
	// time, but for JSON-passthrough clients we'd silently drop the
	// whole APPEARING_$ message if json.Unmarshal blew up here.
	Appearing            *uint16        `json:"appearing,omitempty"`
	ArgCount             *uint8         `json:"argCount,omitempty"`
	AttackResult         *uint8         `json:"ATTACK_result,omitempty"`
	AttackTarget         *uint8         `json:"ATTACK_target,omitempty"`
	AttackDamage         *uint8         `json:"ATTACK_DAMAGE,omitempty"`
	AvatarNoid           *uint8         `json:"AVATAR_NOID,omitempty"`
	ASCII                *[]uint8       `json:"ascii,omitempty"`
	Balance              *uint32        `json:"balance,omitempty"`
	BashTarget           *uint8         `json:"BASH_TARGET,omitempty"`
	BashSuccess          *uint8         `json:"BASH_SUCCESS,omitempty"`
	Body                 *HabitatObject `json:"body,omitempty"`
	Buyer                *uint8         `json:"buyer,omitempty"`
	ChangeNewOrientation *uint8         `json:"CHANGE_NEW_ORIENTATION,omitempty"`
	ChangeTarget         *uint8         `json:"CHANGE_TARGET,omitempty"`
	Cont                 *uint8         `json:"cont,omitempty"`
	Container            *string        `json:"container,omitempty"`
	ContainerNoid        *uint8         `json:"containerNoid,omitempty"`
	Context              *string        `json:"context,omitempty"`
	Count                *uint8         `json:"count,omitempty"`
	Direction            *uint8         `json:"direction,omitempty"`
	DisplayItem          *uint8         `json:"display_item,omitempty"`
	Err                  *uint8         `json:"err,omitempty"`
	Esp                  *uint8         `json:"esp,omitempty"`
	FakeshootSuccess     *uint8         `json:"FAKESHOOT_SUCCESS,omitempty"`
	Filler               *uint8         `json:"filler,omitempty"`
	FromNoid             *uint8         `json:"from_noid,omitempty"`
	Hit                  *uint8         `json:"hit,omitempty"`
	How                  *uint8         `json:"how,omitempty"`
	Immediate            *bool          `json:"immediate,omitempty"`
	ItemNoid             *uint8         `json:"item_noid,omitempty"`
	ItemPriceLo          *uint8         `json:"item_price_lo,omitempty"`
	ItemPriceHi          *uint8         `json:"item_price_hi,omitempty"`
	Limb                 *uint8         `json:"limb,omitempty"`
	Key                  *uint8         `json:"key,omitempty"`
	NewNoid              *uint8         `json:"newNoid,omitempty"`
	NewPosture           *uint8         `json:"new_posture,omitempty"`
	NextPage             *uint8         `json:"nextpage,omitempty"`
	Noid                 *uint8         `json:"noid,omitempty"`
	Obj                  *HabitatObject `json:"obj,omitempty"`
	Object               *HabitatObject `json:"object,omitempty"`
	ObjectNoid           *uint8         `json:"object_noid,omitempty"`
	Offset               *uint8         `json:"offset,omitempty"`
	Op                   *string        `json:"op,omitempty"`
	OpenFlags            *uint8         `json:"open_flags,omitempty"`
	Orient               *uint8         `json:"orient,omitempty"`
	Orientation          *uint8         `json:"orientation,omitempty"`
	Page                 *uint8         `json:"page,omitempty"`
	PassageId            *uint8         `json:"passage_id,omitempty"`
	Payer                *uint8         `json:"payer,omitempty"`
	PinPulled            *uint8         `json:"pinpulled,omitempty"`
	PointedNoid          *uint8         `json:"pointed_noid,omitempty"`
	Pos                  *uint8         `json:"pos,omitempty"`
	Pose                 *uint8         `json:"pose,omitempty"`
	PortNumber           *string        `json:"port_number,omitempty"`
	PriceLo              *uint8         `json:"price_lo,omitempty"`
	PriceHi              *uint8         `json:"price_hi,omitempty"`
	PullpinSuccess       *uint8         `json:"PULLPIN_SUCCESS,omitempty"`
	Reason               *uint8         `json:"reason,omitempty"`
	RequestASCII         *[]int         `json:"request_ascii,omitempty"`
	ResetSuccess         *uint8         `json:"RESET_SUCCESS,omitempty"`
	ResultCode           *uint8         `json:"result_code,omitempty"`
	RollState            *uint8         `json:"ROLL_STATE,omitempty"`
	RubMessage           *string        `json:"RUB_MESSAGE,omitempty"`
	RubSuccess           *uint8         `json:"RUB_SUCCESS,omitempty"`
	ScanDetection        *uint8         `json:"SCAN_DETECTION,omitempty"`
	ScanType             *uint8         `json:"scan_type,omitempty"`
	SeatId               *uint8         `json:"seat_id,omitempty"`
	SfxNumber            *uint8         `json:"sfx_number,omitempty"`
	Slot                 *uint8         `json:"slot,omitempty"`
	// *uint16 for the same UNASSIGNED_NOID sentinel reason as Appearing
	// above. OBJECTSPEAK_$ broadcasts ("X has arrived") use speaker=256
	// when the noid hasn't been assigned yet.
	Speaker              *uint16        `json:"speaker,omitempty"`
	SpraySprayee         *uint8         `json:"SPRAY_SPRAYEE,omitempty"`
	SpraySuccess         *uint8         `json:"SPRAY_SUCCESS,omitempty"`
	SprayCustomize0      *uint8         `json:"SPRAY_CUSTOMIZE_0,omitempty"`
	SprayCustomize1      *uint8         `json:"SPRAY_CUSTOMIZE_1,omitempty"`
	State                *uint8         `json:"state,omitempty"`
	Success              *uint8         `json:"success,omitempty"`
	SuppressReply        *bool          `json:"suppressReply,omitempty"`
	TakeSuccess          *uint8         `json:"TAKE_SUCCESS,omitempty"`
	Target               *uint8         `json:"target,omitempty"`
	TargetId             *uint8         `json:"target_id,omitempty"`
	TargetNoid           *uint8         `json:"targetNoid,omitempty"`
	Text                 *string        `json:"text,omitempty"`
	To                   *string        `json:"to,omitempty"`
	TokenNoid            *uint8         `json:"token_noid,omitempty"`
	Type                 string         `json:"type,omitempty"`
	UpOrDown             *uint8         `json:"up_or_down,omitempty"`
	User                 *string        `json:"user,omitempty"`
	Value                []uint8        `json:"value,omitempty"`
	WishMessage          *string        `json:"WISH_MESSAGE,omitempty"`
	Who                  *uint8         `json:"who,omitempty"`
	Why                  *string        `json:"why,omitempty"`
	WhyCode              *string        `json:"whycode,omitempty"`
	X                    *uint8         `json:"x,omitempty"`
	Y                    *uint8         `json:"y,omitempty"`
	You                  *bool          `json:"you,omitempty"`

	className         string
	classNumber       uint8
	clientMessages    map[uint8]string
	clientStateBundle *HabBuf
	container         uint8
	mod               *HabitatMod
	ref               string
	reqno             uint8
	toClient          func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool
}

func (m *ElkoMessage) UnmarshalJSON(text []byte) error {
	// Elko's wire format for several fields is polymorphic OR uses a
	// different key on the inbound (server→bridge) path than the
	// outbound (bridge→server) path. We can't capture that with a
	// single struct tag, so we peel the affected fields as RawMessage
	// and route them by shape / source:
	//
	//   - `body` is either an embedded HabitatObject (make, HEREIS_$) or
	//     the bare integer 0 (CORPORATE / DISCORPORATE replies — no body).
	//   - `obj` is either an embedded HabitatObject (make, HEREIS_$) or
	//     a bare noid integer (PUT$ / THROW$ neighbor broadcasts — see
	//     HabitatMod.java:828, :987). In the bare-noid case the value is
	//     the noid of the object being put down / thrown, which the
	//     downstream handlers read as `*o.ObjectNoid` (the same Go field
	//     CHANGE_CONTAINERS_$ populates via the `object_noid` key).
	//   - `container_noid` (snake_case) is what elko emits on the
	//     CHANGE_CONTAINERS_$ broadcast (Avatar.java:1436). The
	//     ContainerNoid struct tag is `containerNoid` (camelCase) because
	//     that's what elko expects on the inbound PUT verb
	//     (HabitatMod.PUT @JSONMethod). Same Go field, different wire
	//     keys in each direction — route the snake_case key into
	//     ContainerNoid manually so CHANGE_CONTAINERS_$ no longer drops
	//     the field on the floor (issue #502 caught this via the PUT$
	//     unmarshal failure, but it'd been silently latent for any
	//     inventory-handoff CHANGE_CONTAINERS_$ broadcast as well).
	//   - `noid` and `target` are typed *uint8 on the struct (matches
	//     what binary-mode encoders need at write time), but Elko can
	//     legitimately put 256 (UNASSIGNED_NOID) in either slot when
	//     the broadcasting / targeted avatar has no assigned region noid
	//     yet (e.g. a fresh JSON-passthrough avatar mid-PUT). The
	//     standard unmarshal would fail with "cannot unmarshal number
	//     256 into uint8" and the whole message would be dropped —
	//     including the PUT$ / GOAWAY_$ broadcasts that other clients
	//     in the region needed to see. Peel both as RawMessage and
	//     narrow UNASSIGNED_NOID (256) → GHOST_NOID (255), matching how
	//     Appearing and Speaker handle the same sentinel.
	//
	// Matches the legacy JS bridge, which tolerates either shape because
	// JavaScript is dynamically typed.
	type elkoMessage ElkoMessage
	type envelope struct {
		Body          json.RawMessage `json:"body,omitempty"`
		Obj           json.RawMessage `json:"obj,omitempty"`
		ContainerNoid json.RawMessage `json:"container_noid,omitempty"`
		Noid          json.RawMessage `json:"noid,omitempty"`
		Target        json.RawMessage `json:"target,omitempty"`
		Value         json.RawMessage `json:"value,omitempty"`
		*elkoMessage
	}
	aux := envelope{
		elkoMessage: &elkoMessage{
			Op: StringP(""),
			To: StringP(""),
		},
	}
	if err := json.Unmarshal(text, &aux); err != nil {
		return err
	}
	*m = ElkoMessage(*aux.elkoMessage)

	body := string(aux.Body)
	if len(body) > 0 && body != "0" && body != "null" {
		var ho HabitatObject
		if err := json.Unmarshal(aux.Body, &ho); err != nil {
			return fmt.Errorf("parsing elko message body: %w", err)
		}
		m.Body = &ho
	}

	if len(aux.Obj) > 0 && string(aux.Obj) != "null" {
		switch aux.Obj[0] {
		case '{':
			var ho HabitatObject
			if err := json.Unmarshal(aux.Obj, &ho); err != nil {
				return fmt.Errorf("parsing elko message obj: %w", err)
			}
			m.Obj = &ho
		default:
			// Bare integer noid (PUT$/THROW$). Decode into ObjectNoid so
			// the existing ServerOps handlers Just Work — they already
			// read *o.ObjectNoid for the noid of the object being acted
			// on. An explicit `object_noid` from the same message (if
			// any) would have been set by the standard unmarshal above;
			// re-setting it here from `obj` keeps the two consistent.
			// Use the same UNASSIGNED_NOID→GHOST_NOID narrowing as Noid /
			// Target — a fresh JSON-passthrough avatar mid-PUT broadcasts
			// `obj:256` for an unbound-noid object.
			narrowed, err := narrowNoidField(aux.Obj, "obj")
			if err != nil {
				return err
			}
			m.ObjectNoid = narrowed
		}
	}

	if len(aux.ContainerNoid) > 0 && string(aux.ContainerNoid) != "null" {
		var noid uint8
		if err := json.Unmarshal(aux.ContainerNoid, &noid); err != nil {
			return fmt.Errorf("parsing elko message container_noid: %w", err)
		}
		m.ContainerNoid = &noid
	}

	// noid and target may carry UNASSIGNED_NOID (256), which doesn't fit
	// in the *uint8 schema fields. Narrow to GHOST_NOID (255) on the way
	// in — matches the Appearing/Speaker convention and downstream
	// encoders treat 255 as "the ghost slot" so the binary path stays
	// internally consistent.
	if narrowed, err := narrowNoidField(aux.Noid, "noid"); err != nil {
		return err
	} else if narrowed != nil {
		m.Noid = narrowed
	}
	if narrowed, err := narrowNoidField(aux.Target, "target"); err != nil {
		return err
	} else if narrowed != nil {
		m.Target = narrowed
	}

	// `value` is polymorphic on the FIDDLE_$ wire format: a bare integer
	// for a single-arg fiddle and a JSON array for multi-arg fiddles
	// (HabitatMod.compose_fiddle_msg @ HabitatMod.java:2207-2211 — gr_state
	// vs. customize / token-denomination / posted-text). The scalar shape
	// parsed fine into the old *uint8 field, but the array shape failed the
	// whole-message unmarshal and the broadcast was silently dropped. Peel
	// it and accept either shape as a flat []uint8 so the FIDDLE_$ encoder
	// can emit all argCount value bytes.
	if len(aux.Value) > 0 && string(aux.Value) != "null" {
		if aux.Value[0] == '[' {
			var arr []uint8
			if err := json.Unmarshal(aux.Value, &arr); err != nil {
				return fmt.Errorf("parsing elko message value array: %w", err)
			}
			m.Value = arr
		} else {
			var scalar uint8
			if err := json.Unmarshal(aux.Value, &scalar); err != nil {
				return fmt.Errorf("parsing elko message value: %w", err)
			}
			m.Value = []uint8{scalar}
		}
	}

	return nil
}

// narrowNoidField decodes a JSON noid-shaped field into a *uint8,
// folding the elko UNASSIGNED_NOID (256) sentinel down to GHOST_NOID
// (255). Returns (nil, nil) when the raw is absent or explicitly null.
func narrowNoidField(raw json.RawMessage, name string) (*uint8, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var wide uint16
	if err := json.Unmarshal(raw, &wide); err != nil {
		return nil, fmt.Errorf("parsing elko message %s: %w", name, err)
	}
	var narrow uint8
	if wide == UNASSIGNED_NOID {
		narrow = GHOST_NOID
	} else {
		narrow = uint8(wide)
	}
	return &narrow, nil
}

func (e *ElkoMessage) String() string {
	marshalled, _ := json.Marshal(e)
	return string(marshalled)
}

type HabitatObject struct {
	Type string        `json:"type" bson:"type"`
	Ref  string        `json:"ref" bson:"ref"`
	Name string        `json:"name" bson:"name"`
	In   string        `json:"in,omitempty" bson:"in,omitempty"`
	Mods []*HabitatMod `json:"mods" bson:"mods"`
}

func (o *HabitatObject) HasTurf() bool {
	return o.Mods[0].Turf != nil && *o.Mods[0].Turf != "" && *o.Mods[0].Turf != "context-test"
}

func (o *HabitatObject) String() string {
	marshalled, _ := json.Marshal(o)
	return string(marshalled)
}

type HabitatMod struct {
	Action          *uint8    `json:"action,omitempty" bson:"action,omitempty"`
	ActiveState     *uint8    `json:"activeState,omitempty" bson:"activeState,omitempty"`
	Activity        *uint8    `json:"activity,omitempty" bson:"activity,omitempty"`
	AmAGhost        *bool     `json:"amAGhost,omitempty" bson:"amAGhost,omitempty"`
	ASCII           *[]int32  `json:"ascii,omitempty"`
	BankBalance     *uint32   `json:"bankBalance,omitempty" bson:"bankBalance,omitempty"`
	BodyType        *string   `json:"bodyType,omitempty" bson:"bodyType,omitempty"`
	Charge          *uint8    `json:"charge,omitempty" bson:"charge,omitempty"`
	ContainerNoid   *uint8    `json:"containerNoid,omitempty" bson:"containernoid,omitempty"`
	Count           *uint8    `json:"count,omitempty" bson:"count,omitempty"`
	CurseCount      *uint8    `json:"curse_count,omitempty" bson:"curse_count,omitempty"`
	CurseType       *uint8    `json:"curse_type,omitempty" bson:"curse_type,omitempty"`
	Custom          *[]int32  `json:"custom,omitempty" bson:"custom,omitempty"`
	DenomHi         *uint8    `json:"denom_hi,omitempty" bson:"denom_hi,omitempty"`
	DenomLo         *uint8    `json:"denom_lo,omitempty" bson:"denom_lo,omitempty"`
	Depth           *uint8    `json:"depth,omitempty" bson:"depth,omitempty"`
	DisplayItem     *uint8    `json:"display_item,omitempty" bson:"display_item,omitempty"`
	Err             *uint8    `json:"err,omitempty" bson:"err,omitempty"`
	Fed             *uint8    `json:"fed,omitempty" bson:"fed,omitempty"`
	Filled          *uint8    `json:"filled,omitempty" bson:"filled,omitempty"`
	FirstConnection *bool     `json:"firstConnection,omitempty" bson:"firstConnection,omitempty"`
	FlatType        *uint8    `json:"flat_type,omitempty" bson:"flat_type,omitempty"`
	GrState         *uint8    `json:"gr_state,omitempty" bson:"gr_state,omitempty"`
	Health          *uint8    `json:"health,omitempty" bson:"health,omitempty"`
	Height          *uint8    `json:"height,omitempty" bson:"height,omitempty"`
	IsTurf          *bool     `json:"is_turf,omitempty" bson:"is_turf,omitempty"`
	LampState       *uint8    `json:"lamp_state,omitempty" bson:"lamp_state,omitempty"`
	LastArrivedIn   *string   `json:"lastArrivedIn,omitempty" bson:"lastArrivedIn,omitempty"`
	LastPage        *uint8    `json:"last_page,omitempty" bson:"last_page,omitempty"`
	Lighting        *int8     `json:"lighting,omitempty" bson:"lighting,omitempty"`
	LowerLeftX      *uint8    `json:"lower_left_x,omitempty" bson:"lower_left_x,omitempty"`
	LowerRightX     *uint8    `json:"lower_right_x,omitempty" bson:"lower_right_x,omitempty"`
	MagicType       *uint8    `json:"magic_type,omitempty" bson:"magic_type,omitempty"`
	Mass            *uint8    `json:"mass,omitempty" bson:"mass,omitempty"`
	Neighbors       *[]string `json:"neighbors,omitempty" bson:"neighbors,omitempty"`
	// NittyBits is *int32 rather than *uint8 because legacy elko-Java
	// data sometimes stored values >255 (sentinels like 0x40000008 mixed
	// in with the nominal flag byte). Wire/protocol use is still single-byte
	// — callers should mask & 0xFF when serializing back to clients.
	NittyBits       *int32    `json:"nitty_bits,omitempty" bson:"nitty_bits,omitempty"`
	// Noid is uint16 (not uint8) because Elko sends 256 as a sentinel for
	// "the session user's own objects" — Avatar, Head, Paper, Tokens —
	// before the bridge has assigned a local noid. See UNASSIGNED_NOID.
	Noid            *uint16   `json:"noid,omitempty" bson:"noid,omitempty"`
	On              *uint8    `json:"on,omitempty" bson:"on,omitempty"`
	OpenFlags       *uint8    `json:"open_flags,omitempty" bson:"open_flags,omitempty"`
	KeyLo           *uint8    `json:"key_lo,omitempty" bson:"key_lo,omitempty"`
	KeyHi           *uint8    `json:"key_hi,omitempty" bson:"key_hi,omitempty"`
	KeyNumberLo     *uint8    `json:"key_number_lo,omitempty" bson:"key_number_lo,omitempty"`
	KeyNumberHi     *uint8    `json:"key_number_hi,omitempty" bson:"key_number_hi,omitempty"`
	Orientation     *uint8    `json:"orientation" bson:"orientation"`
	Pattern         *[]int32  `json:"pattern,omitempty" bson:"pattern,omitempty"`
	PatternXSize    *uint8    `json:"pattern_x_size,omitempty" bson:"pattern_x_size,omitempty"`
	PatternYSize    *uint8    `json:"pattern_y_size,omitempty" bson:"pattern_y_size,omitempty"`
	Picture         *[]int32  `json:"picture,omitempty" bson:"picture,omitempty"`
	Pinpulled       *uint8    `json:"pinpulled,omitempty" bson:"pinpulled,omitempty"`
	Pos             *uint8    `json:"pos,omitempty" bson:"pos,omitempty"`
	PriceLo         *uint8    `json:"price_lo,omitempty" bson:"price_lo,omitempty"`
	Realm           *string   `json:"realm,omitempty" bson:"realm,omitempty"`
	RegionClass     *uint8    `json:"region_class,omitempty" bson:"region_class,omitempty"`
	Resident        *string   `json:"resident,omitempty" bson:"resident,omitempty"`
	Restrainer      *uint8    `json:"restrainer,omitempty" bson:"restrainer,omitempty"`
	ShutdownSize    *uint64   `json:"shutdown_size,omitempty" bson:"shutdown_size,omitempty"`
	SittingAction   *uint8    `json:"sittingAction,omitempty" bson:"sittingAction,omitempty"`
	SittingIn       *uint8    `json:"sittingIn,omitempty" bson:"sittingIn,omitempty"`
	SittingSlot     *uint8    `json:"sittingSlot,omitempty" bson:"sittingSlot,omitempty"`
	State           *uint8    `json:"state,omitempty" bson:"state,omitempty"`
	StunCount       *uint8    `json:"stun_count,omitempty" bson:"stun_count,omitempty"`
	Style           *uint8    `json:"style,omitempty" bson:"style,omitempty"`
	Target          *uint8    `json:"target,omitempty" bson:"target,omitempty"`
	TerrainType     *uint8    `json:"terrain_type,omitempty" bson:"terrain_type,omitempty"`
	TrapezoidType   *uint8    `json:"trapezoid_type,omitempty" bson:"trapezoid_type,omitempty"`
	Turf            *string   `json:"turf,omitempty" bson:"turf,omitempty"`
	Type            *string   `json:"type" bson:"type"`
	UpperLeftX      *uint8    `json:"upper_left_x,omitempty" bson:"upper_left_x,omitempty"`
	UpperRightX     *uint8    `json:"upper_right_x,omitempty" bson:"upper_right_x,omitempty"`
	WhoAmI          *uint8    `json:"Who_am_I,omitempty" bson:"Who_am_I,omitempty"`
	Width           *uint8    `json:"width,omitempty" bson:"width,omitempty"`
	WindLevel       *uint8    `json:"wind_level,omitempty" bson:"wind_level,omitempty"`
	// *uint16 (not *uint8): Magic_lamp's wisher is UNASSIGNED_NOID (256) when no wish is
	// in flight (Magic_lamp.java), which overflows uint8 — json.Unmarshal then dropped the
	// whole `make` message ("cannot unmarshal number 256 into ... uint8"). Same convention
	// as Appearing/Speaker; narrowed back to a byte at binary-encode time via noidU8.
	Wisher          *uint16   `json:"wisher,omitempty" bson:"wisher,omitempty"`
	X               *uint8    `json:"x,omitempty" bson:"x,omitempty"`
	XOffset1        *uint8    `json:"x_offset_1,omitempty" bson:"x_offset_1,omitempty"`
	XOffset2        *uint8    `json:"x_offset_2,omitempty" bson:"x_offset_2,omitempty"`
	XOffset3        *uint8    `json:"x_offset_3,omitempty" bson:"x_offset_3,omitempty"`
	XOffset4        *uint8    `json:"x_offset_4,omitempty" bson:"x_offset_4,omitempty"`
	XOffset5        *uint8    `json:"x_offset_5,omitempty" bson:"x_offset_5,omitempty"`
	XOffset6        *uint8    `json:"x_offset_6,omitempty" bson:"x_offset_6,omitempty"`
	Y               *uint8    `json:"y,omitempty" bson:"y,omitempty"`
	YOffset1        *uint8    `json:"y_offset_1,omitempty" bson:"y_offset_1,omitempty"`
	YOffset2        *uint8    `json:"y_offset_2,omitempty" bson:"y_offset_2,omitempty"`
	YOffset3        *uint8    `json:"y_offset_3,omitempty" bson:"y_offset_3,omitempty"`
	YOffset4        *uint8    `json:"y_offset_4,omitempty" bson:"y_offset_4,omitempty"`
	YOffset5        *uint8    `json:"y_offset_5,omitempty" bson:"y_offset_5,omitempty"`
	YOffset6        *uint8    `json:"y_offset_6,omitempty" bson:"y_offset_6,omitempty"`
}

func (m *HabitatMod) UnmarshalJSON(text []byte) error {
	type habitatMod HabitatMod
	mod := habitatMod{
		KeyLo:       Uint8P(0),
		KeyHi:       Uint8P(0),
		Noid:        Uint16P(0),
		OpenFlags:   Uint8P(0),
		RegionClass: Uint8P(0),
		TerrainType: Uint8P(0),
	}
	if err := json.Unmarshal(text, &mod); err != nil {
		return err
	}
	*m = HabitatMod(mod)
	return nil
}

func (m *HabitatMod) String() string {
	marshalled, _ := json.Marshal(m)
	return string(marshalled)
}
