package bridge

import (
	"encoding/json"
	"strings"
	"testing"
)

// Regression coverage for issue #502: ElkoMessage's `obj` field is
// polymorphic on the wire — a bare noid integer in PUT$/THROW$
// neighbor broadcasts, an embedded HabitatObject in make/HEREIS_$.
// Previously the JSON unmarshaler dropped the whole message with
// "json: cannot unmarshal number into Go struct field ... of type
// bridge.HabitatObject" whenever Elko sent the bare-noid shape.

func TestUnmarshal_PutBroadcastBareObjNoid(t *testing.T) {
	// Real prod payload from issue #502.
	raw := []byte(`{"type":"neighbor","noid":19,"op":"PUT$","obj":11,"cont":0,"x":38,"y":148,"how":0,"orient":17}`)
	var msg ElkoMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg.Obj != nil {
		t.Errorf("Obj should be nil for bare-noid shape, got %+v", msg.Obj)
	}
	if msg.ObjectNoid == nil || *msg.ObjectNoid != 11 {
		t.Errorf("ObjectNoid = %v, want 11", msg.ObjectNoid)
	}
	if msg.Op == nil || *msg.Op != "PUT$" {
		t.Errorf("Op = %v, want PUT$", msg.Op)
	}
	if msg.Noid == nil || *msg.Noid != 19 {
		t.Errorf("Noid = %v, want 19", msg.Noid)
	}
	if msg.Cont == nil || *msg.Cont != 0 {
		t.Errorf("Cont = %v, want 0", msg.Cont)
	}
	if msg.X == nil || *msg.X != 38 || msg.Y == nil || *msg.Y != 148 {
		t.Errorf("X/Y = %v/%v, want 38/148", msg.X, msg.Y)
	}
	if msg.How == nil || *msg.How != 0 {
		t.Errorf("How = %v, want 0", msg.How)
	}
	if msg.Orient == nil || *msg.Orient != 17 {
		t.Errorf("Orient = %v, want 17", msg.Orient)
	}
}

func TestUnmarshal_ThrowBroadcastBareObjNoid(t *testing.T) {
	// Same shape as PUT$ — HabitatMod.java:987 emits "obj" as bare noid.
	raw := []byte(`{"type":"neighbor","noid":19,"op":"THROW$","obj":7,"x":100,"y":120,"hit":1}`)
	var msg ElkoMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg.ObjectNoid == nil || *msg.ObjectNoid != 7 {
		t.Errorf("ObjectNoid = %v, want 7", msg.ObjectNoid)
	}
	if msg.Hit == nil || *msg.Hit != 1 {
		t.Errorf("Hit = %v, want 1", msg.Hit)
	}
}

func TestUnmarshal_MakeWithEmbeddedObject(t *testing.T) {
	// Object shape: must still decode into m.Obj as a full HabitatObject.
	raw := []byte(`{"op":"make","to":"context-Downtown_5f","obj":{"type":"item","ref":"item-thing-1","name":"Thing","mods":[{"type":"Knick_knack","noid":42,"x":80,"y":120}]}}`)
	var msg ElkoMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg.Obj == nil {
		t.Fatalf("Obj should be populated for object-shape payload")
	}
	if msg.Obj.Ref != "item-thing-1" {
		t.Errorf("Obj.Ref = %q, want item-thing-1", msg.Obj.Ref)
	}
	if len(msg.Obj.Mods) != 1 || msg.Obj.Mods[0].Type == nil || *msg.Obj.Mods[0].Type != "Knick_knack" {
		t.Errorf("Obj.Mods not decoded: %+v", msg.Obj.Mods)
	}
	if msg.ObjectNoid != nil {
		t.Errorf("ObjectNoid should be nil for object-shape payload, got %v", msg.ObjectNoid)
	}
}

