package bridge

import (
	"bytes"
	"math/rand"
	"testing"
	"time"
)

// Closed-loop simulation of a split-document transfer over a LOSSY QLink link,
// driving the REAL bridge send/retransmit against a faithful model of the C64
// receiver (Main/protocol.m). This reproduces the conditions of Snog's U64
// session (2026-07-03): heavy packet loss, constant retransmission, a
// multi-chunk page. The invariant under test is the one the U64 violated on
// screen — the bytes the C64 reassembles must equal the bytes the bridge sent,
// with no duplicated or dropped chunk, across any loss pattern and across the
// [0x10,0x7F] sequence wrap.

// c64Receiver models the C64's QLink DATA-frame reception per Main/protocol.m:
//   - strict in-order accept: a frame is processed only when its SendSeq ==
//     NXTSEQ; NXTSEQ then advances (wrapping 0x7F -> 0x10, p_get_next_seq_number).
//   - INWIND dedup (protocol.m:511): an out-of-seq frame that is "recent"
//     (already received) is IGNORED, not reprocessed; a "future" frame is NAKed.
//   - oversize guard (protocol.m:211, `bmi p_bad_packet`): a frame whose body
//     after SYNC reaches 128 bytes (COUNT sign bit) is rejected → NAK.
//   - split reassembly by the SPLIT_START/MIDDLE/END flags in the Habitat seq
//     byte: START resets the accumulator, END delivers it.
type c64Receiver struct {
	nxtseq      byte   // next in-order seq expected
	lstseq      byte   // last in-order seq accepted (piggybacked as RecvSeq)
	reasm       []byte // current split-message accumulation (content slices)
	assembling  bool
	delivered   []byte // last fully-reassembled message
	sawFuture   bool   // a future (gap) frame arrived this step → will NAK
	sawOversize bool   // an oversized frame arrived → NAK
}

func newC64Receiver() *c64Receiver {
	// The bridge pre-increments qlinkOutSeq before its first send, so the first
	// chunk goes out at QLinkIncSeq(QLinkSeqLow) = 0x11; the INIT handshake syncs
	// the C64's NXTSEQ to that. Model that so we don't self-inflict a livelock.
	return &c64Receiver{nxtseq: QLinkIncSeq(QLinkSeqLow), lstseq: QLinkSeqLow}
}

// c64Inwind mirrors protocol.m INWIND exactly. Returns true if `seq` is
// "recent" (an already-received duplicate → IGNORE); false if it is a "future"
// out-of-seq frame (→ NAK). Uses raw 8-bit arithmetic like the 6502.
func c64Inwind(seq, nxtseq byte) bool {
	if seq >= nxtseq { // carry set after `sbc NXTSEQ`
		return seq-nxtseq >= 32 // much larger ⇒ OLD news (wrapped); else future
	}
	return nxtseq-seq < 33 // much smaller ⇒ OLD news; else future
}

func c64IncSeq(seq byte) byte {
	if seq == QLinkSeqDefault {
		return QLinkSeqLow
	}
	return seq + 1
}

// receive processes one intact QLink frame (CRC already good — a corrupted
// frame is modeled as a drop, since the C64 NAKs+discards those and we proved
// that path separately). It updates NXTSEQ/reassembly and records whether a
// NAK-worthy condition occurred.
func (r *c64Receiver) receive(frame []byte) {
	f, err := DecodeQLinkFrame(frame)
	if err != nil || f.Cmd != QLinkCmdAction {
		return
	}
	// Oversize guard: COUNT counts bytes after SYNC; EOM at COUNT>=128 is bad.
	// body = frame (without trailing FrameEnd); after SYNC = len(frame)-1.
	if len(frame)-1 >= 128 {
		r.sawOversize = true
		return
	}
	if f.SendSeq == r.nxtseq {
		r.accept(f)
		return
	}
	if !c64Inwind(f.SendSeq, r.nxtseq) {
		r.sawFuture = true // gap → the C64 NAKs asking for nxtseq
	}
	// recent duplicate → silently IGNORE (no reprocess): this is the dedup that
	// must prevent a resent chunk from being appended twice.
}

