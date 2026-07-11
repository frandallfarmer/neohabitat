package bridge

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net"
	"regexp"
	"time"

	"github.com/rs/zerolog/log"
)

// habilinkNameRegex matches the {"name": "..."} field that the modern thin
// Habitat client sends as part of its handshake before switching the socket
// over to the QLink wire protocol. Mirrors HabilinkProxy.USERNAME_REGEX.
var habilinkNameRegex = regexp.MustCompile(`"name":\s*"([^"]*)"`)

// qlinkWindowSize is the QLink send window — the max un-ACKed Action frames
// we keep for retransmission (mirrors QConnection.QSIZE). Also used for the
// wrap-aware ack comparison in qlinkAckCovers.
const qlinkWindowSize = 16

// qlinkResendInterval rate-limits heartbeat-driven retransmission. The C64
// pings several times a second; when its RecvSeq is stuck (it silently
// dropped a frame it never saw), we resend the window at most this often.
// ~3s lets a resent burst arrive and be acked over the ~1200-baud link.
const qlinkResendInterval = 3 * time.Second

// qlinkChunkPacing spaces out a region DESCRIBE's split chunks. The U64 modem
// trickles bytes into the C64's 6551 at 9600 baud; while the client is busy
// rendering the room its RX NMI is starved and the 1-byte RX register overruns
// (it "falls behind", then self-heals slowly -> the reticule/load delay). A
// short gap between chunks lets the modem buffer drain and the client drain its
// RX + render. Must exceed a chunk's ~100ms feed time to create a real gap
// (else the modem just buffers ahead). Tunable -- raise if client-behind stays.
const qlinkChunkPacing = 50 * time.Millisecond

// qlinkSentFrame is one un-ACKed Action frame held in the retransmit window.
type qlinkSentFrame struct {
	seq   byte
	frame []byte // QLink frame body (no trailing FrameEnd; writeQLinkFrameBytes adds it)
}

// qlinkRecordSentLocked appends a just-sent Action frame to the retransmit
// window. Caller must hold qlinkMu. Bounded so an unreachable client can't
// grow it without limit.
func (c *ClientSession) qlinkRecordSentLocked(seq byte, frame []byte) {
	c.qlinkSentWindow = append(c.qlinkSentWindow, qlinkSentFrame{seq: seq, frame: frame})
	const maxWindow = 64
	if len(c.qlinkSentWindow) > maxWindow {
		c.qlinkSentWindow = c.qlinkSentWindow[len(c.qlinkSentWindow)-maxWindow:]
	}
}

// qlinkSeqSpan is the size of the circular QLink sequence space
// [QLinkSeqLow, QLinkSeqDefault] (0x10..0x7F = 112 values).
const qlinkSeqSpan = int(QLinkSeqDefault) - int(QLinkSeqLow) + 1

// qlinkSeqForward returns how many sequence increments it takes to get from
// `from` to `to` in the circular space (0 if equal, wrapping 0x7F -> 0x10).
func qlinkSeqForward(from, to byte) int {
	d := (int(to) - int(from)) % qlinkSeqSpan
	if d < 0 {
		d += qlinkSeqSpan
	}
	return d
}

// qlinkAckCovers reports whether a cumulative ack of recvSeq acknowledges a
// frame sent with sequence seq: recvSeq is at-or-past seq, allowing for the
// [QLinkSeqLow, QLinkSeqDefault] wrap. "At or past" means the forward
// distance from seq to recvSeq is under half the sequence space — the old
// test (`recvSeq >= seq || seq-recvSeq > qlinkWindowSize`) declared any ack
// lagging 17+ behind to be a wrap, which let a stale NAK RXSQ free frames
// the client had never received (see qlinkProcessAck).
func qlinkAckCovers(seq, recvSeq byte) bool {
	return qlinkSeqForward(seq, recvSeq) <= qlinkSeqSpan/2
}

