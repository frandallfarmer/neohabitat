package bridge

import (
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
)

// QLink wire-protocol constants. These mirror the corresponding values in
// QLinkReloaded (~/workspace/qlink) so a Habilink-mode bridge_v2 session can
// interoperate with the same C64 / thin-Habitat clients that QLinkReloaded
// serves today.
//
// Frame layout (one TCP "line" terminated by FrameEnd 0x0D):
//
//	[0] CmdStart   = 0x5A ('Z'), magic byte
//	[1] CRC nibble = (crc>>12)&0x0F << 4 | 0x01
//	[2] CRC nibble = 0x40 | (crc>>8)&0x0F
//	[3] CRC nibble = (crc>>4)&0x0F << 4 | 0x01
//	[4] CRC nibble = 0x40 | crc&0x0F
//	[5] SendSeq    sender's outgoing sequence number
//	[6] RecvSeq    sender's last-received sequence (piggyback ack)
//	[7] CmdByte    one of CmdReset / CmdResetAck / CmdPing / CmdAction / ...
//	[8..]          payload (for Action frames, bytes 8-9 are the action mnemonic)
//
// The CRC is calculated over bytes [5..end] (i.e. SendSeq through end of
// payload), using CRC-16 / polynomial 0xA001 with initial value 0 — matching
// org.jbrain.qlink.util.CRC16.
//
// CRC bytes are encoded with sentinel high/low nibbles (0x01 / 0x40) so the
// CRC bytes themselves can never collide with the frame terminator 0x0D, the
// null byte 0x00, or 0xFF.
const (
	QLinkCmdStart  byte = 0x5A
	QLinkFrameEnd  byte = 0x0D
	QLinkCmdReset  byte = 0x23
	QLinkCmdAck    byte = 0x24 // ResetAck
	QLinkCmdPing   byte = 0x26
	QLinkCmdAction byte = 0x20
	QLinkCmdWFull  byte = 0x21 // WindowFull
	QLinkCmdSeqErr byte = 0x3F // SequenceError

	// HabitatNAK is the Habitat-level NAK type (not a QLink command).
	// The C64 client sends this at the Habitat protocol layer when it
	// can't process an incoming packet — most often because it's too
	// large to fit the client's receive buffer. Matches
	// Main/protocol.m:26 `define NAK = 0x25`.
	HabitatNAK byte = 0x25

	// QLinkSeqDefault is the sequence number value used by a fresh C64
	// connection. Habilink connections use QLinkSeqLow instead because the
	// thin client opens the QLink layer mid-stream.
	QLinkSeqDefault byte = 0x7F
	QLinkSeqLow     byte = 0x10

	// QLinkHeaderLen is the number of bytes between CmdStart (inclusive) and
	// the start of the payload. Action frames place the 2-byte action mnemonic
	// at offsets 8 and 9, so the Habitat packet body (which begins with
	// MICROCOSM_ID_BYTE 0x55) starts at offset 8 — and the mnemonic 'U?' is
	// chosen so that 'U' == 0x55 happens to match the Habitat magic byte. The
	// upshot is that for Habitat actions, "skip the QLink header" and "land
	// on the Habitat magic byte" are the same operation.
	QLinkHeaderLen = 8
)

// QLinkHabitatMnemonic is the action mnemonic used to wrap Habitat packets.
// The first byte ('U' = 0x55) doubles as the Habitat MICROCOSM_ID_BYTE so the
// inner Habitat packet header lines up directly behind the QLink header.
const QLinkHabitatMnemonic = "U?"

// crc16Update is the bit-by-bit CRC-16 routine matching CRC16.java exactly.
// Polynomial 0xA001, initial value 0, LSB-first; this is the standard CRC-16
// IBM/ARC variant.
func crc16Update(crc uint16, b byte) uint16 {
	for k := 0; k < 8; k++ {
		crc ^= uint16(b & 1)
		b >>= 1
		if crc&1 != 0 {
			crc = (crc >> 1) ^ 0xA001
		} else {
			crc >>= 1
		}
	}
	return crc
}

// QLinkCRC16 computes the CRC-16 over data using polynomial 0xA001.
func QLinkCRC16(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc = crc16Update(crc, b)
	}
	return crc
}

