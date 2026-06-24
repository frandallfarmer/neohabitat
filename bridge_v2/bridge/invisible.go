package bridge

import (
	"bytes"
	"fmt"
	"strings"
	"sync"
)

// avatarOnHold is the gr_state bit (0x40) that marks an avatar as not-yet-drawable — identical to
// the C64 client's avatar_on_hold (Main/equates.m) and elko's Constants.INVISIBLE. The original
// Stratus server set it on the transiting avatar's carried descriptor in the region-change handler
// (Processes/regionproc.pl1: set_bit(gr_state, 7)) and cleared it on I_AM_HERE. bridge_v2 is the
// elko-era analog of that transit coordinator, so it sets the bit purely on the wire toward the
// client — elko and its DB never see it. The hold is released client-side on APPEARING_$ (C64
// clears avatar_on_hold natively; the JS webclient clears it in habiworld region_APPEARING).
const avatarOnHold uint8 = 0x40

// transitRegistry tracks which avatars (by stable user-ref) are currently TRANSITING — i.e.
// changing regions and not yet caught up. It is global to the bridge process (one shared instance)
// because the bridge presents a single continuous session over elko's per-region make/break:
// "transiting" is a property of the AVATAR, not of any one connection, so every session must agree
// on it. Any session consults it when forwarding an avatar make; a make for a transiting avatar
// gets the on-hold bit so the client neither draws nor interacts with it until it appears.
//
// Crucially, only an actual region change marks the registry (ClientSession.enterContext). A
// deghost (CORPORATE) is an in-place re-make, not a transit, so it never marks — its corporeal
// make stays visible. That is the distinction Stratus drew by setting the bit only in the
// change_region handler.
type transitRegistry struct {
	mu  sync.RWMutex
	set map[string]bool
}

func newTransitRegistry() *transitRegistry {
	return &transitRegistry{set: make(map[string]bool)}
}

// The methods are nil-receiver-safe: a ClientSession whose Bridge was built without
// newTransitRegistry() (e.g. a struct literal in tests) simply gets no-op transit tracking
// instead of a nil-pointer panic.
func (t *transitRegistry) mark(ref string) {
	if t == nil || ref == "" {
		return
	}
	key := avatarShortRef(ref)
	t.mu.Lock()
	t.set[key] = true
	t.mu.Unlock()
}

func (t *transitRegistry) clear(ref string) {
	if t == nil || ref == "" {
		return
	}
	key := avatarShortRef(ref)
	t.mu.Lock()
	delete(t.set, key)
	t.mu.Unlock()
}

func (t *transitRegistry) isTransiting(ref string) bool {
	if t == nil || ref == "" {
		return false
	}
	key := avatarShortRef(ref)
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.set[key]
}

// avatarShortRef normalizes a full avatar ref ("user-randy-2629094263478067525") to the stable
// per-user key ("user-randy") — the form ClientSession.userRef already holds and the one that
// survives elko's per-region re-makes. Non-user / short refs pass through unchanged.
func avatarShortRef(ref string) string {
	parts := strings.SplitN(ref, "-", 3)
	if len(parts) >= 2 {
		return parts[0] + "-" + parts[1]
	}
	return ref
}

// holdAvatarMod sets the on-hold bit on a parsed avatar mod. The C64/binary path re-encodes the
// make from this mod (EncodeElkoModState), so mutating it here is sufficient. nil-safe.
func holdAvatarMod(mod *HabitatMod) {
	if mod == nil {
		return
	}
	if mod.GrState == nil {
		v := avatarOnHold
		mod.GrState = &v
		return
	}
	*mod.GrState |= avatarOnHold
}

// holdAvatarRaw rewrites the avatar's gr_state value in a raw elko JSON make so the bit rides on
// the wire. The JSON-passthrough (webclient) path forwards the raw elko bytes unchanged, so
// mutating the parsed struct is not enough — we patch the single "gr_state":N occurrence (an
// Avatar make carries exactly one; its pocket items arrive as separate makes). If the bit is
// already set, the bytes are returned untouched.
func holdAvatarRaw(raw []byte, mod *HabitatMod) []byte {
	var old uint8
	if mod != nil && mod.GrState != nil {
		old = *mod.GrState
	}
	next := old | avatarOnHold
	if next == old {
		return raw
	}
	return bytes.Replace(raw,
		[]byte(fmt.Sprintf(`"gr_state":%d`, old)),
		[]byte(fmt.Sprintf(`"gr_state":%d`, next)), 1)
}
