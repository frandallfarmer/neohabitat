package bridge

import (
	"fmt"
	"testing"
	"time"
)

// TestCloseOtherSessionsForUser verifies the one-live-session-per-user rule: a new login for a
// user force-closes any prior session for the SAME userRef, and leaves the keeper and unrelated
// users alone. This is the "closed/superseded web window must not strand an avatar in the region"
// invariant, enforced at login time.
func TestCloseOtherSessionsForUser(t *testing.T) {
	bridge := &Bridge{DataRate: 1 << 20, Sessions: make(map[string]*ClientSession)}

	var n int
	mk := func(userRef string) (*ClientSession, *recordingConn) {
		rc := newRecordingConn(nil)
		sess := &ClientSession{
			bridge:     bridge,
			clientConn: NewClientConnection(bridge, rc),
			done:       make(chan struct{}),
			elkoDone:   make(chan struct{}),
			userRef:    userRef,
		}
		n++
		bridge.Sessions[fmt.Sprintf("sess-%d", n)] = sess // unique key (recordingConn RemoteAddr is fixed)
		return sess, rc
	}

	keep, keepRC := mk("user-randy")
	_, staleRC := mk("user-randy")   // prior session for the same user — must be force-closed
	_, otherRC := mk("user-chip")    // a different user — must be left alone

	bridge.closeOtherSessionsForUser(keep, "user-randy")

	// The stale same-user session is force-closed on its own goroutine.
	waitForRecoveryCondition(t, 2*time.Second, "stale same-user session force-closed", func() bool {
		staleRC.mu.Lock()
		defer staleRC.mu.Unlock()
		return staleRC.closed
	})

	// The keeper (this login) and the unrelated user must survive.
	keepRC.mu.Lock()
	kc := keepRC.closed
	keepRC.mu.Unlock()
	if kc {
		t.Error("the keeper session must NOT be closed")
	}
	otherRC.mu.Lock()
	oc := otherRC.closed
	otherRC.mu.Unlock()
	if oc {
		t.Error("a different user's session must NOT be closed")
	}

	// An empty userRef is a no-op (never force-close on an unresolved identity).
	bridge2 := &Bridge{DataRate: 1 << 20, Sessions: make(map[string]*ClientSession)}
	only, onlyRC := &ClientSession{bridge: bridge2, userRef: ""}, newRecordingConn(nil)
	only.clientConn = NewClientConnection(bridge2, onlyRC)
	only.done, only.elkoDone = make(chan struct{}), make(chan struct{})
	bridge2.Sessions["only"] = only
	bridge2.closeOtherSessionsForUser(only, "")
	time.Sleep(50 * time.Millisecond)
	onlyRC.mu.Lock()
	only0 := onlyRC.closed
	onlyRC.mu.Unlock()
	if only0 {
		t.Error("empty userRef must be a no-op")
	}
}