// qlinkRefreshRecvSeq returns a copy of a stored frame with its piggyback
// RecvSeq (byte 6) replaced by recvSeq and its CRC recomputed. A retransmitted
// frame is otherwise sent verbatim, carrying the stale ack baked in when it was
// first queued; refreshing it lets the resend ALSO acknowledge the client's
// most-recent send, draining the client's send window (which otherwise stays
// pinned until the server emits a brand-new reply). Mirrors EncodeQLinkFrame's
// CRC encoding exactly (CRC covers frame[5:]).
func qlinkRefreshRecvSeq(frame []byte, recvSeq byte) []byte {
	if len(frame) < QLinkHeaderLen {
		return frame
	}
	out := make([]byte, len(frame))
	copy(out, frame)
	out[6] = recvSeq
	crc := QLinkCRC16(out[5:])
	out[1] = byte(((crc & 0xF000) >> 8) | 0x01)
	out[2] = byte(((crc & 0x0F00) >> 8) | 0x40)
	out[3] = byte((crc & 0x00F0) | 0x01)
	out[4] = byte((crc & 0x000F) | 0x40)
	return out
}

// qlinkProcessAck frees window frames the client has acknowledged (via the
// RecvSeq it piggybacks on every frame) and returns the frames to retransmit,
// if any. Called for every inbound frame, before the command switch.
//
// bridge_v2 originally did not retransmit at all, so any dropped frame hung
// the client. The C64 has no ack timer of its own; it just keeps heartbeating
// with its last-received seq. So an explicit SequenceError/NAK resends
// immediately, and a RecvSeq that hasn't advanced across heartbeats (a silent
// drop) resends the window, rate-limited by qlinkResendInterval.
func (c *ClientSession) qlinkProcessAck(frame *QLinkFrame) [][]byte {
	c.qlinkMu.Lock()
	defer c.qlinkMu.Unlock()

	// A Reset restarts the sequence space; the old window is meaningless.
	if frame.Cmd == QLinkCmdReset {
		c.qlinkSentWindow = nil
		c.qlinkLastRecv = QLinkSeqLow
		return nil
	}

	resend := false
	switch frame.Cmd {
	case QLinkCmdSeqErr, HabitatNAK:
		// The client explicitly rejected/lost our last packet: resend, but
		// NEVER free window frames from a NAK's RecvSeq. The C64 sends NAKs
		// from quick_buf, its pre-built "always ready" buffer, so a NAK's
		// RXSQ can lag far behind the true cumulative ack (observed live
		// 2026-07-03: a NAK carried 85 while concurrent heartbeats said
		// 100+). Trusting it freed split-document chunks the client never
		// received — an unrecoverable livelock: the client kept asking for
		// a seq we had already discarded, until it gave up and reset.
		resend = true
	default:
		// Heartbeats/acks/actions carry the client's live cumulative ack.
		// Only honor it when it moves FORWARD from the last one (a
		// backward ack is stale, not wrapped — cumulative acks never
		// regress; the wrap 0x7F->0x10 IS forward motion here).
		if qlinkSeqForward(c.qlinkLastRecv, frame.RecvSeq) <= qlinkSeqSpan/2 {
			for len(c.qlinkSentWindow) > 0 && qlinkAckCovers(c.qlinkSentWindow[0].seq, frame.RecvSeq) {
				c.qlinkSentWindow = c.qlinkSentWindow[1:]
			}
			// Stuck RecvSeq across heartbeats => the client is still
			// missing a frame it never received. Resend, rate-limited.
			if frame.RecvSeq == c.qlinkLastRecv && time.Since(c.qlinkLastResend) >= qlinkResendInterval {
				resend = true
			}
			c.qlinkLastRecv = frame.RecvSeq
		}
	}
	if len(c.qlinkSentWindow) == 0 || !resend {
		return nil
	}
	c.qlinkLastResend = time.Now()
	// Go-back-1: resend ONLY the oldest un-acked frame — the single frame the
	// client needs next — NOT the whole window. Measured on real U64 hardware:
	// blasting the full (up to 64-frame) window at a C64 busy with a heavy
	// region load overruns its single-frame RSINBF, so the one frame it needs
	// keeps getting corrupted and re-dropped while the bridge re-floods every
	// 3s — NXTSEQ frozen for ~52s. One frame at a time, the busy client can
	// actually receive and accept it.
	//
	// Re-encode the piggyback RecvSeq to our CURRENT qlinkInSeq so the resend
	// also carries a fresh ACK of the client's outstanding send. The stored
	// frame's baked-in RecvSeq predates the client's HERE_I_AM, so verbatim
	// resends never drained the client's send window (BUFFS stuck at 1 -> the
	// targeting reticule stays gated). A fresh ack unblocks that in the same
	// packet, which is why both freeze symptoms cleared together at resolution.
	oldest := c.qlinkSentWindow[0]
	resent := qlinkRefreshRecvSeq(oldest.frame, c.qlinkInSeq)
	c.log.Debug().
		Uint8("recv_seq", frame.RecvSeq).
		Uint8("cmd", frame.Cmd).
		Uint8("resend_seq", oldest.seq).
		Uint8("fresh_ack", c.qlinkInSeq).
		Int("window", len(c.qlinkSentWindow)).
		Msg("QLink retransmit (go-back-1)")
	return [][]byte{resent}
}

