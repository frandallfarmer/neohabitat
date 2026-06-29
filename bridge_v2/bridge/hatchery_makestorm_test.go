package bridge

import (
	"encoding/json"
	"reflect"
	"testing"
)

// TestHatcheryVectorGolden pins the C64 wire format. The customization vector is
// what existing C64 clients receive verbatim (sendImAliveReply); if an edit ever
// changes a byte OTHER than the eight head-style slots, this fails so the change
// is deliberate. RULE #1: the C64 is ground truth — it must keep getting these bytes.
func TestHatcheryVectorGolden(t *testing.T) {
	want := []uint8{
		0, 0, 32, 0, 1, 0, 0, 0, 0,
		1, 1, 2, 36, 3, 80, 4, 127,
		5, 127, 6, 127, 7, 127, 8, 127,
		9, 127, 10, 127, 11, 127, 0,
		0, 84, 144, 2, 0, 0, 146, 146,
		0, 0, 2, 52,
		1, 0, 4, 228, 0, 0,
		4, 0, 0, 196, 0, 0,
		1, 200, 36, 16, 1, 0,
		2, 200, 38, 16, 1, 0,
		3, 200, 38, 16, 1, 0,
		4, 200, 198, 16, 1, 0,
		11, 200, 36, 16, 1, 0,
		21, 200, 37, 16, 1, 0,
		9, 200, 60, 16, 1, 0,
		30, 200, 36, 24, 1, 0,
		0,
	}
	if !reflect.DeepEqual([]uint8(HatcheryCustomizationVector), want) {
		t.Fatalf("HatcheryCustomizationVector drifted from the canonical C64 bytes:\n got %v\nwant %v",
			HatcheryCustomizationVector, want)
	}
}

// The eight head slots are the ONLY bytes that vary per user, and they round-trip:
// splice in → read back the same list. This is the contract the JSON make-storm
// relies on to stay in sync with the binary vector.
func TestHatcheryHeadStylesRoundTrip(t *testing.T) {
	heads := []uint8{1, 2, 3, 4, 11, 21, 9, 30}
	got := HatcheryHeadStyles(hatcheryVectorWithHeads(heads))
	if !reflect.DeepEqual(got, heads) {
		t.Fatalf("head styles round-trip: got %v, want %v", got, heads)
	}
	// Splicing heads must not disturb any non-head byte.
	spliced := hatcheryVectorWithHeads(heads)
	base := []uint8(HatcheryCustomizationVector)
	for i := range base {
		isHeadSlot := false
		for h := 0; h < 8; h++ {
			if i == hatcheryHeadStyleOffset+h*hatcheryHeadRecordSize {
				isHeadSlot = true
			}
		}
		if !isHeadSlot && spliced[i] != base[i] {
			t.Fatalf("splice changed non-head byte %d: %d != %d", i, spliced[i], base[i])
		}
	}
}

// pickHatcheryHeads returns four male then four female styles, each from its
// allowed set, with no dupes within a group (hatchery.pl1 scramble_head_styles).
func TestPickHatcheryHeads(t *testing.T) {
	in := func(v uint8, set []uint8) bool {
		for _, s := range set {
			if s == v {
				return true
			}
		}
		return false
	}
	heads := pickHatcheryHeads()
	if len(heads) != 8 {
		t.Fatalf("expected 8 heads, got %d", len(heads))
	}
	for i := 0; i < 4; i++ {
		if !in(heads[i], hatcheryAllowedMaleHeads) {
			t.Errorf("head %d (%d) not an allowed male head", i, heads[i])
		}
		if !in(heads[i+4], hatcheryAllowedFemaleHeads) {
			t.Errorf("head %d (%d) not an allowed female head", i+4, heads[i+4])
		}
	}
}

// The synthetic make-storm renders a usable customizer scene: a Region, the
// Avatar BODY as "you", a Head worn in that Avatar, then HATCHERY_$ with all 8.
func TestBuildHatcheryMakeStorm(t *testing.T) {
	heads := []uint8{1, 2, 3, 4, 11, 21, 9, 30}
	lines := buildHatcheryMakeStorm("user-zelda", "Zelda", heads)
	if len(lines) != 4 {
		t.Fatalf("expected 4 messages (region, avatar, head, signal), got %d", len(lines))
	}

	var region, avatar, head ElkoMessage
	mustUnmarshal(t, lines[0], &region)
	mustUnmarshal(t, lines[1], &avatar)
	mustUnmarshal(t, lines[2], &head)

	if region.Op == nil || *region.Op != "make" || region.Obj == nil ||
		region.Obj.Mods[0].Type == nil || *region.Obj.Mods[0].Type != "Region" {
		t.Errorf("first message is not a Region make: %s", lines[0])
	}
	if avatar.You == nil || !*avatar.You {
		t.Errorf("avatar make must carry you:true so world.me resolves: %s", lines[1])
	}
	if avatar.Obj == nil || avatar.Obj.Ref != "user-zelda" ||
		avatar.Obj.Mods[0].Type == nil || *avatar.Obj.Mods[0].Type != "Avatar" ||
		avatar.Obj.Mods[0].Noid == nil || *avatar.Obj.Mods[0].Noid != hatcheryAvatarNoid {
		t.Errorf("avatar body wrong: %s", lines[1])
	}
	if head.To == nil || *head.To != "user-zelda" || head.Obj == nil || head.Obj.In != "user-zelda" ||
		head.Obj.Mods[0].Type == nil || *head.Obj.Mods[0].Type != "Head" ||
		head.Obj.Mods[0].Style == nil || *head.Obj.Mods[0].Style != heads[0] {
		t.Errorf("head must be worn in the avatar with the first style: %s", lines[2])
	}

	var sig struct {
		Op    string  `json:"op"`
		To    string  `json:"to"`
		Heads []uint8 `json:"heads"`
	}
	mustUnmarshal(t, lines[3], &sig)
	if sig.Op != "HATCHERY_$" || sig.To != "user-zelda" || !reflect.DeepEqual(sig.Heads, heads) {
		t.Errorf("HATCHERY_$ signal wrong: %s", lines[3])
	}
}

func mustUnmarshal(t *testing.T, b []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("unmarshal %s: %v", b, err)
	}
}
