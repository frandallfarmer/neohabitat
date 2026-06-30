package bridge

import "testing"

// A regression guard for the catch-up interlock: GHOSTS must never receive the avatar_on_hold
// (0x40) bit. The original interlock held any transiting avatar, which stamped a ghost's own make
// with 0x40 — the C64 reads that as "No New Commands", and a ghost never gets the APPEARING_$ that
// clears it, so F1/deghost was gated forever (see Ghost.CORPORATE / toggle_ghost_mode.m).
func TestInterlockExemptsGhosts(t *testing.T) {
	// A corporeal avatar SHOULD still be held (the interlock's actual job).
	corporeal := &HabitatMod{GrState: Uint8P(0), AmAGhost: BoolP(false)}
	holdAvatarMod(corporeal)
	if corporeal.GrState == nil || *corporeal.GrState&avatarOnHold == 0 {
		t.Fatalf("corporeal avatar should be held, got gr_state=%v", corporeal.GrState)
	}

	// Ghosts are exempt — by amAGhost flag or by class "Ghost".
	ghosts := map[string]*HabitatMod{
		"amAGhost":   {GrState: Uint8P(0), AmAGhost: BoolP(true)},
		"classGhost": {GrState: Uint8P(0), Type: StringP("Ghost")},
	}
	for name, mod := range ghosts {
		holdAvatarMod(mod)
		if mod.GrState != nil && *mod.GrState&avatarOnHold != 0 {
			t.Errorf("ghost (%s) must be exempt from hold, but gr_state=0x%02x", name, *mod.GrState)
		}
	}

	// holdAvatarRaw (JSON path) leaves a ghost's bytes untouched.
	raw := []byte(`{"type":"Avatar","gr_state":0,"amAGhost":true}`)
	if out := holdAvatarRaw(raw, &HabitatMod{AmAGhost: BoolP(true)}); string(out) != string(raw) {
		t.Errorf("holdAvatarRaw must not patch a ghost; got %q", out)
	}
}