// ErrQLinkPreamble indicates a failure during the Habilink JSON preamble
// (the username-discovery phase that precedes the QLink frame stream).
var ErrQLinkPreamble = errors.New("qlink: preamble failed")

// readHabilinkPreamble consumes text lines from r until one matches the
// {"name": "..."} pattern, then consumes one more line, then returns the
// captured username. Mirrors HabilinkProxy.run().
//
// All input is read through the same bufio.Reader so that any bytes the
// caller subsequently reads (the QLink frame stream) come from the correct
// position — the Java equivalent leaks data here because BufferedReader
// buffers past the line break.
func readHabilinkPreamble(r *bufio.Reader, sessionID string) (string, error) {
	var username string
	// Cap the preamble at a reasonable line count so a misbehaving client
	// can't consume unbounded memory before we abort.
	const maxPreambleLines = 64
	for i := 0; i < maxPreambleLines; i++ {
		// Read until CR or LF — the C64 KERNAL RS-232 sends CR (0x0D)
		// terminated lines, not LF (0x0A).
		line, err := readPreambleLine(r)
		if err != nil {
			if err == io.EOF && username == "" {
				return "", fmt.Errorf("%w: EOF before username found", ErrQLinkPreamble)
			}
			if err != io.EOF {
				// %w on the underlying error too, so callers can errors.As it
				// (e.g. runHabilink detects a read-deadline timeout this way).
				return "", fmt.Errorf("%w: read error: %w", ErrQLinkPreamble, err)
			}
		}
		log.Trace().Str("session_id", sessionID).Str("line", line).Msg("Habilink preamble line")
		if username != "" {
			// We saw the name on a previous line; one extra line completes
			// the handshake.
			return username, nil
		}
		if m := habilinkNameRegex.FindStringSubmatch(line); m != nil {
			username = m[1]
		}
	}
	if username != "" {
		// We found the name but ran out of lines before seeing the closing
		// frame; treat that as success rather than discarding the username.
		return username, nil
	}
	return "", fmt.Errorf("%w: no username in first %d lines", ErrQLinkPreamble, maxPreambleLines)
}

// readPreambleLine reads bytes until CR (0x0D) or LF (0x0A), returning the
// line without the terminator. Handles the C64 KERNAL RS-232 which sends
// CR-terminated lines, as well as modern clients that send LF.
func readPreambleLine(r *bufio.Reader) (string, error) {
	var line []byte
	for {
		b, err := r.ReadByte()
		if err != nil {
			return string(line), err
		}
		if b == '\r' || b == '\n' {
			// Skip a following LF after CR (CRLF) or CR after LF
			if next, err := r.Peek(1); err == nil {
				if (b == '\r' && next[0] == '\n') || (b == '\n' && next[0] == '\r') {
					r.ReadByte() // consume the pair
				}
			}
			return string(line), nil
		}
		line = append(line, b)
	}
}

