package bridge

import (
	"bufio"
	"context"
	"sync"
	"testing"
	"time"
)

// Regression coverage for issue #505: when the bridge's elko-facing TCP
// dies (habiproxy/elko restart, network blip), elkoReader and elkoWriter
// must trigger a full session teardown so the bot's client TCP is
// EOF'd and HabiBot's reconnect loop kicks in. Previously both just
// `return`-ed silently, leaving the bot stuck reading from a half-open
// session that no longer routed writes to/from elko.

func newIssue505Session(t *testing.T) (*ClientSession, *recordingConn, *recordingConn, *Bridge) {
	t.Helper()
	bridge := &Bridge{
		DataRate: 1 << 20,
		Sessions: make(map[string]*ClientSession),
	}
	clientRC := newRecordingConn(nil)
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
		done:            make(chan struct{}),
		elkoConn:        elkoRC,
		elkoDone:        make(chan struct{}),
		elkoSendChan:    make(chan *outboundElkoMessage, MaxClientMessages),
		firstConnection: true,
		jsonPassthrough: true,
		objects:         make(map[uint8]*ElkoMessage),
	}
	sess.contentsVector = NewContentsVector(sess, nil, &REGION_NOID, nil, nil)
	// Register so RemoveSession has something to delete; also serves as
	// a teardown-completion sentinel.
	bridge.Sessions[sess.TableKey()] = sess
	return sess, clientRC, elkoRC, bridge
}

func waitForCondition(t *testing.T, timeout time.Duration, name string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", name)
}

func TestIssue505_ElkoReaderTeardownOnUnplannedDisconnect(t *testing.T) {
	sess, clientRC, elkoRC, bridge := newIssue505Session(t)

	// Mirror what connectToElko does: register reader+writer wgs before
	// launching the goroutines.
	sess.wg.Add(2)
	sess.elkoWg.Add(2)
	sess.elkoConnInitWg.Add(2)
	go sess.elkoReader()
	go sess.elkoWriter()
	sess.elkoConnInitWg.Wait()

	// Simulate habiproxy/elko going away: close the elko-side socket.
	// recordingConn.Close flips closed=true so subsequent Reads return
	// io.EOF — the same observable behavior as a real FIN/RST.
	if err := elkoRC.Close(); err != nil {
		t.Fatalf("close elkoRC: %v", err)
	}

	// elkoReader should detect EOF, log the error, and schedule
	// `go c.Close()`. The cascade closes clientConn and removes the
	// session from the bridge's Sessions map.
	waitForCondition(t, 2*time.Second, "clientConn closed", func() bool {
		clientRC.mu.Lock()
		defer clientRC.mu.Unlock()
		return clientRC.closed
	})

	waitForCondition(t, 2*time.Second, "session removed from bridge", func() bool {
		bridge.sessionsMutex.Lock()
		defer bridge.sessionsMutex.Unlock()
		_, found := bridge.Sessions[sess.TableKey()]
		return !found
	})
}

func TestIssue505_ElkoWriterTeardownOnWriteFailure(t *testing.T) {
	sess, clientRC, elkoRC, bridge := newIssue505Session(t)

	sess.wg.Add(2)
	sess.elkoWg.Add(2)
	sess.elkoConnInitWg.Add(2)
	go sess.elkoReader()
	go sess.elkoWriter()
	sess.elkoConnInitWg.Wait()

	// Close elko side, then push a write through elkoSendChan. The
	// elkoWriter wakes up, attempts to write, gets io.ErrClosedPipe,
	// and must schedule `go c.Close()` rather than returning silently.
	if err := elkoRC.Close(); err != nil {
		t.Fatalf("close elkoRC: %v", err)
	}

	// Sending to elkoSendChan synchronously is fine — the channel is
	// buffered. The writeDone signal is best-effort here; we care about
	// the side effect (session teardown), not the per-write reply.
	op := "WALK"
	to := "user-sagebot"
	msg := &ElkoMessage{To: &to, Op: &op}
	writeDone := make(chan error, 1)
	sess.elkoSendChan <- &outboundElkoMessage{msg: msg, writeDone: writeDone}

	// elkoReader may also race to teardown first (EOF on the already-
	// closed elko conn); either way the observable result is the same:
	// client TCP closed + session removed.
	waitForCondition(t, 2*time.Second, "clientConn closed", func() bool {
		clientRC.mu.Lock()
		defer clientRC.mu.Unlock()
		return clientRC.closed
	})

	waitForCondition(t, 2*time.Second, "session removed from bridge", func() bool {
		bridge.sessionsMutex.Lock()
		defer bridge.sessionsMutex.Unlock()
		_, found := bridge.Sessions[sess.TableKey()]
		return !found
	})
}

func TestIssue505_PlannedCloseDoesNotDoubleTeardown(t *testing.T) {
	// Sanity check: when teardown is initiated by something else (e.g.
	// client disconnect), elkoReader's error path observes doneClosed=true
	// and exits quietly without firing another `go c.Close()`. Verifies
	// that the !closing guard in the fix actually distinguishes the
	// planned-teardown case.
	sess, clientRC, elkoRC, _ := newIssue505Session(t)

	sess.wg.Add(2)
	sess.elkoWg.Add(2)
	sess.elkoConnInitWg.Add(2)
	go sess.elkoReader()
	go sess.elkoWriter()
	sess.elkoConnInitWg.Wait()

	// Trigger planned teardown first.
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		sess.Close()
	}()

	// Then close the elko side a hair later, racing with the planned
	// teardown. The reader will see closing=true via doneClosed and
	// should exit via the debug branch (no second Close cascade,
	// which would deadlock the wg.Wait inside Close).
	time.Sleep(20 * time.Millisecond)
	_ = elkoRC.Close()

	// Wait for Close() to complete — if the second Close were fired,
	// it'd deadlock here because the wg.Wait inside it would race the
	// original.
	doneCh := make(chan struct{})
	go func() {
		wg.Wait()
		close(doneCh)
	}()
	select {
	case <-doneCh:
		// Good — Close returned cleanly.
	case <-time.After(2 * time.Second):
		t.Fatal("planned Close deadlocked, indicating double-teardown")
	}

	clientRC.mu.Lock()
	closed := clientRC.closed
	clientRC.mu.Unlock()
	if !closed {
		t.Errorf("expected clientConn closed after planned teardown")
	}
}
