package bridge

import (
	"bufio"
	"context"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// Regression coverage for the silent-reconnect path on elko-side
// disconnect (issue #505).
//
// The trigger in production is habiproxy closing the bridge-side TCP
// after elko closed the server-side following a normal changeContext.
// Pre-fix the bridge silently let elkoReader exit and the next
// entercontext write fell into the void, leaving the client stuck in
// an infinite region transfer. The fix reconnects to a fresh elko
// dial and re-enters the most recent context so transit completes.

// fakeElkoListener is a minimal accept-and-immediately-close TCP
// server used to drive ClientSession's reconnect logic. Successful
// dials keep the socket open until the test ends so the new
// elkoReader/Writer goroutines have something to read from.
type fakeElkoListener struct {
	ln       net.Listener
	mu       sync.Mutex
	accepted []net.Conn
}

func newFakeElkoListener(t *testing.T) *fakeElkoListener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	f := &fakeElkoListener{ln: ln}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			f.mu.Lock()
			f.accepted = append(f.accepted, conn)
			f.mu.Unlock()
		}
	}()
	t.Cleanup(func() {
		f.mu.Lock()
		for _, c := range f.accepted {
			_ = c.Close()
		}
		f.mu.Unlock()
		_ = ln.Close()
	})
	return f
}

func (f *fakeElkoListener) addr() string { return f.ln.Addr().String() }

// waitForRecoveryCondition is a tiny polling helper used by the
// recovery tests. Kept local to avoid colliding with a similarly-
// named helper that lands on the parallel issue-502 branch.
func waitForRecoveryCondition(t *testing.T, timeout time.Duration, name string, cond func() bool) {
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

func (f *fakeElkoListener) acceptedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.accepted)
}

func (f *fakeElkoListener) closeAllAccepted() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.accepted {
		_ = c.Close()
	}
	f.accepted = f.accepted[:0]
}

// recoverTestSession wires up a ClientSession with a real-ish elko
// connection dialed against the fake listener. The client side is a
// recordingConn so we can assert the client TCP stays open through
// the silent reconnect.
func recoverTestSession(t *testing.T, elkoAddr string, regionRef string) (*ClientSession, *recordingConn) {
	t.Helper()
	bridge := &Bridge{
		DataRate: 1 << 20,
		elkoHost: elkoAddr,
		Sessions: make(map[string]*ClientSession),
	}
	clientRC := newRecordingConn(nil)
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
		elkoDone:        make(chan struct{}),
		elkoSendChan:    make(chan *outboundElkoMessage, MaxClientMessages),
		jsonPassthrough: true,
		objects:         make(map[uint8]*ElkoMessage),
		regionRef:       regionRef,
		userRef:         "user-test",
	}
	sess.contentsVector = NewContentsVector(sess, nil, &REGION_NOID, nil, nil)
	bridge.Sessions[sess.TableKey()] = sess
	if err := sess.connectToElko(); err != nil {
		t.Fatalf("connectToElko: %v", err)
	}
	return sess, clientRC
}

func TestRecover_SilentReconnectAfterElkoDisconnect(t *testing.T) {
	elko := newFakeElkoListener(t)
	sess, clientRC := recoverTestSession(t, elko.addr(), "context-Downtown_5f")

	// Wait for the initial dial to register.
	waitForRecoveryCondition(t, 2*time.Second, "initial elko dial", func() bool {
		return elko.acceptedCount() >= 1
	})

	// Simulate habiproxy closing the bridge-side TCP (the real-world
	// trigger). elkoReader hits EOF and schedules recovery.
	// closeAllAccepted clears the listener's tracked accept list, so
	// after recovery successfully re-dials we should see exactly one
	// fresh accept land.
	elko.closeAllAccepted()
	waitForRecoveryCondition(t, 5*time.Second, "recovery re-dial", func() bool {
		return elko.acceptedCount() >= 1
	})

	// Client TCP must stay open through the recovery — the whole
	// point of silent reconnect is to NOT surface the disconnect to
	// the client.
	clientRC.mu.Lock()
	closed := clientRC.closed
	clientRC.mu.Unlock()
	if closed {
		t.Errorf("client conn should NOT be closed after silent reconnect")
	}

	// Session should still be in the bridge's map.
	sess.bridge.sessionsMutex.Lock()
	_, present := sess.bridge.Sessions[sess.TableKey()]
	sess.bridge.sessionsMutex.Unlock()
	if !present {
		t.Errorf("session removed from bridge after silent reconnect — should have stayed")
	}

	// Cleanup
	sess.Close()
}

