package bridge

import (
	"bytes"
	"encoding/json"
	"testing"
)

// Regression coverage: FIDDLE_$'s `value` field is polymorphic on the wire —
// a bare integer for a single-arg fiddle and a JSON array for multi-arg
// fiddles (HabitatMod.compose_fiddle_msg @ HabitatMod.java:2207-2211). The old
// *uint8 schema parsed the scalar form but failed the whole-message unmarshal
// on the array form ("json: cannot unmarshal array into Go struct field
// ...value of type uint8"), silently dropping multi-byte FIDDLE_$ broadcasts
// (avatar customize, token denominations, posted text).

func TestUnmarshal_FiddleScalarValue(t *testing.T) {
	raw := []byte(`{"type":"private","noid":5,"op":"FIDDLE_$","target":14,"offset":2,"argCount":1,"value":50}`)
	var msg ElkoMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(msg.Value) != 1 || msg.Value[0] != 50 {
		t.Errorf("Value = %v, want [50]", msg.Value)
	}
	if msg.ArgCount == nil || *msg.ArgCount != 1 {
		t.Errorf("ArgCount = %v, want 1", msg.ArgCount)
	}
}

func TestUnmarshal_FiddleArrayValue(t *testing.T) {
	// Exact payload from the reported bridge error (talking to SageBot).
	raw := []byte(`{"type":"broadcast", "noid":0, "op":"FIDDLE_$", "target":14, "offset":15, "argCount":2, "value":[50, 4]}`)
	var msg ElkoMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal (the reported regression): %v", err)
	}
	if len(msg.Value) != 2 || msg.Value[0] != 50 || msg.Value[1] != 4 {
		t.Errorf("Value = %v, want [50 4]", msg.Value)
	}
	if msg.Target == nil || *msg.Target != 14 {
		t.Errorf("Target = %v, want 14", msg.Target)
	}
	if msg.Offset == nil || *msg.Offset != 15 {
		t.Errorf("Offset = %v, want 15", msg.Offset)
	}
	if msg.ArgCount == nil || *msg.ArgCount != 2 {
		t.Errorf("ArgCount = %v, want 2", msg.ArgCount)
	}
}

// The C64 client (actions.m fiddle_with_object) reads
// [target][offset][argCount][argCount value bytes] in a loop. The encoder must
// emit every value byte, not just the first, or the binary stream desyncs on
// multi-arg fiddles.
func TestFiddle_EncodesAllValueBytes(t *testing.T) {
	raw := []byte(`{"op":"FIDDLE_$","target":14,"offset":15,"argCount":2,"value":[50,4]}`)
	var msg ElkoMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	op, ok := ServerOps["FIDDLE_$"]
	if !ok || op.ToClient == nil {
		t.Fatal("FIDDLE_$ ServerOp / ToClient missing")
	}
	buf := NewHabBufEmpty()
	op.ToClient(&msg, buf, nil)
	got := buf.Data()
	want := []byte{14, 15, 2, 50, 4} // target, offset, argCount, value[0], value[1]
	if !bytes.Equal(got, want) {
		t.Errorf("encoded = %v, want %v", got, want)
	}
}
