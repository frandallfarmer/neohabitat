package bridge

import (
	"encoding/json"
	"testing"
)

func TestSessionSnapshot_RoundTrip(t *testing.T) {
	avatarNoid := uint8(42)
	snap := SessionSnapshot{
		SessionID:       "test-1",
		UserName:        "randy",
		UserRef:         "user-randy",
		RegionRef:       "context-Downtown_5f",
		Ref:             "user-randy-123",
		Connected:       true,
		QLinkMode:       true,
		QLinkInSeq:      0x12,
		QLinkOutSeq:     0x34,
		ReplySeq:        7,
		AvatarNoid:      &avatarNoid,
		ObjectNoidOrder: []uint8{0, 1, 2, 42},
		NoidClassList:   []uint8{0, 1, 2, 12},
		NoidContents: map[string][]uint8{
			"0": {1, 2, 42},
		},
		RefToNoid: map[string]uint8{
			"context-Downtown_5f": 0,
			"user-randy-123":     42,
		},
		Objects: []ObjectSnapshot{
			{Noid: 0, Container: 0, Message: &ElkoMessage{
				Type: "context",
			}},
			{Noid: 42, Container: 0, Message: &ElkoMessage{
				Type: "user",
			}},
		},
		ClientFdIndex:      0,
		ElkoFdIndex:        1,
		DataRate:           1200,
		BufferedClientData: []byte{0x5A, 0x81},
	}

	data, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var restored SessionSnapshot
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if restored.SessionID != snap.SessionID {
		t.Errorf("SessionID = %q, want %q", restored.SessionID, snap.SessionID)
	}
	if restored.QLinkInSeq != snap.QLinkInSeq {
		t.Errorf("QLinkInSeq = 0x%02x, want 0x%02x", restored.QLinkInSeq, snap.QLinkInSeq)
	}
	if restored.QLinkOutSeq != snap.QLinkOutSeq {
		t.Errorf("QLinkOutSeq = 0x%02x, want 0x%02x", restored.QLinkOutSeq, snap.QLinkOutSeq)
	}
	if restored.AvatarNoid == nil || *restored.AvatarNoid != avatarNoid {
		t.Errorf("AvatarNoid = %v, want %d", restored.AvatarNoid, avatarNoid)
	}
	if len(restored.Objects) != 2 {
		t.Errorf("Objects len = %d, want 2", len(restored.Objects))
	}
	if restored.RefToNoid["user-randy-123"] != 42 {
		t.Errorf("RefToNoid[user-randy-123] = %d, want 42", restored.RefToNoid["user-randy-123"])
	}
	if len(restored.BufferedClientData) != 2 || restored.BufferedClientData[0] != 0x5A {
		t.Errorf("BufferedClientData = %v, want [5A 81]", restored.BufferedClientData)
	}
	contents := restored.NoidContents["0"]
	if len(contents) != 3 || contents[2] != 42 {
		t.Errorf("NoidContents[0] = %v, want [1 2 42]", contents)
	}
}

func TestHandoffManifest_RoundTrip(t *testing.T) {
	manifest := HandoffManifest{
		Sessions: []SessionSnapshot{
			{SessionID: "s1", UserName: "alice"},
			{SessionID: "s2", UserName: "bob"},
		},
		QLinkMode: true,
		ElkoHost:  "neohabitat:2018",
		Context:   "context-Downtown_5f",
	}

	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var restored HandoffManifest
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if len(restored.Sessions) != 2 {
		t.Fatalf("Sessions len = %d, want 2", len(restored.Sessions))
	}
	if restored.Sessions[0].UserName != "alice" {
		t.Errorf("Sessions[0].UserName = %q, want alice", restored.Sessions[0].UserName)
	}
	if restored.ElkoHost != "neohabitat:2018" {
		t.Errorf("ElkoHost = %q, want neohabitat:2018", restored.ElkoHost)
	}
}

func TestNoidContentsKeyConversion(t *testing.T) {
	original := map[uint8][]uint8{
		0:   {1, 2, 3},
		255: {42},
	}
	strKeys := noidContentsToStringKeys(original)
	if len(strKeys) != 2 {
		t.Fatalf("string keys len = %d, want 2", len(strKeys))
	}
	roundTripped := stringKeysToNoidContents(strKeys)
	if len(roundTripped[0]) != 3 || roundTripped[0][0] != 1 {
		t.Errorf("roundTripped[0] = %v, want [1 2 3]", roundTripped[0])
	}
	if len(roundTripped[255]) != 1 || roundTripped[255][0] != 42 {
		t.Errorf("roundTripped[255] = %v, want [42]", roundTripped[255])
	}
}
