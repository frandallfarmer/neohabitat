package bridge

import (
	"bytes"
	"testing"
)

// These tests pin the corrupt-frame contract at the session level: a frame
// that fails its CRC must be NAKed and DISCARDED — never processed. This is
// the C64's own receiver behavior (mikes_protocol.m bad_pkt: snd_NAK +
// discard) and the fix for the 2026-07-03 "REVOLUTIONARY SUES ORACLE"
// truncation: a line-noise-corrupted frame's garbage RecvSeq was fed into
// qlinkProcessAck, which freed every un-ACKed split-document chunk from the
// retransmit window as if the client had received them. With the window
// empty, the stuck-RecvSeq resend rule had nothing left to resend and the
// page stayed truncated at a chunk boundary forever.

// newQLinkTestSession builds the minimal session the QLink frame handler
// needs: a recording client conn (to observe NAKs) and live sequence state.
// No Elko, no real TCP.
func newQLinkTestSession() (*ClientSession, *recordingConn) {
	b := &Bridge{DataRate: 1 << 20, Sessions: map[string]*ClientSession{}}
	rc := newRecordingConn(nil)
	return &ClientSession{
		bridge:      b,
		clientConn:  NewClientConnection(b, rc),
		qlinkMode:   true,
		qlinkInSeq:  QLinkSeqLow,
		qlinkOutSeq: QLinkSeqLow,
	}, rc
}

// corruptFrame returns a well-formed frame body with one post-CRC byte
// flipped, simulating an RS-232 bit error. Flipping RecvSeq (byte 6) is the
// dangerous case: under the old lenient decode, a garbage RecvSeq could
// "acknowledge" the entire retransmit window.
func corruptFrame(cmd, sendSeq, recvSeq byte, garbageRecv byte) []byte {
	frame := EncodeQLinkFrame(cmd, sendSeq, recvSeq, nil)
	frame[6] = garbageRecv // CRC no longer matches
	return frame
}

// wireFrames splits everything written to the recording conn into QLink
// frame bodies (writeQLinkFrameBytes terminates each with FrameEnd 0x0D).
func wireFrames(rc *recordingConn) [][]byte {
	raw := rc.Written()
	var frames [][]byte
	for _, f := range bytes.Split(raw, []byte{QLinkFrameEnd}) {
		if len(f) > 0 {
			frames = append(frames, f)
		}
	}
	return frames
}

func TestHandleQLinkFrame_CorruptFrameIsDroppedAndNAKed(t *testing.T) {
	c, rc := newQLinkTestSession()

	// Seed a retransmit window holding three un-ACKed split-document chunks.
	c.qlinkSentWindow = []qlinkSentFrame{
		{seq: 0x20, frame: []byte{1}},
		{seq: 0x21, frame: []byte{2}},
		{seq: 0x22, frame: []byte{3}},
	}
	c.qlinkInSeq = 0x30

	// A corrupted frame whose garbage RecvSeq (0x60 >= all window seqs)
	// would have freed the whole window under the old "ignore and process"
	// behavior — and whose garbage SendSeq would have poisoned qlinkInSeq.
	if err := c.handleQLinkFrame(corruptFrame(QLinkCmdAction, 0x55, 0x21, 0x60)); err != nil {
		t.Fatalf("handleQLinkFrame returned err on corrupt frame: %v", err)
	}

	if got := len(c.qlinkSentWindow); got != 3 {
		t.Errorf("retransmit window len = %d after corrupt frame, want 3 (untouched)", got)
	}
	if c.qlinkInSeq != 0x30 {
		t.Errorf("qlinkInSeq = 0x%02x after corrupt frame, want 0x30 (untouched)", c.qlinkInSeq)
	}

	frames := wireFrames(rc)
	if len(frames) != 1 {
		t.Fatalf("wrote %d frames, want exactly 1 NAK", len(frames))
	}
	nak, err := DecodeQLinkFrame(frames[0])
	if err != nil {
		t.Fatalf("NAK frame failed to decode: %v", err)
	}
	if nak.Cmd != HabitatNAK {
		t.Errorf("reply cmd = 0x%02x, want NAK 0x%02x", nak.Cmd, HabitatNAK)
	}
	if nak.SendSeq != c.qlinkOutSeq || nak.RecvSeq != 0x30 {
		t.Errorf("NAK seqs = %02x/%02x, want current outSeq %02x / inSeq 30",
			nak.SendSeq, nak.RecvSeq, c.qlinkOutSeq)
	}
}

func TestHandleQLinkFrame_NakDebouncedThenRearmedByValidFrame(t *testing.T) {
	c, rc := newQLinkTestSession()

	// First corrupt frame: one NAK.
	c.handleQLinkFrame(corruptFrame(QLinkCmdPing, 0x11, 0x11, 0x66))
	// Burst of further corrupt frames while NAK_sent is armed: silent.
	c.handleQLinkFrame(corruptFrame(QLinkCmdPing, 0x12, 0x11, 0x67))
	c.handleQLinkFrame(corruptFrame(QLinkCmdPing, 0x13, 0x11, 0x68))
	if got := len(wireFrames(rc)); got != 1 {
		t.Fatalf("wrote %d frames during noise burst, want 1 (debounced NAK)", got)
	}

	// A valid Ping re-arms the debounce (and is answered with ResetAck).
	if err := c.handleQLinkFrame(EncodeQLinkFrame(QLinkCmdPing, 0x11, 0x11, nil)); err != nil {
		t.Fatalf("valid ping err: %v", err)
	}
	// Next corrupt frame must NAK again.
	c.handleQLinkFrame(corruptFrame(QLinkCmdPing, 0x14, 0x11, 0x69))

	frames := wireFrames(rc)
	// Expect: NAK, ResetAck (ping reply), NAK.
	if len(frames) != 3 {
		t.Fatalf("wrote %d frames, want 3 (NAK, ResetAck, NAK)", len(frames))
	}
	for i, wantCmd := range []byte{HabitatNAK, QLinkCmdAck, HabitatNAK} {
		f, err := DecodeQLinkFrame(frames[i])
		if err != nil {
			t.Fatalf("frame %d failed to decode: %v", i, err)
		}
		if f.Cmd != wantCmd {
			t.Errorf("frame %d cmd = 0x%02x, want 0x%02x", i, f.Cmd, wantCmd)
		}
	}
}