// readQLinkFrame reads bytes from r up to and including the first FrameEnd
// (0x0D) byte, returns the frame body without the terminator. Returns
// io.EOF if the stream closes cleanly between frames.
func readQLinkFrame(r *bufio.Reader) ([]byte, error) {
	frame, err := r.ReadBytes(QLinkFrameEnd)
	if err != nil {
		return nil, err
	}
	// Strip the trailing FrameEnd byte.
	return frame[:len(frame)-1], nil
}

// runHabilink is the QLink-mode equivalent of ClientSession.Run. It performs
// the Habilink JSON preamble (to discover the username), then enters the
// QLink frame loop, dispatching Reset / Ping / Action frames to the
// appropriate handlers. HabitatAction frames extract their inner Habitat
// packet and feed it through the existing handleClientMessage path.
func (c *ClientSession) runHabilink() {
	defer c.wg.Done()

	c.log.Info().Msg("Habilink session connected.")

	// QLink/Habilink (C64) clients natively run the binary hatchery handshake, so
	// they're always hatchery-capable. hatcheryCapable is the single capability the
	// hatchery decision reads (ensureUserCreated) — no protocol test there.
	c.hatcheryCapable = true

	// Connect to Elko before reading anything from the client so the existing
	// handlers (which assume an active elkoConn) work without modification.
	if err := c.connectToElko(); err != nil {
		// Elko reachability is a hard invariant — see Bridge.Run.
		c.log.Fatal().Err(err).Str("elko_host", c.bridge.elkoHost).Msg("Unable to connect to Elko")
	}

	// Phase 1: Habilink JSON preamble — read text lines until we see the
	// {"name":"..."} field.
	//
	// CONNECT fallback for modems that don't emit their own. dial_modem() blocks
	// after ATDT waiting for a Hayes "CONNECT" result code. A proper modem emits it
	// (pipe_modem.py does; a correct Hayes modem should) and the client sends its
	// login immediately. The Ultimate 64's built-in modem, however, opens the TCP
	// transparently and never emits CONNECT — the client hangs at "Dialing" forever
	// (the same gap qlink's HabilinkListener papered over). Rather than always
	// injecting CONNECT — which prepends junk to a well-behaved client's stream —
	// send it ONLY as a fallback: read the preamble under a 2s deadline; if the
	// {"name":...} login doesn't arrive, the modem gave no CONNECT, so we supply one
	// and read again. Peeking for "any byte" is NOT enough — a transparent modem
	// forwards the client's dial chatter, which isn't the login.
	if conn := c.clientConn.conn; conn != nil {
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	}
	username, err := readHabilinkPreamble(c.clientReader, c.sessionID)
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		if conn := c.clientConn.conn; conn != nil {
			_ = conn.SetReadDeadline(time.Time{})
		}
		if _, werr := c.clientConn.WriteRaw([]byte("\r\rCONNECT\r")); werr != nil {
			c.log.Error().Err(werr).Msg("Habilink CONNECT fallback write failed")
			go c.Close()
			return
		}
		c.log.Debug().Msg("no login within 2s — sent CONNECT fallback (transparent modem)")
		username, err = readHabilinkPreamble(c.clientReader, c.sessionID)
	}
	if conn := c.clientConn.conn; conn != nil {
		_ = conn.SetReadDeadline(time.Time{})
	}
	if err != nil {
		c.log.Error().Err(err).Msg("Habilink preamble failed")
		go c.Close()
		return
	}
	c.log.Info().Str("username", username).Msg("Habilink username discovered")
	c.bindAvatar(username)

	// Stash the username on the session so the existing user-creation flow
	// (handleInitialClientMessage's ensureUserCreated path) finds the right
	// records. The empty packetPrefix is intentional: in QLink mode there is
	// no '<name>:' prefix on the wire, and the Descape skip in
	// handleClientMessage uses len(packetPrefix)+8, which becomes a clean
	// 8 — exactly the QLink header length.
	c.stateMu.Lock()
	c.packetPrefix = ""
	c.UserName = username
	if err := c.ensureUserCreated(username); err != nil {
		c.stateMu.Unlock()
		c.log.Error().Err(err).Msg("Could not ensure User created, bailing")
		go c.Close()
		return
	}
	// Deliberately leave c.connected == false so the first real Habitat
	// packet from the client trips the !c.connected short-circuit in
	// handleClientMessage and synchronously sends back the IM_ALIVE
	// "BAD DISK" reply. Pre-sending the reply here doesn't work: the C64
	// is still decompressing/initializing when runHabilink runs, so it
	// misses the reply and later sits in its Im_alive wait loop.
	c.stateMu.Unlock()

	// Habilink connections enter QLink with both sequences at SEQ_LOW. See
	// HabilinkListener.java:82-83.
	c.qlinkMu.Lock()
	c.qlinkInSeq = QLinkSeqLow
	c.qlinkOutSeq = QLinkSeqLow
	c.qlinkMu.Unlock()

	// Phase 2: QLink frame loop.
	c.qlinkFrameLoop()
}

