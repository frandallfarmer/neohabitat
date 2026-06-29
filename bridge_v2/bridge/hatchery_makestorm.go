package bridge

import "encoding/json"

// Synthetic Hatchery make-storm for JSON clients (the web client).
//
// The original hatchery is a C64 binary handshake: IM_ALIVE → byte(2) ||
// customizationVector → CUSTOMIZE → reply (client_session.go). The vector is a
// full make-storm — it describes the Avatar (#1), a ground/wall backdrop, and the
// eight selectable heads (#4–11) of a fake region the C64 unpacks and customizes
// (custom.m). The web client can't read those raw bytes, but it already renders an
// ordinary Elko make-storm, so here we DECODE the same canonical vector into the
// neutral object set and EMIT it as JSON makes. The binary path is untouched —
// it still ships the raw bytes — so the two encoders share one source (the vector)
// and the C64 wire format can't drift (TestHatcheryVectorGolden).
//
// The scene is minimal but faithful in the part that matters: the Avatar BODY
// (you:true, so world.me resolves) wearing one of the eight heads, plus a
// HATCHERY_$ signal carrying all eight styles so the client's F2 can cycle them.

// HatcheryContextRef is the fake region the customizer Avatar stands in. It never
// reaches Elko (the user has no avatar yet); it exists only for the web client's
// world model during customization.
const HatcheryContextRef = "context-hatchery"

// All state below is decoded from the canonical hatchery customization vector
// (HatcheryCustomizationVector) using the C64 contents-vector object format the
// bridge encodes for QLink clients (elko_state_encoders.go):
//
//	common = [style, x, y, orientation, gr_state, container]
//	Avatar = common + [activity, action, health, restrainer, custom0, custom1]
//	Region = [terrain, lighting, depth, region_class, who_am_i, bank…]
//
// CV records:
//
//	header  0,0,32,0,1,…                     -> depth 32, who_am_i=avatar noid 1
//	#1 avatar 0,84,144,2,0,0,146,146,0,0,2,52 -> x84 y144 orient2 activity/action 146 custom[2,52]
//	#2 ground 1,0,4,228,0,0                   -> style1 x0 y4 orient228
//	#3 wall   4,0,0,196,0,0                   -> style4 x0 y0 orient196
//	#4 head   <style>,200,36,16,1,0           -> orient16 (CV standalone at x200,y36; we wear it)
//
// The CV has NO sky. The web client wears one head (composited onto the body) and
// cycles its style through the eight via F2; the eight ride in HATCHERY_$.
const (
	hatcheryAvatarNoid uint16 = 1
	hatcheryGroundNoid uint16 = 2
	hatcheryWallNoid   uint16 = 3
	hatcheryHeadNoid   uint16 = 4 // C64 first_head — heads are objects #4..#11
	hatcheryHeadSlot   uint8  = 6 // AVATAR_HEAD contents slot (dataequates.m)
	hatcheryRegionDpth uint8  = 32

	hatcheryAvatarX        uint8 = 84
	hatcheryAvatarY        uint8 = 144
	hatcheryAvatarOrient   uint8 = 2
	hatcheryAvatarActivity uint8 = 146 // AV_ACT_stand_front — face the viewer
	hatcheryHeadOrient     uint8 = 16

	hatcheryGroundStyle  uint8 = 1
	hatcheryGroundY      uint8 = 4
	hatcheryGroundOrient uint8 = 228
	hatcheryWallStyle    uint8 = 4
	hatcheryWallOrient   uint8 = 196
)

// hatcherySceneryMake builds a region-contained backdrop object (Sky/Ground/Wall).
// Field shapes are taken from a real captured region make-storm so the renderer
// composes them exactly as it would a live region's floor and walls.
func hatcherySceneryMake(ref string, mod *HabitatMod) *ElkoMessage {
	return &ElkoMessage{
		Op: StringP("make"),
		To: StringP(HatcheryContextRef),
		Obj: &HabitatObject{
			Ref:  ref,
			Type: "item",
			Name: *mod.Type,
			Mods: []*HabitatMod{mod},
		},
	}
}