func TestUnmarshal_ObjNullOrAbsentDoesNothing(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{"absent", `{"op":"make","to":"region","noid":5}`},
		{"null", `{"op":"make","to":"region","noid":5,"obj":null}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var msg ElkoMessage
			if err := json.Unmarshal([]byte(c.raw), &msg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if msg.Obj != nil {
				t.Errorf("Obj should be nil for %s", c.name)
			}
			if msg.ObjectNoid != nil {
				t.Errorf("ObjectNoid should be nil for %s", c.name)
			}
		})
	}
}

func TestUnmarshal_ChangeContainersBroadcast(t *testing.T) {
	// Full CHANGE_CONTAINERS_$ broadcast from Avatar.java:1434. Elko
	// emits snake_case `object_noid` and `container_noid`. ObjectNoid
	// has always been correct via its standard json tag; ContainerNoid's
	// struct tag is camelCase (matches the PUT verb's inbound shape),
	// so the snake_case inbound was silently lost until the polymorphic
	// container_noid routing was added.
	raw := []byte(`{"type":"broadcast","noid":0,"op":"CHANGE_CONTAINERS_$","object_noid":42,"container_noid":7,"x":50,"y":140}`)
	var msg ElkoMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg.ObjectNoid == nil || *msg.ObjectNoid != 42 {
		t.Errorf("ObjectNoid = %v, want 42", msg.ObjectNoid)
	}
	if msg.ContainerNoid == nil || *msg.ContainerNoid != 7 {
		t.Errorf("ContainerNoid = %v, want 7", msg.ContainerNoid)
	}
	if msg.X == nil || *msg.X != 50 || msg.Y == nil || *msg.Y != 140 {
		t.Errorf("X/Y = %v/%v, want 50/140", msg.X, msg.Y)
	}
}

func TestMarshal_ContainerNoidStillEmitsCamelCaseForElkoInbound(t *testing.T) {
	// The outbound (bridge→elko) PUT verb needs `containerNoid`
	// (camelCase) — that's what elko's @JSONMethod expects (HabitatMod.PUT).
	// The struct tag remains camelCase to satisfy this. Verify that the
	// new container_noid envelope handling didn't accidentally break
	// the marshal path.
	noid := uint8(3)
	to := "item-foo"
	op := "PUT"
	msg := ElkoMessage{
		To:            &to,
		Op:            &op,
		ContainerNoid: &noid,
	}
	out, err := json.Marshal(&msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(out)
	if !strings.Contains(got, `"containerNoid":3`) {
		t.Errorf("marshal did not emit containerNoid camelCase key: %s", got)
	}
	if strings.Contains(got, `"container_noid"`) {
		t.Errorf("marshal should NOT emit container_noid for outbound PUT: %s", got)
	}
}

func TestUnmarshal_BodyShapesUnchanged(t *testing.T) {
	// Sanity check: the existing body handling (object vs the bare-zero
	// sentinel) is not regressed by the obj-handling addition.
	cases := []struct {
		name      string
		raw       string
		bodyNil   bool
		bodyRef   string
	}{
		{
			name:    "body object",
			raw:     `{"op":"make","body":{"type":"User","ref":"user-foo","name":"Foo","mods":[{"type":"Avatar","noid":13}]}}`,
			bodyRef: "user-foo",
		},
		{
			name:    "body bare zero",
			raw:     `{"op":"CORPORATE","body":0}`,
			bodyNil: true,
		},
		{
			name:    "body null",
			raw:     `{"op":"DISCORPORATE","body":null}`,
			bodyNil: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var msg ElkoMessage
			if err := json.Unmarshal([]byte(c.raw), &msg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if c.bodyNil {
				if msg.Body != nil {
					t.Errorf("Body should be nil, got %+v", msg.Body)
				}
				return
			}
			if msg.Body == nil {
				t.Fatalf("Body should be populated")
			}
			if msg.Body.Ref != c.bodyRef {
				t.Errorf("Body.Ref = %q, want %q", msg.Body.Ref, c.bodyRef)
			}
		})
	}
}