// qlinkFrameLoop is the core read loop for QLink/Habilink sessions.
// Extracted so both runHabilink and StartRestored can call it.
func (c *ClientSession) qlinkFrameLoop() {
	c.log.Debug().Int("client_buffered", c.clientReader.Buffered()).Msg("qlinkFrameLoop: entering")
	for {
		select {
		case replyCh := <-c.snapshotReq:
			// Clear any read deadline set by SnapshotAllWithTCP.
			if tc, ok := c.clientConn.conn.(*net.TCPConn); ok {
				tc.SetReadDeadline(time.Time{})
			}
			snap := c.Snapshot()
			replyCh <- snap
			select {}
		default:
		}

		body, err := readQLinkFrame(c.clientReader)
		if err != nil {
			// A read deadline timeout from SnapshotAllWithTCP wakes us
			// up so we can check snapshotReq. Loop back to the select.
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			if err != io.EOF {
				c.log.Error().Err(err).Msg("Error reading QLink frame")
			}
			go c.Close()
			return
		}
		if len(body) == 0 {
			continue
		}
		if err := c.handleQLinkFrame(body); err != nil {
			c.log.Error().Err(err).Hex("body", body).Msg("Error handling QLink frame")
			continue
		}
	}
}

// handleQLinkFrame parses one QLink frame body (received without its
// FrameEnd byte) and dispatches to the appropriate handler. Mirrors the
// switch in QConnection.run().
func (c *ClientSession) handleQLinkFrame(body []byte) error {
	frame, err := DecodeQLinkFrame(body)
	var crcErr *QLinkCRCError
	if errors.As(err, &crcErr) {
		// C64 ground truth (mikes_protocol.m bad_pkt): NAK the corrupt
		// packet and discard it — never act on its contents. Feeding a
		// corrupt frame into qlinkProcessAck once freed retransmit-window
		// frames the client never received (its garbage RecvSeq "acked"
		// them), permanently truncating a split document mid-page; a
		// corrupt SendSeq likewise poisoned qlinkInSeq's piggyback acks.
		// The NAK prompts the client to resend whatever the noise ate
		// (got_NAK → all_NAKs resends its un-ACKed packets even when the
		// NAK looks out-of-sequence).
		if crcErr.IsHandshakeProbe() {
			// The deliberately malformed handshake probe WANTS this NAK
			// (with valid sequence numbers). Not a real line error.
			c.log.Debug().Msg("qlink: CRC handshake probe — sending NAK")
		} else {
			c.log.Warn().
				Uint8("cmd", frame.Cmd).
				Uint8("send_seq", frame.SendSeq).
				Uint8("recv_seq", frame.RecvSeq).
				Msgf("qlink: %s — frame dropped, NAK sent", crcErr)
		}
		return c.sendQLinkNak()
	}
	if err != nil {
		return err
	}
	// A valid frame re-arms the NAK debounce (the C64 does the same with
	// NAK_sent in done_ACK / got_HBEAT).
	c.qlinkMu.Lock()
	c.qlinkNakSent = false
	c.qlinkMu.Unlock()
	c.log.Trace().
		Uint8("cmd", frame.Cmd).
		Uint8("send_seq", frame.SendSeq).
		Uint8("recv_seq", frame.RecvSeq).
		Int("payload_len", len(frame.Payload)).
		Msg("QLink RX")

	// Reliable delivery: free frames the client has acked (via its piggybacked
	// RecvSeq) and resend any it's still missing. Done before the switch so it
	// covers every inbound frame type — Ping/Ack/SequenceError/NAK/Action.
	for _, f := range c.qlinkProcessAck(frame) {
		if err := c.writeQLinkFrameBytes(f); err != nil {
			c.log.Error().Err(err).Msg("QLink retransmit write failed")
			break
		}
	}

	switch frame.Cmd {
	case QLinkCmdReset:
		// Reset rewinds the per-session sequences and demands a ResetAck.
		c.qlinkMu.Lock()
		c.qlinkInSeq = QLinkSeqLow
		c.qlinkOutSeq = QLinkSeqLow
		c.qlinkMu.Unlock()
		return c.sendQLinkAckLikeFrame(QLinkCmdAck)

	case QLinkCmdPing:
		// QConnection.java responds to Ping with a ResetAck. Mirror that.
		return c.sendQLinkAckLikeFrame(QLinkCmdAck)

	case QLinkCmdAction:
		// Sequence bookkeeping: each Action increments the peer's send
		// sequence (which we read as inSeq). ACK it FIRST, before the
		// IsHabitatAction filter below — EVERY Action frame the C64 sends
		// must be acknowledged, even flow-control / non-Habitat mnemonics
		// (e.g. the handshake packet the client emits right after a region
		// change). If we skip the ack for an ignored action, the C64's
		// send window wedges on that un-acked frame and it can never send
		// another command.
		c.qlinkMu.Lock()
		c.qlinkInSeq = frame.SendSeq
		c.qlinkMu.Unlock()

		if !frame.IsHabitatAction() {
			mnemonic := string(frame.Payload[:minOf(2, len(frame.Payload))])
			// The C64 client sends an "SS" flow-control action inside
			// pick_from_container (actions.m:918 → send_SS_and_wait) to
			// synchronize with the host before showing the pocket picker
			// UI. It blocks in a busy-wait on got_ss_packet until the
			// host sends a matching "SS" packet back
			// (comm_control.m:477). If we don't reply, the pocket picker
			// never opens and the client locks up with a flashing GET
			// cursor.
			if mnemonic == "SS" {
				c.log.Debug().Msg("Received SS flow-control, sending SS ack")
				if err := c.sendHabitatFlowControl('S', 'S'); err != nil {
					c.log.Error().Err(err).Msg("Could not send SS ack")
				}
				return nil
			}
			c.log.Debug().Str("mnemonic", mnemonic).Msg("Ignoring non-Habitat QLink action")
			return nil
		}

		// Reconstruct the Habitat packet shape that handleClientMessage
		// expects: a buffer where len(packetPrefix)+8 bytes precede the
		// MICROCOSM_ID byte. The full QLink frame body already satisfies
		// this — bytes 0-7 are the QLink header and bytes 8+ are the
		// Habitat packet (because the action mnemonic 'U?' starts at
		// offset 8 with 'U' = 0x55 = MICROCOSM_ID_BYTE). So we hand the
		// raw frame body to handleClientMessage with packetPrefix == "".
		c.handleClientMessage(body)
		return nil

	case QLinkCmdAck, QLinkCmdSeqErr, QLinkCmdWFull:
		// Acks, sequence errors, and window-full notifications are
		// informational under the simplified flow-control model used here
		// (we serialize through Elko anyway).
		return nil

	case HabitatNAK:
		// The C64 client sends Habitat NAK (type 0x25) at the outer
		// packet level when it couldn't process our last transmission
		// — typically because the packet was too big for its receive
		// buffer. We don't actively retransmit here; instead we log a
		// warning so the underlying bug (e.g. oversized unsplit DESCRIBE)
		// is visible. Under normal conditions this should never fire.
		c.log.Warn().Msg("Client sent Habitat NAK — our last packet was rejected")
		return nil

	default:
		c.log.Warn().Uint8("cmd", frame.Cmd).Msg("Unknown QLink command")
		return nil
	}
}