func (r *c64Receiver) accept(f *QLinkFrame) {
	hab := Descape(f.Payload, 0) // [0x55, seqByte, noid, reqnum, content...]
	if len(hab) < 4 {
		return
	}
	flags := hab[1]
	content := hab[4:]
	if flags&SPLIT_START != 0 {
		r.reasm = nil
		r.assembling = true
	}
	if r.assembling {
		r.reasm = append(r.reasm, content...)
	}
	if flags&SPLIT_END != 0 && r.assembling {
		r.delivered = append([]byte(nil), r.reasm...)
		r.assembling = false
	}
	r.lstseq = f.SendSeq
	r.nxtseq = c64IncSeq(r.nxtseq)
}

// heartbeat returns the frame the C64 sends back this step: a NAK (0x25) if it
// saw a gap/oversize (demanding retransmit), else a Ping. Either way it
// piggybacks its true cumulative ack (lstseq) as RecvSeq — exactly what the
// bridge reads.
func (r *c64Receiver) heartbeat() []byte {
	cmd := QLinkCmdPing
	if r.sawFuture || r.sawOversize {
		cmd = HabitatNAK
	}
	r.sawFuture, r.sawOversize = false, false
	return EncodeQLinkFrame(cmd, 0x40, r.lstseq, nil)
}

// splitPageToWindow mirrors sendSplitHabitatAction's chunking but calls the
// REAL per-chunk sender (sendQLinkHabitatAction: real escape + encode + window
// record) with no inter-chunk sleep, and returns the frames it put on the wire.
func splitPageToWindow(t *testing.T, c *ClientSession, rc *recordingConn, data []byte) [][]byte {
	t.Helper()
	header := data[:4]
	payload := data[4:]
	base := header[1] & SPLIT_MASK
	for start := 0; start < len(payload); start += MAX_PACKET_SIZE {
		size := len(payload) - start
		if size > MAX_PACKET_SIZE {
			size = MAX_PACKET_SIZE
		}
		ch := make([]byte, 4)
		copy(ch, header)
		seqByte := base | SPLIT_MIDDLE
		if start == 0 {
			seqByte |= SPLIT_START
		}
		if start+size >= len(payload) {
			seqByte |= SPLIT_END
		}
		ch[1] = seqByte
		pkt := append(append([]byte{}, ch...), payload[start:start+size]...)
		if err := c.sendQLinkHabitatAction(pkt); err != nil {
			t.Fatalf("send chunk: %v", err)
		}
	}
	return wireFrames(rc)
}

func (r *recordingConn) reset() { r.mu.Lock(); r.writes.Reset(); r.mu.Unlock() }

// drainPage runs one already-queued page through the lossy link until the C64
// reassembles it or the round cap trips. Reuses a persistent session + C64 so
// sequence numbers accumulate across pages (to cross the wrap). Returns the
// reassembled bytes and whether it converged.
func drainPage(t *testing.T, c *ClientSession, c64 *c64Receiver, inflight [][]byte, rng *rand.Rand, expected []byte, lossRate float64) ([]byte, bool) {
	t.Helper()
	const maxRounds = 4000
	for round := 0; round < maxRounds; round++ {
		for _, f := range inflight {
			if rng.Float64() < lossRate {
				continue // lost on the wire (or corrupted → C64 NAK+discard)
			}
			c64.receive(f)
		}
		if bytes.Equal(c64.delivered, expected) {
			return c64.delivered, true
		}
		// C64 answers with its cumulative ack (NAK on a gap). Age the resend
		// clock so the stuck-RecvSeq path isn't rate-limited.
		c.qlinkLastResend = time.Now().Add(-time.Hour)
		inflight = c.qlinkProcessAck(mustDecode(t, c64.heartbeat()))
		if len(inflight) == 0 {
			c.qlinkLastResend = time.Now().Add(-time.Hour)
			inflight = c.qlinkProcessAck(mustDecode(t, c64.heartbeat()))
			if len(inflight) == 0 {
				return c64.delivered, false // unrecoverable stall
			}
		}
	}
	return c64.delivered, false
}