func TestRecover_FailsOpenWhenDialKeepsFailing(t *testing.T) {
	// Listener that's never reachable.
	elko := newFakeElkoListener(t)
	addr := elko.addr()
	sess, clientRC := recoverTestSession(t, addr, "context-Downtown_5f")
	waitForRecoveryCondition(t, 2*time.Second, "initial elko dial", func() bool {
		return elko.acceptedCount() >= 1
	})

	// Stop the listener so future dials fail.
	_ = elko.ln.Close()
	elko.closeAllAccepted()

	// Recovery should exhaust retries and tear down the session.
	waitForRecoveryCondition(t, 20*time.Second, "session removed after dial exhaustion", func() bool {
		sess.bridge.sessionsMutex.Lock()
		defer sess.bridge.sessionsMutex.Unlock()
		_, present := sess.bridge.Sessions[sess.TableKey()]
		return !present
	})

	// And the client TCP gets closed so HabiBot reconnects.
	waitForRecoveryCondition(t, 2*time.Second, "client closed after teardown", func() bool {
		clientRC.mu.Lock()
		defer clientRC.mu.Unlock()
		return clientRC.closed
	})
}

func TestRecover_PrefersBridgeAutoEnteredContextOverRegionRef(t *testing.T) {
	// Regression for the "Sage keeps returning to the region they're
	// in" bug:
	//   1. Bot in Downtown_5f does NEWREGION south.
	//   2. Elko replies changeContext context-Downtown_6f.
	//   3. handleElkoMessageJson sets bridgeAutoEnteredContext = "..._6f",
	//      then calls enterContext, which WIPES c.nextRegion.
	//   4. Elko closes its server-side; habiproxy disconnects the
	//      bridge-side; elkoReader EOFs and fires recovery.
	//   5. Recovery must re-enter Downtown_6f (the in-flight transit
	//      target), NOT Downtown_5f (the stale regionRef).
	elko := newFakeElkoListener(t)
	sess, _ := recoverTestSession(t, elko.addr(), "context-Downtown_5f")
	sess.stateMu.Lock()
	sess.bridgeAutoEnteredContext = "context-Downtown_6f"
	sess.stateMu.Unlock()
	waitForRecoveryCondition(t, 2*time.Second, "initial dial", func() bool {
		return elko.acceptedCount() >= 1
	})

	// Drain the initial accept's elkoSendChan so we can observe what
	// recovery sends post-reconnect.
	elko.closeAllAccepted()
	waitForRecoveryCondition(t, 5*time.Second, "recovery re-dial", func() bool {
		return elko.acceptedCount() >= 1
	})

	// Look for the entercontext that recovery sent after dialing.
	// connectToElko started a fresh elkoWriter; recovery's
	// enterContext queues to elkoSendChan, the writer marshals and
	// writes to the new conn. Pull bytes off the accepted listener
	// and confirm the target context is Downtown_6f, NOT _5f.
	elko.mu.Lock()
	conn := elko.accepted[0]
	elko.mu.Unlock()
	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("read from recovered conn: %v", err)
	}
	got := string(buf[:n])
	if !strings.Contains(got, "context-Downtown_6f") {
		t.Errorf("recovery re-entered wrong context — wanted Downtown_6f, got: %s", got)
	}
	if strings.Contains(got, "context-Downtown_5f") {
		t.Errorf("recovery re-entered stale regionRef Downtown_5f: %s", got)
	}
	sess.Close()
}

func TestRecover_PlannedCloseDoesNotTriggerRecovery(t *testing.T) {
	// When Close() is what flipped doneClosed, the elkoReader EOF
	// must NOT spin up a doomed recovery goroutine that races the
	// Close().
	elko := newFakeElkoListener(t)
	sess, _ := recoverTestSession(t, elko.addr(), "context-Downtown_5f")
	waitForRecoveryCondition(t, 2*time.Second, "initial dial", func() bool {
		return elko.acceptedCount() >= 1
	})

	initialAccepts := elko.acceptedCount()

	// Planned close. recoverElkoConnection should see doneClosed and
	// no-op; no second dial should land at the listener.
	sess.Close()

	// Brief settle — if recovery spuriously fires, we'd see another
	// accept here.
	time.Sleep(500 * time.Millisecond)
	if got := elko.acceptedCount(); got != initialAccepts {
		t.Errorf("recovery dialed during planned close (accepts: %d → %d)", initialAccepts, got)
	}
}