// sendQLinkAckLikeFrame writes a header-only QLink frame (no payload). Used
// for ResetAck responses to Reset and Ping. Note that QConnection.write()
// only increments outSeq for Action frames, so we mirror that here.
func (c *ClientSession) sendQLinkAckLikeFrame(cmd byte) error {
	c.qlinkMu.Lock()
	frame := EncodeQLinkFrame(cmd, c.qlinkOutSeq, c.qlinkInSeq, nil)
	c.qlinkMu.Unlock()
	return c.writeQLinkFrameBytes(frame)
}

// sendQLinkNak sends a NAK (0x25) frame in response to a corrupt (bad-CRC)
// inbound frame, debounced by qlinkNakSent exactly like the C64's NAK_sent
// flag: one NAK per noise burst, re-armed when the next valid frame arrives.
// The client's got_NAK handler resends its un-ACKed packets on ANY NAK —
// even one whose sequence looks out-of-order ("do not bump sequence numbers
// if out of order", mikes_protocol.m) — so we deliberately do NOT consume an
// outSeq for it: NAKs aren't windowed for retransmission, and burning a
// sequence number on an unreliable control frame would open a seq gap the
// client could wedge on if the NAK itself were lost.
func (c *ClientSession) sendQLinkNak() error {
	c.qlinkMu.Lock()
	if c.qlinkNakSent {
		c.qlinkMu.Unlock()
		return nil
	}
	c.qlinkNakSent = true
	frame := EncodeQLinkFrame(HabitatNAK, c.qlinkOutSeq, c.qlinkInSeq, nil)
	c.qlinkMu.Unlock()
	return c.writeQLinkFrameBytes(frame)
}

