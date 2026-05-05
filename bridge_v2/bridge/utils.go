package bridge

import (
	"encoding/json"
	"fmt"
	"github.com/rs/zerolog/log"
)

// rewriteJsonField parses a JSON object line, replaces (or sets) one
// top-level field, and returns a re-marshalled line. Field order is
// not preserved — Elko parses by name, not position, so order doesn't
// matter for the bridge's forwarding use case.
//
// Used by JSON-passthrough mode to canonicalize entercontext.user
// before forwarding to Elko: the bot may submit "user-SageBot" but
// the mongo doc lives under "user-sagebot" (ensureUserCreated
// lowercases). Forwarding the original case makes Elko's user lookup
// fail and it then EOFs the connection.
func rewriteJsonField(line []byte, field, value string) ([]byte, error) {
	var m map[string]interface{}
	if err := json.Unmarshal(line, &m); err != nil {
		return nil, err
	}
	m[field] = value
	return json.Marshal(m)
}

type Uint8Slice []uint8

func (u Uint8Slice) Len() int {
	return len(u)
}

func (u Uint8Slice) Less(i, j int) bool {
	return u[i] < u[j]
}

func (u Uint8Slice) Swap(i, j int) {
	u[i], u[j] = u[j], u[i]
}

func Escape(descaped []byte) []byte {
	escaped := make([]byte, 0)
	for _, curByte := range descaped {
		if curByte == END_OF_MESSAGE || curByte == ESCAPE_CHAR {
			escaped = append(escaped, ESCAPE_CHAR)
			curByte ^= ESCAPE_XOR
		}
		escaped = append(escaped, curByte)
	}
	return escaped
}

func Descape(escaped []byte, skip int) []byte {
	descaped := make([]byte, 0)
	for i := skip; i < len(escaped); i++ {
		curByte := escaped[i]
		if curByte == ESCAPE_CHAR {
			// Advance to the escaped byte and XOR IT, not the
			// escape marker. The previous version did i++ followed
			// by `curByte ^= ESCAPE_XOR`, which XORed the 0x5D
			// marker itself (giving 0x08) and silently swallowed
			// the real payload byte. That converts any escaped
			// 0x0D on the wire into 0x08 instead of 0x0D —
			// which, for a PUT's containerNoid byte, turns
			// "avatar noid 13" into "tokens noid 8" and sends the
			// item into nowhere.
			i++
			if i >= len(escaped) {
				break
			}
			curByte = escaped[i] ^ ESCAPE_XOR
		}
		descaped = append(descaped, curByte)
	}
	return descaped
}

func DescapeQLinkMsg(escaped []byte) []byte {
	descaped := make([]byte, 0)
	for i := 0; i < len(escaped); i++ {
		curByte := escaped[i]
		if curByte == QLINK_ESCAPE_CHAR {
			descaped = append(descaped, escaped[i+1])
			i++
			continue
		}
		descaped = append(descaped, curByte)
	}
	return descaped
}

func MinInt(x, y int) int {
	if x < y {
		return x
	}
	return y
}

func MaxInt(x, y int) int {
	if x > y {
		return x
	}
	return y
}

func FormatStringUint8Map(container map[string][]uint8) string {
	if len(container) == 0 {
		return "{}"
	}
	formatted := "{"
	for key, bytes := range container {
		formatted += fmt.Sprintf(`"%s": %d,`, key, bytes)
	}
	return formatted[0:len(formatted)-1] + "}"
}

func FormatUint8Uint8Map(container map[uint8][]uint8) string {
	if len(container) == 0 {
		return "{}"
	}
	formatted := "{"
	for key, bytes := range container {
		formatted += fmt.Sprintf(`"%d": %d,`, key, bytes)
	}
	return formatted[0:len(formatted)-1] + "}"
}

func MakeHabitatPacketHeader(
	start bool,
	end bool,
	seq uint8,
	noidAndReqnum ...uint8,
) []byte {
	header := make([]byte, 2)
	header[0] = MICROCOSM_ID_BYTE
	header[1] = seq
	if end {
		header[1] |= 0x80
	}
	header[1] |= 0x40
	if start {
		header[1] |= 0x20
	}
	if len(noidAndReqnum) > 0 {
		header = append(header, noidAndReqnum[0])
	}
	if len(noidAndReqnum) > 1 {
		header = append(header, noidAndReqnum[1])
	}
	if log.Trace().Enabled() {
		log.Trace().Msgf("Made header start: %t end: %t seq: %d noidAndReqnum: %d - %d",
			start, end, seq, noidAndReqnum, header)
	}
	return header
}

// u8or returns *p, or def if p is nil. Mirrors the JS `state.field || def`
// pattern from the original Habitat2ElkoBridge for missing fields.
func u8or(p *uint8, def uint8) uint8 {
	if p == nil {
		return def
	}
	return *p
}

// i32sor returns *p, or def if p is nil. For slice fields like Picture/Pattern/
// ASCII/Custom that the original JS bridge guards with `state.field || []`.
func i32sor(p *[]int32, def []int32) []int32 {
	if p == nil {
		return def
	}
	return *p
}

func BoolP(b bool) *bool {
	return &b
}

func Int32SP(s []int32) *[]int32 {
	return &s
}

func Uint8P(i uint8) *uint8 {
	return &i
}

func Uint16P(i uint16) *uint16 {
	return &i
}

func Uint32P(i uint32) *uint32 {
	return &i
}

func Int32P(i int32) *int32 {
	return &i
}

func StringP(s string) *string {
	return &s
}

// ── nil-safe deref helpers ──────────────────────────────────────────
//
// Translator ToClient bodies historically dereferenced fields on the
// inbound ElkoMessage directly (e.g. `b.AddInt(*o.Err)`). When the
// server omitted the field — Elko skips fields it didn't set — the
// deref panicked, and a panic in elkoReader takes down the whole
// bridge process (one client's bad reply drops every connected
// client). These helpers default to a sane wire value (0 / "") so a
// missing field becomes "first slot" / "no error" rather than SIGSEGV.

func u8(p *uint8) uint8 {
	if p == nil {
		return 0
	}
	return *p
}

func u8d(p *uint8, def uint8) uint8 {
	if p == nil {
		return def
	}
	return *p
}

func u32(p *uint32) uint32 {
	if p == nil {
		return 0
	}
	return *p
}

func i32slice(p *[]int32) []int32 {
	if p == nil {
		return nil
	}
	return *p
}

func u8slice(p *[]uint8) []uint8 {
	if p == nil {
		return nil
	}
	return *p
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
