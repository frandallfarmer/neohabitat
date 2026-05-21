package bridge

import (
	"testing"

	"github.com/rs/zerolog"
)

// Regression coverage for issue #499: after a tableflip with TCP_REPAIR,
// the client still holds noids the parent process committed via CONTENTS,
// but Elko re-allocates noids independently on the fresh TCP. The bridge
// must rewrite those fresh-from-Elko noids back to the saved client
// noids so c.objects / c.RefToNoid stay consistent with the C64's view.

// strP and uint16P live in other test files; bridge_test.go already
// defines newTestSession + a discardConn we reuse here.

func newRestoredTestSession(saved map[string]uint8) *ClientSession {
	sess := newTestSession()
	sess.log = zerolog.Nop()
	sess.restoredSession = true
	sess.savedRefToNoid = make(map[string]uint8, len(saved))
	for k, v := range saved {
		sess.savedRefToNoid[k] = v
	}
	sess.restoreElkoToSaved = make(map[uint8]uint8)
	return sess
}

// makeMsg fabricates a minimal "make" ElkoMessage carrying a single
// HabitatMod with the supplied class, ref, and elko-assigned noid.
func makeMsg(class, ref string, elkoNoid uint8) *ElkoMessage {
	n := uint16(elkoNoid)
	classP := class
	return &ElkoMessage{
		Obj: &HabitatObject{
			Ref: ref,
			Mods: []*HabitatMod{
				{
					Type: &classP,
					Noid: &n,
				},
			},
		},
	}
}

func TestRestore_RewritesNoidForKnownRef(t *testing.T) {
	saved := map[string]uint8{
		"item-fountain-1": 50,
	}
	sess := newRestoredTestSession(saved)

	msg := makeMsg("Fountain", "item-fountain-1", 31)
	if err := sess.unpackHabitatObject(msg, "context-Downtown_5c"); err != nil {
		t.Fatalf("unpackHabitatObject: %v", err)
	}

	if _, found := sess.objects[50]; !found {
		t.Errorf("objects[50] not set; have %v", sess.objects)
	}
	if _, conflict := sess.objects[31]; conflict {
		t.Errorf("objects[31] should not exist after rewrite")
	}
	if got := sess.RefToNoid["item-fountain-1"]; got != 50 {
		t.Errorf("RefToNoid[item-fountain-1] = %d, want 50", got)
	}
	if got := sess.restoreElkoToSaved[31]; got != 50 {
		t.Errorf("restoreElkoToSaved[31] = %d, want 50", got)
	}
	if msg.Obj.Mods[0].Noid == nil || *msg.Obj.Mods[0].Noid != 50 {
		t.Errorf("mod.Noid not rewritten to 50: %v", msg.Obj.Mods[0].Noid)
	}
	if msg.Noid == nil || *msg.Noid != 50 {
		t.Errorf("o.Noid not rewritten to 50: %v", msg.Noid)
	}
}

func TestRestore_PreservesUnknownRefNoid(t *testing.T) {
	// Object not in the saved snapshot (new arrival post-tableflip).
	// Should keep Elko's noid assignment as-is.
	sess := newRestoredTestSession(map[string]uint8{
		"item-fountain-1": 50,
	})

	msg := makeMsg("Knick_knack", "item-stranger-trinket", 77)
	if err := sess.unpackHabitatObject(msg, "context-Downtown_5c"); err != nil {
		t.Fatalf("unpackHabitatObject: %v", err)
	}

	if _, found := sess.objects[77]; !found {
		t.Errorf("objects[77] not set for unknown ref; have %v", sess.objects)
	}
	if got := sess.RefToNoid["item-stranger-trinket"]; got != 77 {
		t.Errorf("RefToNoid[item-stranger-trinket] = %d, want 77 (no rewrite)", got)
	}
	if _, found := sess.restoreElkoToSaved[77]; found {
		t.Errorf("restoreElkoToSaved should not record unknown-ref noid")
	}
}