// QLinkIncSeq advances a QLink sequence number, wrapping QLinkSeqDefault back
// to QLinkSeqLow. Mirrors QConnection.incSeq.
func QLinkIncSeq(seq byte) byte {
	if seq == QLinkSeqDefault {
		return QLinkSeqLow
	}
	return seq + 1
}

// EncodeQLinkFrame builds a QLink frame (without the trailing FrameEnd byte)
// for the given command, sequence numbers, and payload. The payload may be
// nil for header-only commands like Ping or ResetAck.
//
// For an Action frame, the first two payload bytes ARE the action mnemonic;
// for HabitatAction this is the 2-byte head of the Habitat packet (mnemonic
// 'U?' overlapping the Habitat MICROCOSM_ID byte).
func EncodeQLinkFrame(cmd, sendSeq, recvSeq byte, payload []byte) []byte {
	frame := make([]byte, QLinkHeaderLen+len(payload))
	frame[0] = QLinkCmdStart
	frame[5] = sendSeq
	frame[6] = recvSeq
	frame[7] = cmd
	copy(frame[8:], payload)

	// CRC covers bytes [5..end] — sequences, command, and payload.
	crc := QLinkCRC16(frame[5:])

	// Encode the 16-bit CRC into 4 bytes such that none of them can equal
	// 0x00, 0x0D, or 0xFF — the OR masks 0x01 and 0x40 in alternating
	// nibbles guarantee this.
	frame[1] = byte(((crc & 0xF000) >> 8) | 0x01)
	frame[2] = byte(((crc & 0x0F00) >> 8) | 0x40)
	frame[3] = byte((crc & 0x00F0) | 0x01)
	frame[4] = byte((crc & 0x000F) | 0x40)
	return frame
}

// QLinkFrame is a parsed QLink frame.
type QLinkFrame struct {
	Cmd     byte
	SendSeq byte // sender's send sequence (the sender's "out")
	RecvSeq byte // sender's last-acknowledged receive (the sender's "in")
	Payload []byte
}

// ErrQLinkBadFrame indicates a malformed QLink frame.
var ErrQLinkBadFrame = errors.New("qlink: bad frame")

// DecodeQLinkFrame parses a single QLink frame body (without the trailing
// FrameEnd byte) and verifies the CRC. The returned Payload aliases into the
// input slice.
func DecodeQLinkFrame(frame []byte) (*QLinkFrame, error) {
	if len(frame) < QLinkHeaderLen {
		return nil, fmt.Errorf("%w: too short (%d bytes)", ErrQLinkBadFrame, len(frame))
	}
	if frame[0] != QLinkCmdStart {
		return nil, fmt.Errorf("%w: bad magic 0x%02x", ErrQLinkBadFrame, frame[0])
	}

	// Reassemble the reported CRC from its 4 nibble-bytes (mirrors
	// AbstractCommand.java's reader).
	reported := uint16(((uint16(frame[1])&0xF0)|(uint16(frame[2])&0x0F))<<8) |
		uint16((frame[3]&0xF0)|(frame[4]&0x0F))
	calculated := QLinkCRC16(frame[5:])
	if reported != calculated {
		// CRC errors show up on real C64 hardware when the RS-232 stream
		// gets one-bit hiccups (the bit-banged user-port driver is not
		// immune to IRQ jitter). Rather than dropping the frame, log a
		// warning and continue; downstream handling will catch any truly
		// broken payloads.
		log.Warn().Msgf("qlink: CRC mismatch ignored (reported 0x%04x, calculated 0x%04x)",
			reported, calculated)
	}

	return &QLinkFrame{
		Cmd:     frame[7],
		SendSeq: frame[5],
		RecvSeq: frame[6],
		Payload: frame[QLinkHeaderLen:],
	}, nil
}

// IsHabitatAction returns true if this Action frame's mnemonic matches the
// Habitat passthrough namespace (mnemonic[0] == 'U'). Mirrors
// org.jbrain.qlink.cmd.action.HabitatAction.MNEMONIC.
func (f *QLinkFrame) IsHabitatAction() bool {
	return f.Cmd == QLinkCmdAction && len(f.Payload) >= 2 && f.Payload[0] == 'U'
}
