package bridge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// recordingConn implements net.Conn by recording Writes into a byte buffer
// and feeding Reads from a supplied byte slice. Used to observe what the
// bridge writes to Elko (and to feed scripted client input) without doing
// real TCP I/O.
type recordingConn struct {
	mu       sync.Mutex
	writes   bytes.Buffer
	readBuf  *bytes.Buffer
	closed   bool
	closeErr error
}

func newRecordingConn(readData []byte) *recordingConn {
	return &recordingConn{readBuf: bytes.NewBuffer(readData)}
}

func (r *recordingConn) Read(b []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return 0, io.EOF
	}
	if r.readBuf.Len() == 0 {
		return 0, io.EOF
	}
	return r.readBuf.Read(b)
}

func (r *recordingConn) Write(b []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return 0, io.ErrClosedPipe
	}
	return r.writes.Write(b)
}

func (r *recordingConn) Close() error                       { r.mu.Lock(); r.closed = true; r.mu.Unlock(); return r.closeErr }
func (r *recordingConn) LocalAddr() net.Addr                { return &net.IPAddr{} }
func (r *recordingConn) RemoteAddr() net.Addr               { return &net.IPAddr{} }
func (r *recordingConn) SetDeadline(t time.Time) error      { return nil }
func (r *recordingConn) SetReadDeadline(t time.Time) error  { return nil }
func (r *recordingConn) SetWriteDeadline(t time.Time) error { return nil }

func (r *recordingConn) Written() []byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]byte, r.writes.Len())
	copy(out, r.writes.Bytes())
	return out
}

// newJsonTestSession creates a session wired up for JSON passthrough unit
// tests: jsonPassthrough flag set, client conn and elko conn both
// recording, no real TCP involvement.
func newJsonTestSession(t *testing.T, clientIn []byte) (*ClientSession, *recordingConn, *recordingConn) {
	t.Helper()
	bridge := &Bridge{DataRate: 1 << 20}
	clientRC := newRecordingConn(clientIn)
	elkoRC := newRecordingConn(nil)
	cc := NewClientConnection(bridge, clientRC)
	sess := &ClientSession{
		NoidClassList:   []uint8{},
		NoidContents:    make(map[uint8][]uint8),
		RefToNoid:       make(map[string]uint8),
		bridge:          bridge,
		clientConn:      cc,
		clientReader:    bufio.NewReader(cc),
		ctx:             context.Background(),
		elkoConn:        elkoRC,
		elkoDone:        make(chan struct{}),
		elkoSendChan:    make(chan *outboundElkoMessage, MaxClientMessages),
		firstConnection: true,
		jsonPassthrough: true,
		objects:         make(map[uint8]*ElkoMessage),
		done:            make(chan struct{}),
	}
	sess.contentsVector = NewContentsVector(sess, nil, &REGION_NOID, nil, nil)
	sess.wg.Add(1)
	sess.elkoWg.Add(1)
	sess.elkoConnInitWg.Add(1)
	go sess.elkoWriter()
	sess.elkoConnInitWg.Wait()
	t.Cleanup(func() {
		sess.closeChannels()
		sess.elkoWg.Wait()
	})
	return sess, clientRC, elkoRC
}

// ---------- Detection helpers ----------