// sendQLinkHabitatAction wraps a Habitat packet in a QLink Action frame and
// transmits it to the client. The Habitat packet is expected to already be
// shaped as `[0x55][seq][noid][reqno][...]` — its first byte doubles as the
// 'U' of the action mnemonic, so we just place the packet at offset 8 of
// the QLink frame.
//
// Called from handleClientMessage (which already holds c.stateMu) and
// from every SendBuf/sendToClient path. The qlink*Seq fields are guarded
// by c.qlinkMu — a dedicated mutex, NOT stateMu — precisely so that
// sending a QLink action under stateMu doesn't self-deadlock.
func (c *ClientSession) sendQLinkHabitatAction(habitatPkt []byte) error {
	// Habitat-escape the payload before wrapping. Inside the QLink frame,
	// any 0x0D byte would prematurely terminate the frame, so escape per
	// the same rules the legacy bridge uses (Escape() handles 0x0D and
	// 0x5D via XOR-with-0x55).
	escaped := Escape(habitatPkt)

	// Action frames increment the sender's outSeq. We piggyback the latest
	// inSeq as the ack.
	c.qlinkMu.Lock()
	c.qlinkOutSeq = QLinkIncSeq(c.qlinkOutSeq)
	frame := EncodeQLinkFrame(QLinkCmdAction, c.qlinkOutSeq, c.qlinkInSeq, escaped)
	c.qlinkRecordSentLocked(c.qlinkOutSeq, frame) // buffer for retransmission
	c.qlinkMu.Unlock()
	return c.writeQLinkFrameBytes(frame)
}