// buildHatcheryMakeStorm derives the JSON make-storm the web client renders for
// the customizer, from the eight head styles chosen for this user (the same list
// spliced into the binary vector). Returns one marshalled JSON line per message,
// in send order: Region, Avatar (you), worn Head, then the HATCHERY_$ signal.
func buildHatcheryMakeStorm(avatarRef, fullName string, heads []uint8) [][]byte {
	headStyle := uint8(0)
	if len(heads) > 0 {
		headStyle = heads[0]
	}
	headRef := avatarRef + "-hatchery-head"

	region := &ElkoMessage{
		Op: StringP("make"),
		To: StringP(HatcheryContextRef),
		Obj: &HabitatObject{
			Ref:  HatcheryContextRef,
			Type: "context",
			Name: "Hatchery",
			Mods: []*HabitatMod{{
				Type:        StringP("Region"),
				Orientation: Uint8P(0),
				Depth:       Uint8P(hatcheryRegionDpth),
				Neighbors:   &[]string{"", "", "", ""},
			}},
		},
	}
	// Backdrop — Ground (the floor the Avatar stands on) and a Wall, both with the
	// CV's state values. (The CV has no Sky.)
	ground := hatcherySceneryMake(HatcheryContextRef+"-ground", &HabitatMod{
		Type: StringP("Ground"), Noid: Uint16P(hatcheryGroundNoid),
		Style: Uint8P(hatcheryGroundStyle), X: Uint8P(0), Y: Uint8P(hatcheryGroundY),
		Orientation: Uint8P(hatcheryGroundOrient), GrState: Uint8P(0),
	})
	wall := hatcherySceneryMake(HatcheryContextRef+"-wall", &HabitatMod{
		Type: StringP("Wall"), Noid: Uint16P(hatcheryWallNoid),
		Style: Uint8P(hatcheryWallStyle), X: Uint8P(0), Y: Uint8P(0),
		Orientation: Uint8P(hatcheryWallOrient), GrState: Uint8P(0),
	})
	avatar := &ElkoMessage{
		Op:  StringP("make"),
		To:  StringP(HatcheryContextRef),
		You: BoolP(true),
		Obj: &HabitatObject{
			Ref:  avatarRef,
			Type: "item",
			Name: fullName,
			Mods: []*HabitatMod{{
				Type:        StringP("Avatar"),
				Noid:        Uint16P(hatcheryAvatarNoid),
				Style:       Uint8P(0),
				X:           Uint8P(hatcheryAvatarX),
				Y:           Uint8P(hatcheryAvatarY),
				Orientation: Uint8P(hatcheryAvatarOrient),
				GrState:     Uint8P(0),
				Activity:    Uint8P(hatcheryAvatarActivity),
				Action:      Uint8P(hatcheryAvatarActivity),
				Health:      Uint8P(255), // CV byte is a 0 placeholder; a display avatar needs full health
				BodyType:    StringP("male"),
				Custom:      Int32SP([]int32{2, 52}), // CV custom[2,52]; init_cust re-rolls it client-side
			}},
		},
	}
	// The worn head is contained IN the Avatar (In = avatarRef, slot 6) so the
	// renderer composes it onto the body; F2 restyles it through the eight heads.
	head := &ElkoMessage{
		Op: StringP("make"),
		To: StringP(avatarRef),
		Obj: &HabitatObject{
			Ref:  headRef,
			Type: "item",
			Name: "Head",
			In:   avatarRef,
			Mods: []*HabitatMod{{
				Type:        StringP("Head"),
				Noid:        Uint16P(hatcheryHeadNoid),
				X:           Uint8P(0),
				Y:           Uint8P(hatcheryHeadSlot),
				Style:       Uint8P(headStyle),
				Orientation: Uint8P(hatcheryHeadOrient),
				GrState:     Uint8P(0),
			}},
		},
	}

	out := make([][]byte, 0, 6)
	for _, m := range []*ElkoMessage{region, ground, wall, avatar, head} {
		if b, err := json.Marshal(m); err == nil {
			out = append(out, b)
		}
	}
	// HATCHERY_$ tells the web client to enter MODE_CUSTOMIZE and gives it all
	// eight head styles (the C64 reads these from head objects #4–11; the web
	// client takes them here). Marshalled from a plain map so we needn't widen
	// ElkoMessage with a field only this op uses. NOTE: heads is []uint8 (==[]byte),
	// which json.Marshal would base64-encode — widen to []int so it serializes as a
	// real JSON array the web client can index.
	headsJSON := make([]int, len(heads))
	for i, h := range heads {
		headsJSON[i] = int(h)
	}
	if b, err := json.Marshal(map[string]any{
		"op":    "HATCHERY_$",
		"to":    avatarRef,
		"heads": headsJSON,
	}); err == nil {
		out = append(out, b)
	}
	return out
}

