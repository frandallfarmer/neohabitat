package bridge

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"regexp"

	"github.com/rs/zerolog/log"
)

// habilinkNameRegex matches the {"name": "..."} field that the modern thin
// Habitat client sends as part of its handshake before switching the socket
// over to the QLink wire protocol. Mirrors HabilinkProxy.USERNAME_REGEX.
var habilinkNameRegex = regexp.MustCompile(`"name":\s*"([^"]*)"`)

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
				return "", fmt.Errorf("%w: read error: %v", ErrQLinkPreamble, err)
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

	// Connect to Elko before reading anything from the client so the existing
	// handlers (which assume an active elkoConn) work without modification.
	if err := c.connectToElko(); err != nil {
		// Elko reachability is a hard invariant — see Bridge.Run.
		c.log.Fatal().Err(err).Str("elko_host", c.bridge.elkoHost).Msg("Unable to connect to Elko")
	}

	// Phase 1: Habilink JSON preamble — read text lines until we see the
	// {"name":"..."} field.
	username, err := readHabilinkPreamble(c.clientReader, c.sessionID)
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
			snap := c.Snapshot(-1, -1)
			replyCh <- snap
			select {}
		default:
		}

		body, err := readQLinkFrame(c.clientReader)
		if err != nil {
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
	if err != nil {
		return err
	}
	c.log.Trace().
		Uint8("cmd", frame.Cmd).
		Uint8("send_seq", frame.SendSeq).
		Uint8("recv_seq", frame.RecvSeq).
		Int("payload_len", len(frame.Payload)).
		Msg("QLink RX")

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
		// Sequence bookkeeping: each Action increments the peer's send
		// sequence (which we read as inSeq).
		c.qlinkMu.Lock()
		c.qlinkInSeq = frame.SendSeq
		c.qlinkMu.Unlock()

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
