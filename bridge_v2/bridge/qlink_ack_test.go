package bridge

import (
	"testing"
	"time"
)

// These tests pin the cumulative-ack contract in qlinkProcessAck. The live
// failure they encode (prod 2026-07-03 22:20, Snogpitch session 4): the C64
// sends NAKs from quick_buf, its pre-built "always ready" buffer, so a NAK's
// RXSQ can lag far behind the client's true cumulative ack — a NAK carried
// recv_seq 85 while concurrent heartbeats said 100+. The old wrap heuristic
// (`seq - recvSeq > 16` => "must have wrapped") read that stale value as a
// wrapped ack and freed un-received split-document chunks 104-108; the client
// then asked for seq 105 forever while we could only resend 109 — an
// unrecoverable livelock until the client reset.

func ackTestSession() *ClientSession {
	c, _ := newQLinkTestSession()
	return c
}

func window(seqs ...byte) []qlinkSentFrame {
	w := make([]qlinkSentFrame, len(seqs))
	for i, s := range seqs {
		w[i] = qlinkSentFrame{seq: s, frame: EncodeQLinkFrame(QLinkCmdAction, s, 0x10, []byte("U?"))}
	}
	return w
}

func TestQlinkProcessAck_StaleNakRecvSeqMustNotFreeWindow(t *testing.T) {
	// The exact live values: window [104..108], lastRecv 103, NAK RXSQ 85.
	c := ackTestSession()
	c.qlinkSentWindow = window(104, 105, 106, 107, 108)
	c.qlinkLastRecv = 103

	resend := c.qlinkProcessAck(&QLinkFrame{Cmd: HabitatNAK, SendSeq: 40, RecvSeq: 85})

	if got := len(c.qlinkSentWindow); got != 5 {
		t.Errorf("window len = %d after stale NAK, want 5 (nothing freed)", got)
	}
	if c.qlinkLastRecv != 103 {
		t.Errorf("qlinkLastRecv = %d after NAK, want 103 (NAK RXSQ never trusted)", c.qlinkLastRecv)
	}
	// The NAK must still trigger an immediate resend of the oldest frame.
	if len(resend) != 1 {
		t.Fatalf("resend count = %d, want 1", len(resend))
	}
	f, err := DecodeQLinkFrame(resend[0])
	if err != nil || f.SendSeq != 104 {
		t.Errorf("resent seq = %d (err %v), want oldest un-acked 104", f.SendSeq, err)
	}
}

func TestQlinkProcessAck_BackwardHeartbeatAckIsIgnored(t *testing.T) {
	// A regressed cumulative ack on a heartbeat is stale, not wrapped.
	c := ackTestSession()
	c.qlinkSentWindow = window(104, 105, 106)
	c.qlinkLastRecv = 103

	c.qlinkProcessAck(&QLinkFrame{Cmd: QLinkCmdPing, SendSeq: 40, RecvSeq: 85})

	if got := len(c.qlinkSentWindow); got != 3 {
		t.Errorf("window len = %d after backward ack, want 3", got)
	}
	if c.qlinkLastRecv != 103 {
		t.Errorf("qlinkLastRecv = %d, want 103 (backward ack not recorded)", c.qlinkLastRecv)
	}
}

func TestQlinkProcessAck_ForwardHeartbeatAckFrees(t *testing.T) {
	c := ackTestSession()
	c.qlinkSentWindow = window(104, 105, 106, 107, 108)
	c.qlinkLastRecv = 103

	c.qlinkProcessAck(&QLinkFrame{Cmd: QLinkCmdPing, SendSeq: 40, RecvSeq: 106})

	if got := len(c.qlinkSentWindow); got != 2 {
		t.Fatalf("window len = %d after ack of 106, want 2 (107,108 remain)", got)
	}
	if c.qlinkSentWindow[0].seq != 107 {
		t.Errorf("window head = %d, want 107", c.qlinkSentWindow[0].seq)
	}
	if c.qlinkLastRecv != 106 {
		t.Errorf("qlinkLastRecv = %d, want 106", c.qlinkLastRecv)
	}
}

func TestQlinkProcessAck_RealWrapStillFrees(t *testing.T) {
	// Genuine wrap: window straddles 0x7F -> 0x10 and the client's ack
	// lands past the boundary. This is forward motion and must free.
	c := ackTestSession()
	c.qlinkSentWindow = window(0x7E, 0x7F, 0x10, 0x11)
	c.qlinkLastRecv = 0x7D

	c.qlinkProcessAck(&QLinkFrame{Cmd: QLinkCmdPing, SendSeq: 40, RecvSeq: 0x10})

	if got := len(c.qlinkSentWindow); got != 1 {
		t.Fatalf("window len = %d after wrapped ack of 0x10, want 1 (only 0x11)", got)
	}
	if c.qlinkSentWindow[0].seq != 0x11 {
		t.Errorf("window head = 0x%02x, want 0x11", c.qlinkSentWindow[0].seq)
	}
}

func TestQlinkProcessAck_StuckHeartbeatStillResends(t *testing.T) {
	// The stuck-RecvSeq resend rule must survive the restructure: same
	// RecvSeq across heartbeats with frames outstanding => go-back-1.
	c := ackTestSession()
	c.qlinkSentWindow = window(104, 105)
	c.qlinkLastRecv = 103
	c.qlinkLastResend = time.Now().Add(-2 * qlinkResendInterval)

	resend := c.qlinkProcessAck(&QLinkFrame{Cmd: QLinkCmdPing, SendSeq: 40, RecvSeq: 103})

	if len(resend) != 1 {
		t.Fatalf("resend count = %d, want 1 (stuck heartbeat)", len(resend))
	}
	f, err := DecodeQLinkFrame(resend[0])
	if err != nil || f.SendSeq != 104 {
		t.Errorf("resent seq = %d (err %v), want 104", f.SendSeq, err)
	}
}

func TestQlinkSeqForward(t *testing.T) {
	cases := []struct {
		from, to byte
		want     int
	}{
		{0x10, 0x10, 0},
		{0x10, 0x11, 1},
		{0x7F, 0x10, 1},  // the wrap is one forward step
		{0x67, 0x55, 94}, // 103 -> 85 is 94 steps FORWARD (i.e., 18 back)
		{0x55, 0x67, 18},
	}
	for _, tc := range cases {
		if got := qlinkSeqForward(tc.from, tc.to); got != tc.want {
			t.Errorf("qlinkSeqForward(0x%02x, 0x%02x) = %d, want %d", tc.from, tc.to, got, tc.want)
		}
	}
}