// runLossySim: single page over a fresh lossy session.
func runLossySim(t *testing.T, data []byte, lossRate float64, seed int64) ([]byte, bool) {
	t.Helper()
	c, rc := newQLinkTestSession()
	rng := rand.New(rand.NewSource(seed))
	c64 := newC64Receiver()
	inflight := splitPageToWindow(t, c, rc, data)
	return drainPage(t, c, c64, inflight, rng, data[4:], lossRate)
}

// runLossyPaging: many pages read in sequence over ONE persistent session,
// crossing the [0x10,0x7F] sequence wrap — the Snog-pages-the-whole-RANT
// scenario. Each page must reassemble byte-exact before the next is sent.
func runLossyPaging(t *testing.T, pages [][]byte, lossRate float64, seed int64) (bool, int) {
	t.Helper()
	c, rc := newQLinkTestSession()
	rng := rand.New(rand.NewSource(seed))
	c64 := newC64Receiver()
	for pi, data := range pages {
		rc.reset() // capture only this page's frames
		inflight := splitPageToWindow(t, c, rc, data)
		got, ok := drainPage(t, c, c64, inflight, rng, data[4:], lossRate)
		if !ok || !bytes.Equal(got, data[4:]) {
			return false, pi
		}
	}
	return true, -1
}

func mustDecode(t *testing.T, frame []byte) *QLinkFrame {
	t.Helper()
	f, err := DecodeQLinkFrame(frame)
	if err != nil {
		t.Fatalf("decode heartbeat: %v", err)
	}
	return f
}

// makePage builds a Habitat book-page packet: [0x55, seq, noid, reqnum] + body.
func makePage(body []byte) []byte {
	return append([]byte{MICROCOSM_ID_BYTE, 0x10, 0x15, 0x00}, body...)
}

func TestQLinkLossyReassembly_PageIsExactAcrossLoss(t *testing.T) {
	// A realistic multi-line page body (text + the leading 0x0d + box control
	// bytes), ~640 bytes, exactly the shape that failed on the U64.
	var body []byte
	body = append(body, 0x0a) // page-number preamble byte
	line := []byte("   Asked to comment, RJHermit's only    ")
	for len(body) < 641 {
		body = append(body, line...)
	}
	body = body[:641]
	data := makePage(body)

	for _, loss := range []float64{0.0, 0.1, 0.25, 0.4, 0.6} {
		for seed := int64(1); seed <= 20; seed++ {
			got, ok := runLossySim(t, data, loss, seed)
			if !ok {
				t.Fatalf("loss=%.2f seed=%d: transfer did NOT converge (livelock)", loss, seed)
			}
			if !bytes.Equal(got, data[4:]) {
				t.Fatalf("loss=%.2f seed=%d: CORRUPTED reassembly\n got len=%d\n want len=%d",
					loss, seed, len(got), len(data[4:]))
			}
		}
	}
}

func TestQLinkLossyReassembly_PagingAcrossSequenceWrap(t *testing.T) {
	// Snog reads the whole RANT: 24 pages of ~640 bytes each (7 chunks/page ⇒
	// ~168 frames, well past the 112-value seq wrap) over ONE lossy session,
	// draining each page before the next. Exercises qlinkAckCovers /
	// qlinkSeqForward (the ack math our recent fixes changed) across the wrap.
	pages := make([][]byte, 24)
	for p := range pages {
		body := make([]byte, 641)
		body[0] = 0x0a
		for i := 1; i < len(body); i++ {
			body[i] = byte(0x20 + ((i + p) % 90)) // distinct per page, printable
		}
		pages[p] = makePage(body)
	}
	for _, loss := range []float64{0.1, 0.3, 0.5} {
		for seed := int64(1); seed <= 10; seed++ {
			ok, badPage := runLossyPaging(t, pages, loss, seed)
			if !ok {
				t.Fatalf("paging loss=%.2f seed=%d: page %d corrupted or stalled across the seq wrap",
					loss, seed, badPage)
			}
		}
	}
}