func TestIsHabilinkLoginPreamble_MatchesLoginOp(t *testing.T) {
	cases := []struct {
		name string
		in   []byte
		want bool
	}{
		{"habilink login", []byte(`{"to":"bridge","op":"LOGIN","name":"steve"}`), true},
		{"habilink login with spaces", []byte(`{"op": "LOGIN", "name":"steve"}`), true},
		{"login across two lines doesn't count", []byte("{\n\"op\":\"LOGIN\"}"), false},
		{"plain entercontext", []byte(`{"to":"session","op":"entercontext","user":"user-steve"}`), false},
		{"some other op", []byte(`{"op":"WALK","to":"user-foo"}`), false},
		{"empty", []byte(``), false},
		{"not JSON at all", []byte(`steve:hello`), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := isHabilinkLoginPreamble(c.in)
			if got != c.want {
				t.Errorf("isHabilinkLoginPreamble(%q) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

func TestContainsSubslice(t *testing.T) {
	cases := []struct {
		hay, needle string
		want        bool
	}{
		{"", "", true},
		{"abc", "", true},
		{"", "x", false},
		{"abcdef", "cde", true},
		{"abcdef", "cdex", false},
		{"abc", "abcd", false},
		{"abc", "abc", true},
		{"abcabc", "abc", true},
	}
	for _, c := range cases {
		got := containsSubslice([]byte(c.hay), []byte(c.needle))
		if got != c.want {
			t.Errorf("containsSubslice(%q, %q) = %v, want %v", c.hay, c.needle, got, c.want)
		}
	}
}

// ---------- rewriteJsonField ----------

// rewriteJsonField is the helper used to canonicalize entercontext.user
// before forwarding to Elko. Verify it (a) sets the field, (b) returns
// valid JSON for Elko's parser, (c) leaves other fields intact, and
// (d) errors on garbage input rather than silently mangling it.
func TestRewriteJsonField(t *testing.T) {
	in := []byte(`{"op":"entercontext","to":"session","context":"context-Downtown_5f","user":"user-SageBot"}`)
	out, err := rewriteJsonField(in, "user", "user-sagebot")
	if err != nil {
		t.Fatalf("rewriteJsonField: %v", err)
	}
	var got map[string]interface{}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("output not valid JSON: %v: %q", err, out)
	}
	if got["user"] != "user-sagebot" {
		t.Errorf("user = %v, want user-sagebot", got["user"])
	}
	if got["op"] != "entercontext" || got["context"] != "context-Downtown_5f" || got["to"] != "session" {
		t.Errorf("other fields lost: %v", got)
	}
	if _, err := rewriteJsonField([]byte(`not json`), "user", "x"); err == nil {
		t.Error("expected error on garbage input, got nil")
	}
}

// ---------- sendOpToElko ----------

// sendOpToElko should produce a JSON payload with exactly to+op fields
// and the two-byte \n\n frame terminator.
func TestSendOpToElko_Shape(t *testing.T) {
	sess, _, elko := newJsonTestSession(t, nil)
	if err := sess.sendOpToElko("context-Downtown_5f", "I_AM_HERE"); err != nil {
		t.Fatalf("sendOpToElko: %v", err)
	}
	got := elko.Written()
	if !bytes.HasSuffix(got, ElkoMsgTerminator) {
		t.Errorf("missing frame terminator, got = %q", got)
	}
	payload := bytes.TrimSuffix(got, ElkoMsgTerminator)
	var parsed map[string]interface{}
	if err := json.Unmarshal(payload, &parsed); err != nil {
		t.Fatalf("payload not valid JSON: %q: %v", payload, err)
	}
	if parsed["op"] != "I_AM_HERE" {
		t.Errorf("op = %v, want I_AM_HERE", parsed["op"])
	}
	if parsed["to"] != "context-Downtown_5f" {
		t.Errorf("to = %v, want context-Downtown_5f", parsed["to"])
	}
}

func TestSendHatcheryStateToHabiproxyShape(t *testing.T) {
	sess, _, elko := newJsonTestSession(t, nil)
	sess.UserName = "Alice"
	sess.userRef = "user-alice"
	sess.sessionID = "session-42"

	if err := sess.sendHatcheryStateToHabiproxy("started"); err != nil {
		t.Fatalf("sendHatcheryStateToHabiproxy: %v", err)
	}

	got := elko.Written()
	if !bytes.HasSuffix(got, ElkoMsgTerminator) {
		t.Errorf("missing frame terminator, got = %q", got)
	}
	payload := bytes.TrimSuffix(got, ElkoMsgTerminator)
	var parsed map[string]interface{}
	if err := json.Unmarshal(payload, &parsed); err != nil {
		t.Fatalf("payload not valid JSON: %q: %v", payload, err)
	}
	if parsed["to"] != "habiproxy" {
		t.Errorf("to = %v, want habiproxy", parsed["to"])
	}
	if parsed["op"] != "HATCHERY_STATE" {
		t.Errorf("op = %v, want HATCHERY_STATE", parsed["op"])
	}
	if parsed["state"] != "started" {
		t.Errorf("state = %v, want started", parsed["state"])
	}
	if parsed["avatar"] != "Alice" || parsed["user"] != "user-alice" || parsed["session"] != "session-42" {
		t.Errorf("identity fields = %v", parsed)
	}
}

// ---------- handleElkoMessageJson state machine ----------

// "make" with you:true marks the session as awaiting avatar contents and
// remembers the region ref for later handshake synthesis.
func TestHandleElkoMessageJson_MakeYouSetsWaiting(t *testing.T) {
	sess, client, _ := newJsonTestSession(t, nil)
	raw := []byte(`{"op":"make","to":"context-Downtown_5f","you":true,"obj":{}}`)
	msg := parseElko(t, raw)
	sess.handleElkoMessageJson(raw, msg)

	if !sess.waitingForAvatarContents {
		t.Error("waitingForAvatarContents should be true after make+you")
	}
	if sess.regionRef != "context-Downtown_5f" {
		t.Errorf("regionRef = %q, want context-Downtown_5f", sess.regionRef)
	}
	// The make message should still be relayed to the client.
	if !bytes.Contains(client.Written(), raw) {
		t.Errorf("make not relayed to client; client got %q", client.Written())
	}
}

// A lone "ready" without a prior make+you should just be relayed to the
// client, no handshake synthesis.
func TestHandleElkoMessageJson_ReadyWithoutWaitingRelays(t *testing.T) {
	sess, client, elko := newJsonTestSession(t, nil)
	raw := []byte(`{"op":"ready","to":"context-Downtown_5f"}`)
	msg := parseElko(t, raw)
	sess.handleElkoMessageJson(raw, msg)

	// Should relay to client, nothing to Elko.
	if !bytes.Contains(client.Written(), raw) {
		t.Errorf("ready not relayed to client; got %q", client.Written())
	}
	if len(elko.Written()) != 0 {
		t.Errorf("nothing should have been sent to Elko, got %q", elko.Written())
	}
}

// "ready" while waiting for avatar contents should synthesize
// FINGER_IN_QUE + I_AM_HERE toward Elko and NOT relay the ready to the
// client. Flag should clear.
func TestHandleElkoMessageJson_ReadyWhileWaitingSynthesizes(t *testing.T) {
	sess, client, elko := newJsonTestSession(t, nil)
	sess.waitingForAvatarContents = true
	// Mirror what the prior `make you:true` would have set: regionRef
	// is the context, while the `ready` message's `to` is the user-ref.
	// FINGER_IN_QUE / I_AM_HERE must address the region, not the user.
	sess.regionRef = "context-Downtown_5f"
	raw := []byte(`{"op":"ready","to":"user-elizabot-12345"}`)
	msg := parseElko(t, raw)
	sess.handleElkoMessageJson(raw, msg)

	if sess.waitingForAvatarContents {
		t.Error("waitingForAvatarContents should have been cleared")
	}
	// Client must NOT have received the ready.
	if bytes.Contains(client.Written(), []byte(`"op":"ready"`)) {
		t.Errorf("ready should NOT be relayed to client, got %q", client.Written())
	}
	// Elko must have received both FINGER_IN_QUE and I_AM_HERE.
	sent := elko.Written()
	if !bytes.Contains(sent, []byte(`"op":"FINGER_IN_QUE"`)) {
		t.Errorf("missing FINGER_IN_QUE, got %q", sent)
	}
	if !bytes.Contains(sent, []byte(`"op":"I_AM_HERE"`)) {
		t.Errorf("missing I_AM_HERE, got %q", sent)
	}
	// Both should address the current region.
	if !bytes.Contains(sent, []byte(`"to":"context-Downtown_5f"`)) {
		t.Errorf("synthesized messages not addressed to region, got %q", sent)
	}
	// Both should be framed by \n\n.
	frames := bytes.Split(sent, ElkoMsgTerminator)
	// Last split yields an empty trailing slice.
	nonEmpty := 0
	for _, f := range frames {
		if len(f) > 0 {
			nonEmpty++
		}
	}
	if nonEmpty != 2 {
		t.Errorf("expected 2 framed messages to Elko, got %d (split = %v)", nonEmpty, frames)
	}
}

// An unrelated Elko op should pass through to the client verbatim. This
// is the common case — most of Elko's traffic is relayed as-is.
func TestHandleElkoMessageJson_UnrelatedOpRelays(t *testing.T) {
	sess, client, elko := newJsonTestSession(t, nil)
	// Some arbitrary broadcast the bridge shouldn't inspect.
	raw := []byte(`{"type":"broadcast","noid":5,"op":"SPEAK$","text":"hi"}`)
	msg := parseElko(t, raw)
	sess.handleElkoMessageJson(raw, msg)

	if !bytes.Contains(client.Written(), raw) {
		t.Errorf("message not relayed verbatim; client got %q", client.Written())
	}
	// Must be followed by a \n\n delimiter for the JSON client to frame.
	if !bytes.Contains(client.Written(), append(raw, '\n', '\n')) {
		t.Errorf("delimiter not appended; client got %q", client.Written())
	}
	if len(elko.Written()) != 0 {
		t.Errorf("nothing should have been sent to Elko, got %q", elko.Written())
	}
}

// A broadcast received after a prior make+you (but before "ready") should
// still relay to the client AND preserve the waiting flag so the next
// "ready" can still synthesize the handshake.
func TestHandleElkoMessageJson_BroadcastPreservesWaiting(t *testing.T) {
	sess, _, _ := newJsonTestSession(t, nil)
	sess.waitingForAvatarContents = true
	raw := []byte(`{"type":"broadcast","noid":5,"op":"SPEAK$","text":"hi"}`)
	msg := parseElko(t, raw)
	sess.handleElkoMessageJson(raw, msg)

	if !sess.waitingForAvatarContents {
		t.Error("waiting flag should survive an unrelated broadcast")
	}
}

// parseElko is a test helper that unmarshals raw JSON into an ElkoMessage
// and fails the test on error.
func parseElko(t *testing.T, raw []byte) *ElkoMessage {
	t.Helper()
	var m ElkoMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("parseElko: %v (raw=%q)", err, raw)
	}
	return &m
}