// sendSplitHabitatAction mirrors the legacy split-packet sender
// (sendToClient's split branch) but wraps each chunk in its own QLink
// Action frame. A complex region's DESCRIBE can run 400+ bytes, which
// overflows the C64's receive buffer; without this split path the
// client NAKs (cmd 0x25) and region transfer hangs.
//
// The Habitat packet is `[U, seqByte, noid, reqNum, payload...]`. We
// keep the 4-byte header per chunk and slice payload into
// MAX_PACKET_SIZE pieces, tagging seqByte with SPLIT_START on the
// first chunk and SPLIT_END on the last (SPLIT_MIDDLE is always set
// for split packets).
func (c *ClientSession) sendSplitHabitatAction(data []byte) error {
	if len(data) < 4 {
		return c.sendQLinkHabitatAction(data)
	}
	header := make([]byte, 4)
	copy(header, data[:4])
	payload := data[4:]
	baseSeqByte := header[1] & SPLIT_MASK
	for start := 0; start < len(payload); start += MAX_PACKET_SIZE {
		size := len(payload) - start
		if size > MAX_PACKET_SIZE {
			size = MAX_PACKET_SIZE
		}
		chunkHeader := make([]byte, 4)
		copy(chunkHeader, header)
		seqByte := baseSeqByte | SPLIT_MIDDLE
		if start == 0 {
			seqByte |= SPLIT_START
		}
		if start+size >= len(payload) {
			seqByte |= SPLIT_END
		}
		chunkHeader[1] = seqByte
		pkt := make([]byte, 0, 4+size)
		pkt = append(pkt, chunkHeader...)
		pkt = append(pkt, payload[start:start+size]...)
		if err := c.sendQLinkHabitatAction(pkt); err != nil {
			return err
		}
		// Pace chunks so the busy-rendering C64 isn't fed a continuous
		// 9600-baud firehose it can't keep up with. No delay after the last
		// chunk. (Safe to sleep here: no mutex is held between chunks.)
		if start+size < len(payload) {
			time.Sleep(qlinkChunkPacing)
		}
	}
	return nil
}

// sendHabitatFlowControl sends a Habitat flow-control packet to the client
// — an Action-framed packet whose first two payload bytes form a QLink-style
// mnemonic that the client's handle_qlink_message path recognizes. Used
// specifically for replying to the "SS" synchronization packet that
// pick_from_container emits before popping the pocket picker.
//
// Wire layout relative to the QLink frame:
//
//	offset 0..7: QLink header
//	offset 8..9: [m0][m1]   ← the 2-char mnemonic, NOT 'U?'
//	offset 10 : 0x0D        ← FrameEnd (emitted by writeQLinkFrameBytes)
//
// The C64 client reads the incoming bytes into RSINBF starting after
// SYNC; offset 8 of the QLink frame lands at RSINBF[7] (HDRPFX[0]) and
// offset 9 lands at RSINBF[8] (HDRPFX[1]) from the client's point of
// view, so the mnemonic comparison in comm_control.m:422-434 matches
// and display_qlink_message then sets got_ss_packet.
func (c *ClientSession) sendHabitatFlowControl(m0, m1 byte) error {
	payload := []byte{m0, m1}
	c.qlinkMu.Lock()
	c.qlinkOutSeq = QLinkIncSeq(c.qlinkOutSeq)
	frame := EncodeQLinkFrame(QLinkCmdAction, c.qlinkOutSeq, c.qlinkInSeq, payload)
	c.qlinkRecordSentLocked(c.qlinkOutSeq, frame) // buffer for retransmission
	c.qlinkMu.Unlock()
	return c.writeQLinkFrameBytes(frame)
}

// writeQLinkFrameBytes appends the FrameEnd terminator and writes the frame
// straight to the client connection, bypassing the Habitat-level escape
// that ClientConnection.Write applies (the QLink frame is its own escape
// envelope).
func (c *ClientSession) writeQLinkFrameBytes(frame []byte) error {
	out := make([]byte, 0, len(frame)+1)
	out = append(out, frame...)
	out = append(out, QLinkFrameEnd)
	if c.log.Trace().Enabled() {
		c.log.Trace().Int("bytes", len(out)).Hex("frame", out).Msg("QLink TX")
	}
	_, err := c.clientConn.WriteRaw(out)
	return err
}

func minOf(a, b int) int {
	if a < b {
		return a
	}
	return b
}