// parseHatcheryAppearanceJson reads the five appearance bytes a JSON web client
// sends with op "CUSTOMIZE" (msg.custom = [head_style, hair, av_orient, c0, c1]) —
// the JSON analogue of the binary parseHatcheryAppearance.
func parseHatcheryAppearanceJson(msg *ElkoMessage) (hatcheryAppearance, bool) {
	if msg.Custom == nil || len(*msg.Custom) < 5 {
		return hatcheryAppearance{}, false
	}
	a := *msg.Custom
	return hatcheryAppearance{
		headStyle:         a[0],
		hairPattern:       a[1],
		avatarOrientation: a[2],
		custom0:           a[3],
		custom1:           a[4],
	}, true
}

// beginJsonHatchery streams the synthetic customizer make-storm to a JSON web
// client and notifies habiproxy that the hatchery started. Caller holds stateMu.
func (c *ClientSession) beginJsonHatchery() {
	if err := c.sendHatcheryStateToHabiproxy("started"); err != nil {
		c.log.Error().Err(err).Str("user_ref", c.userRef).Msg("Could not notify habiproxy that original hatchery started")
	}
	heads := pickHatcheryHeads()
	for _, line := range buildHatcheryMakeStorm(c.userRef, c.UserName, heads) {
		c.writeJsonToClient(line)
	}
	c.log.Info().Str("user_ref", c.userRef).Msg("Sent JSON hatchery make-storm; awaiting CUSTOMIZE")
}

// sendJsonCustomizeReply answers a JSON web client's CUSTOMIZE with a reply the
// transport's sendForReply consumes (type:"reply"). success=false → the client
// restarts the customizer (custom.m customize_reply == 0).
func (c *ClientSession) sendJsonCustomizeReply(success bool) {
	if b, err := json.Marshal(map[string]any{
		"type":    "reply",
		"op":      "CUSTOMIZE",
		"success": success,
	}); err == nil {
		c.writeJsonToClient(b)
	}
}

// handleJsonHatcheryCustomize is the JSON analogue of handleHatcheryCustomize:
// build the real avatar from the five bytes (the shared finalizeHatchery), reply,
// then enter the deferred context so Elko streams the real region. Never relayed
// to Elko. Acquires stateMu itself (the passthrough loop does not hold it here).
func (c *ClientSession) handleJsonHatcheryCustomize(msg *ElkoMessage) {
	c.stateMu.Lock()
	if !c.hatcheryPending {
		c.stateMu.Unlock()
		c.log.Warn().Msg("CUSTOMIZE received with no hatchery pending; ignoring")
		return
	}
	appearance, ok := parseHatcheryAppearanceJson(msg)
	if !ok {
		c.stateMu.Unlock()
		c.log.Error().Msg("JSON hatchery CUSTOMIZE payload too short")
		c.sendJsonCustomizeReply(false)
		return
	}
	if err := c.finalizeHatchery(appearance); err != nil {
		c.stateMu.Unlock()
		c.log.Error().Err(err).Str("user_ref", c.userRef).Msg("Could not create hatchery user")
		c.sendJsonCustomizeReply(false)
		return
	}
	desired := c.pendingHatcheryEnter
	c.pendingHatcheryEnter = ""
	c.stateMu.Unlock()
	c.sendJsonCustomizeReply(true)
	c.enterDeferredHatcheryContext(desired)
}

// enterDeferredHatcheryContext relays the held entercontext to Elko now that the
// avatar exists, resolving the entry region the same way the normal JSON path
// does: the client's requested context if any, else the user's last region, else
// the bridge default.
func (c *ClientSession) enterDeferredHatcheryContext(desired string) {
	c.stateMu.Lock()
	if c.user == nil && c.userRef != "" {
		if u, err := c.findHabitatObj(c.userRef); err == nil && u != nil {
			c.user = u
		}
	}
	context := c.bridge.Context
	if desired != "" {
		context = desired
	} else if c.user != nil && len(c.user.Mods) > 0 &&
		c.user.Mods[0].LastArrivedIn != nil && *c.user.Mods[0].LastArrivedIn != "" {
		context = *c.user.Mods[0].LastArrivedIn
	}
	userRef := c.userRef
	c.bindAvatar(c.UserName)
	c.bridgeAutoEnteredContext = ""
	c.stateMu.Unlock()

	b, err := json.Marshal(map[string]any{
		"op":      "entercontext",
		"to":      "session",
		"context": context,
		"user":    userRef,
	})
	if err != nil {
		c.log.Error().Err(err).Msg("Could not marshal deferred hatchery entercontext")
		return
	}
	if serr := c.sendRawToElko(b); serr != nil {
		c.log.Error().Err(serr).Msg("Could not relay deferred hatchery entercontext")
	}
}
