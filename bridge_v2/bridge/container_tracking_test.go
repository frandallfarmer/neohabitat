package bridge

// Tests for the containment-map mirrors that keep ClientSession.objects
// consistent with the C64's own heap when items move between hands,
// the floor, and containers. Regression coverage for the 2026-07-23
// Fatal Error #11 incident: a HAND transfer went unmirrored, the giver
// left the region, and the sweep GOAWAY'd the item out of the
// receiver's hand — the item's next async then referenced a noid the
// C64 had deleted, which it treats as fatal heap corruption.

import "testing"

// addTrackedObject inserts an object with full derived containment
// state (mod, container, slot) the way unpackHabitatObject would.
func addTrackedObject(s *ClientSession, noid uint8, ref string, className string, container uint8, y uint8) *ElkoMessage {
	slot := y
	o := &ElkoMessage{
		Obj:       &HabitatObject{Ref: ref},
		mod:       &HabitatMod{Type: &className, Y: &slot},
		ref:       ref,
		container: container,
	}
	s.objects[noid] = o
	s.RefToNoid[ref] = noid
	s.objectNoidOrder = append(s.objectNoidOrder, noid)
	return o
}

// incidentSession builds the Popustop.1019 cast as a bystander session
// saw it: giver avatar 30 holding item 24, receiver avatar 10.
func incidentSession() *ClientSession {
	s := newTestSession()
	addTrackedObject(s, 30, "user-giver", "Avatar", 0, 0)
	addTrackedObject(s, 10, "user-receiver", "Avatar", 0, 0)
	addTrackedObject(s, 24, "item-changomatic", "Changomatic", 30, AVATAR_HAND)
	return s
}

// GRABFROM$ must move the giver's in-hand item to the receiver in the
// tracked map.
func TestGrabfromMirrorsHandTransfer(t *testing.T) {
	s := incidentSession()
	receiver, giver := uint8(10), uint8(30)
	msg := &ElkoMessage{Noid: &receiver, AvatarNoid: &giver}
	ServerOps["GRABFROM$"].ToClient(msg, NewHabBufEmpty(), s)

	if got := s.objects[24].container; got != receiver {
		t.Errorf("item container = %d, want %d (receiver)", got, receiver)
	}
}

// The incident end-to-end: after a mirrored GRABFROM$, sweeping the
// departing giver must NOT remove the item now in the receiver's hand.
func TestSweepAfterGrabfromKeepsTransferredItem(t *testing.T) {
	s := incidentSession()
	receiver, giver := uint8(10), uint8(30)
	msg := &ElkoMessage{Noid: &receiver, AvatarNoid: &giver}
	ServerOps["GRABFROM$"].ToClient(msg, NewHabBufEmpty(), s)

	if err := s.removeNoid(30); err != nil {
		t.Fatalf("removeNoid err = %v", err)
	}
	if s.objects[24] == nil {
		t.Fatal("item was swept out of the receiver's hand (Fatal Error #11 regression)")
	}
	if s.objects[30] != nil {
		t.Error("departed avatar still tracked")
	}
}

// Control: without a transfer, the giver's in-hand item still leaves
// with them (the original orphan fix must keep working).
func TestSweepStillRemovesCarriedItem(t *testing.T) {
	s := incidentSession()
	if err := s.removeNoid(30); err != nil {
		t.Fatalf("removeNoid err = %v", err)
	}
	if s.objects[24] != nil {
		t.Error("carried item not swept with departing avatar")
	}
}

// GET$ must mirror a bystander-observed pickup from the floor.
func TestGetAsyncMirrorsPickup(t *testing.T) {
	s := incidentSession()
	addTrackedObject(s, 12, "item-token", "Tokens", 0, 140)
	picker, target, how := uint8(10), uint8(12), uint8(0)
	msg := &ElkoMessage{Noid: &picker, Target: &target, How: &how}
	ServerOps["GET$"].ToClient(msg, NewHabBufEmpty(), s)

	item := s.objects[12]
	if item.container != picker {
		t.Errorf("item container = %d, want %d", item.container, picker)
	}
	if item.mod.Y == nil || *item.mod.Y != AVATAR_HAND {
		t.Errorf("item slot = %v, want AVATAR_HAND", item.mod.Y)
	}
}

// THROW$ must mirror the object landing back on the region floor.
func TestThrowMirrorsLanding(t *testing.T) {
	s := incidentSession()
	obj, x, y, hit := uint8(24), uint8(80), uint8(140), uint8(1)
	msg := &ElkoMessage{ObjectNoid: &obj, X: &x, Y: &y, Hit: &hit}
	ServerOps["THROW$"].ToClient(msg, NewHabBufEmpty(), s)

	item := s.objects[24]
	if item.container != REGION_NOID {
		t.Errorf("thrown item container = %d, want region", item.container)
	}
	if item.mod.Y == nil || *item.mod.Y != y {
		t.Errorf("thrown item y = %v, want %d", item.mod.Y, y)
	}
}

// HAND reply: the initiator (giver) mirrors from the success reply.
func TestHandReplyMirrorsGiveaway(t *testing.T) {
	s := incidentSession()
	myNoid := uint16(30)
	s.Avatar = &HabitatMod{Noid: &myNoid}
	receiver, ok := uint8(10), uint8(1)
	msg := &ElkoMessage{Noid: &receiver, Err: &ok}
	Translators["HAND"].ToClient(msg, NewHabBufEmpty(), s)

	if got := s.objects[24].container; got != receiver {
		t.Errorf("item container = %d, want %d (receiver)", got, receiver)
	}
}

// HAND failure reply must not move anything.
func TestHandReplyFailureLeavesMapAlone(t *testing.T) {
	s := incidentSession()
	myNoid := uint16(30)
	s.Avatar = &HabitatMod{Noid: &myNoid}
	receiver, fail := uint8(10), uint8(0)
	msg := &ElkoMessage{Noid: &receiver, Err: &fail}
	Translators["HAND"].ToClient(msg, NewHabBufEmpty(), s)

	if got := s.objects[24].container; got != 30 {
		t.Errorf("item container = %d, want 30 (unchanged)", got)
	}
}

// GRAB reply: the initiator (receiver) mirrors the grabbed item into
// its own hand; item_noid 0 means refused.
func TestGrabReplyMirrorsTake(t *testing.T) {
	s := incidentSession()
	myNoid := uint16(10)
	s.Avatar = &HabitatMod{Noid: &myNoid}
	victim, item := uint8(30), uint8(24)
	msg := &ElkoMessage{Noid: &victim, ItemNoid: &item}
	Translators["GRAB"].ToClient(msg, NewHabBufEmpty(), s)

	if got := s.objects[24].container; got != 10 {
		t.Errorf("item container = %d, want 10 (grabber)", got)
	}
}

// GET reply: the initiator mirrors the picked-up item (reply noid)
// into its own hand on success.
func TestGetReplyMirrorsPickup(t *testing.T) {
	s := incidentSession()
	addTrackedObject(s, 12, "item-token", "Tokens", 0, 140)
	myNoid := uint16(10)
	s.Avatar = &HabitatMod{Noid: &myNoid}
	itemNoid, ok := uint8(12), uint8(1)
	msg := &ElkoMessage{Noid: &itemNoid, Err: &ok}
	Translators["GET"].ToClient(msg, NewHabBufEmpty(), s)

	item := s.objects[12]
	if item.container != 10 {
		t.Errorf("item container = %d, want 10", item.container)
	}
	if item.mod.Y == nil || *item.mod.Y != AVATAR_HAND {
		t.Errorf("item slot = %v, want AVATAR_HAND", item.mod.Y)
	}
}
