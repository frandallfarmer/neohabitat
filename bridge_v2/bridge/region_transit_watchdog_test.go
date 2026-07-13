package bridge

import (
	"context"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

// Coverage for the region-transition watchdog (ClientSession.armRegionTransit-
// Watchdog / regionTransitWatchdogFired), which force-enters a region when the
// client never sends the follow-up MESSAGE_DESCRIBE after an immediate:false
// changeContext — the Snogpitch lockup (2026-07). enterContext queues its
// entercontext on elkoSendChan, so we assert on that (no live Elko needed).

// newWatchdogTestSession builds the minimal ClientSession the watchdog +
// enterContext touch: a buffered (never-closed) elkoSendChan, a done channel, a
// nil transit registry (no-op in tests, per invisible.go), and a discard logger.
func newWatchdogTestSession() *ClientSession {
	return &ClientSession{
		bridge:        &Bridge{Sessions: make(map[string]*ClientSession)},
		ctx:           context.Background(),
		done:          make(chan struct{}),
		elkoSendChan:  make(chan *outboundElkoMessage, MaxClientMessages),
		log:           zerolog.Nop(),
		userRef:       "user-test",
		NoidClassList: []uint8{},
		NoidContents:  make(map[uint8][]uint8),
		RefToNoid:     make(map[string]uint8),
		objects:       make(map[uint8]*ElkoMessage),
	}
}

// armWatchdog arms the transit watchdog under stateMu, as the changeContext
// handler does.
func (c *ClientSession) armWatchdog(region string) {
	c.stateMu.Lock()
	c.armRegionTransitWatchdog(region)
	c.stateMu.Unlock()
}

// recvEnterContext waits up to timeout for an entercontext on the session's Elko
// send channel and returns its target context. ok=false on timeout (none sent).
func recvEnterContext(t *testing.T, ch chan *outboundElkoMessage, timeout time.Duration) (string, bool) {
	t.Helper()
	select {
	case out := <-ch:
		if out.msg == nil || out.msg.Op == nil || *out.msg.Op != "entercontext" {
			t.Fatalf("expected an entercontext message, got %+v", out.msg)
		}
		if out.msg.Context == nil {
			return "", true
		}
		return *out.msg.Context, true
	case <-time.After(timeout):
		return "", false
	}
}

// shortenWatchdog drops the (package-wide) timeout for the duration of a test.
// Tests run sequentially, so mutating the package var is safe.
func shortenWatchdog(t *testing.T) {
	t.Helper()
	restore := regionTransitWatchdogTimeout
	regionTransitWatchdogTimeout = 20 * time.Millisecond
	t.Cleanup(func() { regionTransitWatchdogTimeout = restore })
}

// The client never sends DESCRIBE → the watchdog must force-enter the region.
func TestRegionTransitWatchdog_FiresOnStall(t *testing.T) {
	shortenWatchdog(t)
	sess := newWatchdogTestSession()
	const region = "context-Popustop.afront2.line1106"

	sess.armWatchdog(region)

	got, ok := recvEnterContext(t, sess.elkoSendChan, 500*time.Millisecond)
	if !ok {
		t.Fatal("watchdog never fired: no entercontext after the timeout")
	}
	if got != region {
		t.Fatalf("watchdog entered %q, want %q", got, region)
	}
	sess.stateMu.Lock()
	defer sess.stateMu.Unlock()
	if !sess.nextRegionSet {
		t.Fatal("nextRegionSet should be true after the forced enterContext")
	}
}

// A normal DESCRIBE (enterContext) resolves the transition → the watchdog must
// NOT fire a second, spurious entercontext.
func TestRegionTransitWatchdog_NoFireAfterDescribe(t *testing.T) {
	shortenWatchdog(t)
	sess := newWatchdogTestSession()
	const region = "context-Downtown_5f"

	sess.stateMu.Lock()
	sess.armRegionTransitWatchdog(region)
	// The client's DESCRIBE arrives: enterContext runs, advancing the epoch.
	sess.enterContext(region)
	sess.stateMu.Unlock()

	// Drain the legitimate entercontext from the DESCRIBE-driven enter.
	if got, ok := recvEnterContext(t, sess.elkoSendChan, 200*time.Millisecond); !ok || got != region {
		t.Fatalf("expected the DESCRIBE-driven entercontext for %q (ok=%v got=%q)", region, ok, got)
	}
	if got, ok := recvEnterContext(t, sess.elkoSendChan, 5*regionTransitWatchdogTimeout); ok {
		t.Fatalf("watchdog fired after a normal DESCRIBE — spurious entercontext for %q", got)
	}
}

// A newer changeContext supersedes an earlier one → only the latest transition's
// watchdog force-enters, exactly once.
func TestRegionTransitWatchdog_SupersededByNewerTransition(t *testing.T) {
	shortenWatchdog(t)
	sess := newWatchdogTestSession()
	const r1 = "context-A"
	const r2 = "context-B"

	sess.stateMu.Lock()
	sess.armRegionTransitWatchdog(r1) // epoch G
	sess.armRegionTransitWatchdog(r2) // epoch G+1, supersedes r1
	sess.stateMu.Unlock()

	got, ok := recvEnterContext(t, sess.elkoSendChan, 500*time.Millisecond)
	if !ok {
		t.Fatal("newer transition's watchdog never fired")
	}
	if got != r2 {
		t.Fatalf("watchdog entered %q, want the newer %q", got, r2)
	}
	if got, ok := recvEnterContext(t, sess.elkoSendChan, 5*regionTransitWatchdogTimeout); ok {
		t.Fatalf("stale (superseded) watchdog also fired: extra entercontext for %q", got)
	}
}

// A torn-down session (done closed) → the watchdog must bail without entering.
func TestRegionTransitWatchdog_NoFireWhenClosed(t *testing.T) {
	shortenWatchdog(t)
	sess := newWatchdogTestSession()

	sess.armWatchdog("context-C")
	close(sess.done) // session torn down before the timer fires

	if got, ok := recvEnterContext(t, sess.elkoSendChan, 5*regionTransitWatchdogTimeout); ok {
		t.Fatalf("watchdog fired on a closed session: entercontext for %q", got)
	}
}
