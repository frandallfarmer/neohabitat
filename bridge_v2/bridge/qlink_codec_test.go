package bridge

import (
	"bufio"
	"bytes"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// TestQLinkCRC16_KnownFrames cross-checks our CRC implementation against the
// two real-world QLink frames documented in qlink/reference/protocol/. If
// either of these fails, the CRC routine doesn't match QLinkReloaded and
// nothing else will interoperate.
func TestQLinkCRC16_KnownFrames(t *testing.T) {
	cases := []struct {
		name string
		body []byte
		want uint16
	}{
		{
			name: "Reset (5a 81 42 31 4e 7f 7f 23 05 09 0d)",
			body: []byte{0x7f, 0x7f, 0x23, 0x05, 0x09},
			want: 0x823E,
		},
		{
			name: "Ping (5a 31 42 91 40 7f 7f 26 0d)",
			body: []byte{0x7f, 0x7f, 0x26},
			want: 0x3290,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := QLinkCRC16(c.body)
			if got != c.want {
				t.Errorf("QLinkCRC16 = 0x%04x, want 0x%04x", got, c.want)
			}
		})
	}
}

// TestEncodeQLinkFrame_KnownFrames verifies the full encoder reproduces the
// canonical reset and ping byte sequences exactly.
func TestEncodeQLinkFrame_KnownFrames(t *testing.T) {
	cases := []struct {
		name    string
		cmd     byte
		send    byte
		recv    byte
		payload []byte
		want    []byte
	}{
		{
			name:    "Reset",
			cmd:     QLinkCmdReset,
			send:    QLinkSeqDefault,
			recv:    QLinkSeqDefault,
			payload: []byte{0x05, 0x09},
			want:    []byte{0x5a, 0x81, 0x42, 0x31, 0x4e, 0x7f, 0x7f, 0x23, 0x05, 0x09},
		},
		{
			name:    "Ping",
			cmd:     QLinkCmdPing,
			send:    QLinkSeqDefault,
			recv:    QLinkSeqDefault,
			payload: nil,
			want:    []byte{0x5a, 0x31, 0x42, 0x91, 0x40, 0x7f, 0x7f, 0x26},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := EncodeQLinkFrame(c.cmd, c.send, c.recv, c.payload)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("EncodeQLinkFrame:\n got  = % x\n want = % x", got, c.want)
			}
		})
	}
}

// TestQLinkRoundTrip encodes a frame, decodes it, and verifies all fields
// match the originals. Catches any asymmetry between encoder and decoder.
func TestQLinkRoundTrip(t *testing.T) {
	cases := []struct {
		name    string
		cmd     byte
		send    byte
		recv    byte
		payload []byte
	}{
		{"reset header-only", QLinkCmdReset, 0x7f, 0x7f, nil},
		{"action with mnemonic", QLinkCmdAction, 0x10, 0x10, []byte("UR")},
		{"habitat action with payload", QLinkCmdAction, 0x42, 0x41, []byte{
			'U', 0x4F, // mnemonic == start of habitat packet
			0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0E, 0x0F, // omits 0x0D
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			frame := EncodeQLinkFrame(c.cmd, c.send, c.recv, c.payload)
			parsed, err := DecodeQLinkFrame(frame)
			if err != nil {
				t.Fatalf("DecodeQLinkFrame err = %v", err)
			}
			if parsed.Cmd != c.cmd {
				t.Errorf("Cmd = 0x%02x, want 0x%02x", parsed.Cmd, c.cmd)
			}
			if parsed.SendSeq != c.send {
				t.Errorf("SendSeq = 0x%02x, want 0x%02x", parsed.SendSeq, c.send)
			}
			if parsed.RecvSeq != c.recv {
				t.Errorf("RecvSeq = 0x%02x, want 0x%02x", parsed.RecvSeq, c.recv)
			}
			if !bytes.Equal(parsed.Payload, c.payload) {
				t.Errorf("Payload = % x, want % x", parsed.Payload, c.payload)
			}
		})
	}
}

