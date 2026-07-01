package bridge

import (
	"strings"
	"testing"
	"time"
)

// newTestOracle builds a relay wired to a capturing webhook on oracle-requests, sharing a
// presence registry (bot exclusion + region names) with no Mongo (prettified-ref fallback,
// empty class → "Oracle"/💬).
func newTestOracle(t *testing.T) (*oracleRelay, *capturingWebhook) {
	t.Helper()
	hook := newCapturingWebhook(t)
	b := &Bridge{DataRate: 1 << 20, Sessions: make(map[string]*ClientSession)}
	notifier := NewDiscordNotifier(map[string]string{oracleChannel: hook.srv.URL})
	p := newPresenceRegistry(b, notifier)
	p.now = func() time.Time { return time.Unix(1_800_000_000, 0) }
	b.presence = p
	o := newOracleRelay(p, notifier)
	b.oracle = o
	return o, hook
}

func TestOracleAskPosts(t *testing.T) {
	o, hook := newTestOracle(t)
	o.classCache["item-fountain1"] = "Fountain" // no Mongo in tests; seed the cache
	o.relay(oracleAsk{
		userRef: "user-randy", name: "Randy", regionRef: "context-Downtown_5f",
		targetRef: "item-fountain1", verb: "ASK", text: "How do I remove a curse?",
	})
	posts := hook.posts()
	if len(posts) != 1 {
		t.Fatalf("expected 1 post, got %v", posts)
	}
	want := "⛲ **Randy** asks the Fountain in *Downtown 5f*: “How do I remove a curse?”"
	if posts[0] != want {
		t.Fatalf("post = %q, want %q", posts[0], want)
	}
}

func TestOracleWishWording(t *testing.T) {
	o, hook := newTestOracle(t)
	o.classCache["item-lamp1"] = "Magic_lamp"
	o.relay(oracleAsk{
		userRef: "user-randy", name: "Randy", regionRef: "context-Downtown_4f",
		targetRef: "item-lamp1", verb: "WISH", text: "a sword",
	})
	posts := hook.posts()
	if len(posts) != 1 {
		t.Fatalf("expected 1 post, got %v", posts)
	}
	want := "🧞 **Randy** wishes upon the Magic Lamp in *Downtown 4f*: “a sword”"
	if posts[0] != want {
		t.Fatalf("post = %q, want %q", posts[0], want)
	}
}

func TestOracleUnknownClassFallback(t *testing.T) {
	o, hook := newTestOracle(t)
	o.relay(oracleAsk{
		userRef: "user-randy", name: "Randy", regionRef: "context-Downtown_5f",
		targetRef: "item-mystery", verb: "ASK", text: "hello?",
	})
	posts := hook.posts()
	if len(posts) != 1 {
		t.Fatalf("expected 1 post, got %v", posts)
	}
	want := "💬 **Randy** asks the Oracle in *Downtown 5f*: “hello?”"
	if posts[0] != want {
		t.Fatalf("post = %q, want %q", posts[0], want)
	}
}

func TestOracleBotAndEmptySuppressed(t *testing.T) {
	o, hook := newTestOracle(t)
	o.classCache["item-fountain1"] = "Fountain"
	o.relay(oracleAsk{
		userRef: "user-sagebot", name: "SageBot", regionRef: "context-Downtown_5f",
		targetRef: "item-fountain1", verb: "ASK", text: "what is love?",
	})
	o.relay(oracleAsk{
		userRef: "user-randy", name: "Randy", regionRef: "context-Downtown_5f",
		targetRef: "item-fountain1", verb: "ASK", text: "   ",
	})
	if posts := hook.posts(); len(posts) != 0 {
		t.Fatalf("bot asks and empty text must be silent; got %v", posts)
	}
}

func TestOracleTextTruncated(t *testing.T) {
	o, hook := newTestOracle(t)
	o.classCache["item-ball1"] = "Crystal_ball"
	long := strings.Repeat("z", oracleTextMax+50)
	o.relay(oracleAsk{
		userRef: "user-randy", name: "Randy", regionRef: "context-Downtown_5f",
		targetRef: "item-ball1", verb: "ASK", text: long,
	})
	posts := hook.posts()
	if len(posts) != 1 {
		t.Fatalf("expected 1 post, got %v", posts)
	}
	if !strings.Contains(posts[0], "🔮") || !strings.Contains(posts[0], "Crystal Ball") {
		t.Fatalf("wrong icon/class: %q", posts[0])
	}
	if strings.Count(posts[0], "z") != oracleTextMax || !strings.Contains(posts[0], "…”") {
		t.Fatalf("text not truncated to %d: len=%d", oracleTextMax, len(posts[0]))
	}
}

func TestOracleUnconfiguredChannelIsNoop(t *testing.T) {
	b := &Bridge{DataRate: 1 << 20, Sessions: make(map[string]*ClientSession)}
	notifier := NewDiscordNotifier(nil)
	p := newPresenceRegistry(b, notifier)
	o := newOracleRelay(p, notifier)
	// Must not panic or block; just logs.
	o.relay(oracleAsk{
		userRef: "user-randy", name: "Randy", regionRef: "context-Downtown_5f",
		targetRef: "item-fountain1", verb: "ASK", text: "anyone there?",
	})
}
