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

const (
	hatcheryAvatarNoid uint16 = 1
	hatcheryHeadNoid   uint16 = 4 // C64 first_head — heads are objects #4..#11
	hatcheryHeadSlot   uint8  = 6 // AVATAR_HEAD contents slot (dataequates.m)
	hatcheryAvatarX    uint8  = 84
	hatcheryAvatarY    uint8  = 144 // 128 (foreground bit) + 16 — standing on the floor band
)

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
				Depth:       Uint8P(48),
			}},
		},
	}
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
				X:           Uint8P(hatcheryAvatarX),
				Y:           Uint8P(hatcheryAvatarY),
				Orientation: Uint8P(0),
				BodyType:    StringP("male"),
				Custom:      Int32SP([]int32{0, 0}),
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
				Y:           Uint8P(hatcheryHeadSlot),
				Style:       Uint8P(headStyle),
				Orientation: Uint8P(0),
			}},
		},
	}

	out := make([][]byte, 0, 4)
	for _, m := range []*ElkoMessage{region, avatar, head} {
		if b, err := json.Marshal(m); err == nil {
			out = append(out, b)
		}
	}
	// HATCHERY_$ tells the web client to enter MODE_CUSTOMIZE and gives it all
	// eight head styles (the C64 reads these from head objects #4–11; the web
	// client takes them here). Marshalled from a plain map so we needn't widen
	// ElkoMessage with a field only this op uses.
	if b, err := json.Marshal(map[string]any{
		"op":    "HATCHERY_$",
		"to":    avatarRef,
		"heads": heads,
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