// TestDecodeQLinkFrame_BadCRC confirms the decoder's documented lenient
// behavior on CRC mismatch: it logs a warning but still returns the parsed
// frame rather than rejecting it. Real C64 RS-232 streams get occasional
// one-bit hiccups from IRQ jitter, and dropping those frames outright
// would cause session hangs — downstream handling catches truly broken
// payloads. See qlink_codec.go:161-169 for the rationale.
func TestDecodeQLinkFrame_BadCRC(t *testing.T) {
	frame := EncodeQLinkFrame(QLinkCmdReset, 0x7f, 0x7f, []byte{0x05, 0x09})
	frame[1] ^= 0x10 // flip a CRC nibble bit
	parsed, err := DecodeQLinkFrame(frame)
	if err != nil {
		t.Fatalf("DecodeQLinkFrame returned unexpected error on CRC mismatch: %v", err)
	}
	if parsed == nil {
		t.Fatal("DecodeQLinkFrame returned nil frame on CRC mismatch")
	}
	// The frame fields should still be parsed from the raw bytes — only
	// the CRC bytes themselves are corrupted. A Reset frame with send/recv
	// sequences 0x7f/0x7f and payload {0x05, 0x09} should decode cleanly
	// even with the CRC wrong.
	if parsed.Cmd != QLinkCmdReset {
		t.Errorf("Cmd = 0x%02x, want 0x%02x", parsed.Cmd, QLinkCmdReset)
	}
	if parsed.SendSeq != 0x7f {
		t.Errorf("SendSeq = 0x%02x, want 0x7f", parsed.SendSeq)
	}
	if parsed.RecvSeq != 0x7f {
		t.Errorf("RecvSeq = 0x%02x, want 0x7f", parsed.RecvSeq)
	}
	if !bytes.Equal(parsed.Payload, []byte{0x05, 0x09}) {
		t.Errorf("Payload = % x, want [05 09]", parsed.Payload)
	}
}

// TestDecodeQLinkFrame_BadMagic ensures the decoder rejects a frame whose
// first byte isn't CMD_START.
func TestDecodeQLinkFrame_BadMagic(t *testing.T) {
	frame := EncodeQLinkFrame(QLinkCmdReset, 0x7f, 0x7f, nil)
	frame[0] = 0x55
	_, err := DecodeQLinkFrame(frame)
	if err == nil {
		t.Fatal("DecodeQLinkFrame accepted a frame with bad magic")
	}
}

// TestQLinkIncSeq verifies the wraparound behavior matches QConnection.incSeq.
func TestQLinkIncSeq(t *testing.T) {
	cases := []struct {
		in, want byte
	}{
		{0x10, 0x11},
		{0x11, 0x12},
		{0x7E, 0x7F},
		{0x7F, 0x10}, // wrap from SEQ_DEFAULT to SEQ_LOW
		{0x00, 0x01}, // values outside the documented range still increment
	}
	for _, c := range cases {
		got := QLinkIncSeq(c.in)
		if got != c.want {
			t.Errorf("QLinkIncSeq(0x%02x) = 0x%02x, want 0x%02x", c.in, got, c.want)
		}
	}
}

// TestIsHabitatAction verifies mnemonic detection.
func TestIsHabitatAction(t *testing.T) {
	cases := []struct {
		name string
		cmd  byte
		body []byte
		want bool
	}{
		{"Action with U mnemonic", QLinkCmdAction, []byte{'U', 'A'}, true},
		{"Action with U? mnemonic", QLinkCmdAction, []byte{'U', '?'}, true},
		{"Action with DD mnemonic", QLinkCmdAction, []byte{'D', 'D'}, false},
		{"Reset frame", QLinkCmdReset, []byte{'U', 'A'}, false},
		{"Action with empty payload", QLinkCmdAction, []byte{}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := &QLinkFrame{Cmd: c.cmd, Payload: c.body}
			if got := f.IsHabitatAction(); got != c.want {
				t.Errorf("IsHabitatAction() = %v, want %v", got, c.want)
			}
		})
	}
}

// TestReadHabilinkPreamble_BasicHandshake walks the parser through the
// minimal Habilink handshake: one line with "name", then one terminator
// line, then arbitrary trailing bytes (which should remain in the buffer
// for the QLink frame loop to consume).
func TestReadHabilinkPreamble_BasicHandshake(t *testing.T) {
	input := `{"version":1}` + "\n" + `{"name": "chip"}` + "\n" + `{"ready":true}` + "\n"
	r := bufio.NewReader(strings.NewReader(input))
	username, err := readHabilinkPreamble(r, "test")
	if err != nil {
		t.Fatalf("readHabilinkPreamble err = %v", err)
	}
	if username != "chip" {
		t.Errorf("username = %q, want %q", username, "chip")
	}
}