func TestRestore_RewritesSittingInUsingPriorMapping(t *testing.T) {
	// Seat arrives first (with elko noid 42, saved client noid 37);
	// then an avatar whose mod.SittingIn = 42 (elko's seat noid). The
	// rewrite path should remap SittingIn to 37 so the C64's view stays
	// internally consistent.
	sess := newRestoredTestSession(map[string]uint8{
		"item-seat-1":         37,
		"user-randy-12345678": 50,
	})

	seatMsg := makeMsg("Chair", "item-seat-1", 42)
	if err := sess.unpackHabitatObject(seatMsg, "context-Downtown_5c"); err != nil {
		t.Fatalf("seat unpack: %v", err)
	}

	avatarMsg := makeMsg("Avatar", "user-randy-12345678", 31)
	// Elko's view: avatar is sitting in seat noid 42 (elko's).
	sittingIn := uint8(42)
	avatarMsg.Obj.Mods[0].SittingIn = &sittingIn
	if err := sess.unpackHabitatObject(avatarMsg, "context-Downtown_5c"); err != nil {
		t.Fatalf("avatar unpack: %v", err)
	}

	avatarMod := avatarMsg.Obj.Mods[0]
	if avatarMod.SittingIn == nil || *avatarMod.SittingIn != 37 {
		t.Errorf("SittingIn not rewritten via restoreElkoToSaved: %v", avatarMod.SittingIn)
	}
	if avatarMod.Noid == nil || *avatarMod.Noid != 50 {
		t.Errorf("avatar mod.Noid not rewritten: %v", avatarMod.Noid)
	}
}

func TestRestore_RewritesRestrainerUsingPriorMapping(t *testing.T) {
	// Restrainer is an Avatar field documented in PROTOCOL.md:536 as
	// "Restraining object NOID". elko_state_encoders.go writes it raw
	// from state.Restrainer into the wire bundle, so if a tableflip
	// shifts the restraining object's noid the client's view of who's
	// holding the avatar gets corrupted. Verify it's rewritten when
	// restoreElkoToSaved knows the target.
	sess := newRestoredTestSession(map[string]uint8{
		"item-handcuffs-1":    25,
		"user-randy-12345678": 50,
	})

	cuffsMsg := makeMsg("Knick_knack", "item-handcuffs-1", 70)
	if err := sess.unpackHabitatObject(cuffsMsg, "context-Downtown_5c"); err != nil {
		t.Fatalf("cuffs unpack: %v", err)
	}

	avatarMsg := makeMsg("Avatar", "user-randy-12345678", 31)
	restrainer := uint8(70) // elko's noid for the cuffs
	avatarMsg.Obj.Mods[0].Restrainer = &restrainer
	if err := sess.unpackHabitatObject(avatarMsg, "context-Downtown_5c"); err != nil {
		t.Fatalf("avatar unpack: %v", err)
	}

	avatarMod := avatarMsg.Obj.Mods[0]
	if avatarMod.Restrainer == nil || *avatarMod.Restrainer != 25 {
		t.Errorf("Restrainer not rewritten via restoreElkoToSaved: %v", avatarMod.Restrainer)
	}
}

func TestRestore_RewritesWisherUsingPriorMapping(t *testing.T) {
	// Wisher is a Magic_lamp field (Magic_lamp.java:100 sets it to
	// avatar.noid mid-wish). elko_state_encoders.go writes it raw,
	// so a tableflip mid-wish corrupts which avatar the client thinks
	// the lamp is bound to. Verify rewrite through restoreElkoToSaved.
	sess := newRestoredTestSession(map[string]uint8{
		"user-randy-12345678": 50,
		"item-lamp-1":         18,
	})

	avatarMsg := makeMsg("Avatar", "user-randy-12345678", 31)
	if err := sess.unpackHabitatObject(avatarMsg, "context-Downtown_5c"); err != nil {
		t.Fatalf("avatar unpack: %v", err)
	}

	lampMsg := makeMsg("Magic_lamp", "item-lamp-1", 60)
	wisher := uint8(31) // elko's noid for randy
	lampMsg.Obj.Mods[0].Wisher = &wisher
	if err := sess.unpackHabitatObject(lampMsg, "context-Downtown_5c"); err != nil {
		t.Fatalf("lamp unpack: %v", err)
	}

	lampMod := lampMsg.Obj.Mods[0]
	if lampMod.Wisher == nil || *lampMod.Wisher != 50 {
		t.Errorf("Wisher not rewritten via restoreElkoToSaved: %v", lampMod.Wisher)
	}
}

func TestRestore_FlagOffMeansNoRewrite(t *testing.T) {
	// Sanity check: with restoredSession=false, the existing behavior
	// (use Elko's noid as-is) is preserved even if savedRefToNoid is
	// populated.
	sess := newRestoredTestSession(map[string]uint8{
		"item-fountain-1": 50,
	})
	sess.restoredSession = false

	msg := makeMsg("Fountain", "item-fountain-1", 31)
	if err := sess.unpackHabitatObject(msg, "context-Downtown_5c"); err != nil {
		t.Fatalf("unpackHabitatObject: %v", err)
	}

	if _, found := sess.objects[31]; !found {
		t.Errorf("objects[31] not set when restoredSession=false; have %v", sess.objects)
	}
	if got := sess.RefToNoid["item-fountain-1"]; got != 31 {
		t.Errorf("RefToNoid[item-fountain-1] = %d, want 31 (elko's noid)", got)
	}
}