// TestReadHabilinkPreamble_NameInFirstLine handles the simpler case where
// the first line contains the name.
func TestReadHabilinkPreamble_NameInFirstLine(t *testing.T) {
	input := `{"name":"alice"}` + "\n" + `{"ack":1}` + "\n"
	r := bufio.NewReader(strings.NewReader(input))
	username, err := readHabilinkPreamble(r, "test")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if username != "alice" {
		t.Errorf("username = %q, want alice", username)
	}
}

// TestReadHabilinkPreamble_NoName confirms a stream that never produces a
// name field returns ErrQLinkPreamble rather than blocking forever.
func TestReadHabilinkPreamble_NoName(t *testing.T) {
	var sb strings.Builder
	for i := 0; i < 80; i++ {
		sb.WriteString(`{"junk":"line"}` + "\n")
	}
	r := bufio.NewReader(strings.NewReader(sb.String()))
	_, err := readHabilinkPreamble(r, "test")
	if err == nil {
		t.Fatal("expected ErrQLinkPreamble, got nil")
	}
	if !errors.Is(err, ErrQLinkPreamble) {
		t.Errorf("err = %v, want ErrQLinkPreamble wrapper", err)
	}
}

// TestReadHabilinkPreamble_PreservesBufferedBytes ensures bytes following
// the second line remain in the bufio.Reader for the QLink layer to consume.
// This is the bug-class that the Java HabilinkProxy has and that we need to
// avoid.
func TestReadHabilinkPreamble_PreservesBufferedBytes(t *testing.T) {
	// 3 preamble lines, then one byte that simulates the start of a QLink
	// frame (CMD_START 0x5A).
	preamble := `{"name":"chip"}` + "\n" + `{"ready":1}` + "\n"
	rest := []byte{QLinkCmdStart, 0x81, 0x42, 0x31, 0x4e}
	full := append([]byte(preamble), rest...)
	r := bufio.NewReader(bytes.NewReader(full))
	username, err := readHabilinkPreamble(r, "test")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if username != "chip" {
		t.Errorf("username = %q, want chip", username)
	}
	// Now read the remaining bytes via the SAME bufio.Reader and confirm
	// nothing was dropped on the floor.
	leftover := make([]byte, len(rest))
	n, err := r.Read(leftover)
	if err != nil || n != len(rest) {
		t.Fatalf("read remainder: n=%d err=%v", n, err)
	}
	if !bytes.Equal(leftover, rest) {
		t.Errorf("leftover bytes = % x, want % x", leftover, rest)
	}
}

// TestReadQLinkFrame_StripsTerminator confirms readQLinkFrame returns the
// frame body without the trailing 0x0D.
func TestReadQLinkFrame_StripsTerminator(t *testing.T) {
	frame := EncodeQLinkFrame(QLinkCmdReset, 0x7f, 0x7f, []byte{0x05, 0x09})
	wire := append([]byte{}, frame...)
	wire = append(wire, QLinkFrameEnd)
	r := bufio.NewReader(bytes.NewReader(wire))
	body, err := readQLinkFrame(r)
	if err != nil {
		t.Fatalf("readQLinkFrame err = %v", err)
	}
	if !bytes.Equal(body, frame) {
		t.Errorf("body = % x, want % x", body, frame)
	}
}

// TestReadQLinkFrame_MultipleFrames verifies the reader correctly stops at
// the first 0x0D and leaves subsequent frames in the buffer.
func TestReadQLinkFrame_MultipleFrames(t *testing.T) {
	f1 := EncodeQLinkFrame(QLinkCmdReset, 0x7f, 0x7f, []byte{0x05, 0x09})
	f2 := EncodeQLinkFrame(QLinkCmdPing, 0x7f, 0x7f, nil)
	wire := append(append(append([]byte{}, f1...), QLinkFrameEnd), f2...)
	wire = append(wire, QLinkFrameEnd)

	r := bufio.NewReader(bytes.NewReader(wire))
	got1, err := readQLinkFrame(r)
	if err != nil || !bytes.Equal(got1, f1) {
		t.Fatalf("first frame: err=%v got=% x want=% x", err, got1, f1)
	}
	got2, err := readQLinkFrame(r)
	if err != nil || !bytes.Equal(got2, f2) {
		t.Fatalf("second frame: err=%v got=% x want=% x", err, got2, f2)
	}
}
