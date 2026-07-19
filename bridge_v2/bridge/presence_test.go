package bridge

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// capturingWebhook is an httptest Discord endpoint recording each posted `content`.
type capturingWebhook struct {
	mu       sync.Mutex
	contents []string
	srv      *httptest.Server
}

func newCapturingWebhook(t *testing.T) *capturingWebhook {
	t.Helper()
	c := &capturingWebhook{}
	c.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Content string `json:"content"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		c.mu.Lock()
		c.contents = append(c.contents, body.Content)
		c.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(c.srv.Close)
	return c
}

// posts waits briefly for the notifier's async worker to drain, then returns the contents.
func (c *capturingWebhook) posts() []string {
	deadline := time.Now().Add(2 * time.Second)
	last := -1
	for time.Now().Before(deadline) {
		c.mu.Lock()
		n := len(c.contents)
		c.mu.Unlock()
		if n == last {
			break
		}
		last = n
		time.Sleep(20 * time.Millisecond)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.contents...)
}

// newTestPresence builds a registry with a fake clock and a capturing webhook on the
// "logins" channel, bound to a minimal Bridge.
func newTestPresence(t *testing.T) (*presenceRegistry, *capturingWebhook, *time.Time) {
	t.Helper()
	hook := newCapturingWebhook(t)
	b := &Bridge{DataRate: 1 << 20, Sessions: make(map[string]*ClientSession)}
	p := newPresenceRegistry(b, NewDiscordNotifier(map[string]string{
		presenceLoginsChannel: hook.srv.URL,
	}))
	now := time.Unix(1_800_000_000, 0)
	p.now = func() time.Time { return now }
	b.presence = p
	return p, hook, &now
}

func connectInfo(userRef, name, regionRef string) presenceConnect {
	return presenceConnect{userRef: userRef, name: name, regionRef: regionRef}
}

func TestPresenceAlertsFreshLogin(t *testing.T) {
	p, hook, _ := newTestPresence(t)
	p.noteConnect(connectInfo("user-randy", "Randy", "context-Downtown_4f"))
	posts := hook.posts()
	if len(posts) != 1 {
		t.Fatalf("expected 1 post, got %d: %v", len(posts), posts)
	}
	// No Mongo in tests → prettified ref fallback.
	want := "✨ **Randy** materializes in *Downtown 4f*… 🕹️ · 1 avatar in-world"
	if posts[0] != want {
		t.Fatalf("post = %q, want %q", posts[0], want)
	}
}

func TestPresenceDebounceWindow(t *testing.T) {
	p, hook, now := newTestPresence(t)
	p.noteDisconnect("user-randy", "Randy", true, "")
	*now = now.Add(presenceDebounceWindow - time.Second)
	p.noteConnect(connectInfo("user-randy", "Randy", "context-Downtown_4f"))
	if posts := hook.posts(); len(posts) != 0 {
		t.Fatalf("reconnect inside the window must be silent; got %v", posts)
	}
	*now = now.Add(2 * time.Second) // past the window now
	p.noteConnect(connectInfo("user-randy", "Randy", "context-Downtown_4f"))
	if posts := hook.posts(); len(posts) != 1 {
		t.Fatalf("reconnect past the window must post; got %v", posts)
	}
	// History recorded all three events, with the suppressed one flagged.
	p.mu.Lock()
	events := append([]PresenceEvent(nil), p.history...)
	p.mu.Unlock()
	if len(events) != 3 {
		t.Fatalf("expected 3 history events, got %d", len(events))
	}
	if events[0].Kind != "disconnect" || events[0].Alerted {
		t.Fatalf("disconnect event wrong: %+v", events[0])
	}
	if events[1].Alerted || events[1].Reason != "debounce" {
		t.Fatalf("suppressed connect wrong: %+v", events[1])
	}
	if !events[2].Alerted {
		t.Fatalf("fresh connect should be alerted: %+v", events[2])
	}
}

func TestPresenceConcurrentSessionSuppressed(t *testing.T) {
	p, hook, _ := newTestPresence(t)
	other := &ClientSession{bridge: p.bridge, userRef: "user-randy", UserName: "Randy"}
	p.bridge.Sessions["stale"] = other
	p.noteConnect(connectInfo("user-randy", "Randy", "context-Downtown_4f"))
	if posts := hook.posts(); len(posts) != 0 {
		t.Fatalf("takeover login must be silent; got %v", posts)
	}
	p.mu.Lock()
	reason := p.history[len(p.history)-1].Reason
	p.mu.Unlock()
	if reason != "concurrent-session" {
		t.Fatalf("reason = %q, want concurrent-session", reason)
	}
}

func TestPresenceBotsSuppressedAndUncounted(t *testing.T) {
	p, hook, _ := newTestPresence(t)
	// Bots in-world must not post and must not inflate the human count.
	for i, ref := range []string{"user-welcomebot", "user-elizabot", "user-sagebot"} {
		s := &ClientSession{bridge: p.bridge, userRef: ref, UserName: strings.TrimPrefix(ref, "user-")}
		p.bridge.Sessions[string(rune('a'+i))] = s
	}
	p.noteConnect(connectInfo("user-sagebot", "SageBot", "context-Popustop.822"))
	if posts := hook.posts(); len(posts) != 0 {
		t.Fatalf("bot login must be silent; got %v", posts)
	}
	p.noteConnect(connectInfo("user-randy", "Randy", "context-Downtown_4f"))
	posts := hook.posts()
	if len(posts) != 1 {
		t.Fatalf("human login must post; got %v", posts)
	}
	if !strings.Contains(posts[0], "1 avatar in-world") {
		t.Fatalf("bots must not inflate the count: %q", posts[0])
	}
}

func TestPresenceExcludeListSuppressed(t *testing.T) {
	p, hook, _ := newTestPresence(t)
	// Simulates DISCORD_ALERT_EXCLUDE=phil for bots whose names don't end in "bot".
	p.exclude["phil"] = struct{}{}
	p.noteConnect(connectInfo("user-phil", "Phil", "context-Popustop.1002"))
	if posts := hook.posts(); len(posts) != 0 {
		t.Fatalf("excluded name must be silent; got %v", posts)
	}
}

func TestPresenceTurfWording(t *testing.T) {
	p, hook, _ := newTestPresence(t)
	info := connectInfo("user-chip", "Chip", "context-Randy_Rd_13_interior")
	info.turfRef = "context-Randy_Rd_13_interior"
	info.json = true
	p.noteConnect(info)
	posts := hook.posts()
	if len(posts) != 1 {
		t.Fatalf("expected 1 post, got %v", posts)
	}
	want := "✨ **Chip** materializes at *their turf*… 🌐 · 1 avatar in-world"
	if posts[0] != want {
		t.Fatalf("post = %q, want %q", posts[0], want)
	}
}

func TestPresenceNewUserFanfare(t *testing.T) {
	p, hook, _ := newTestPresence(t)
	info := connectInfo("user-newbie", "Newbie", "context-Fountain")
	info.newUser = true
	info.json = true
	p.noteConnect(info)
	posts := hook.posts()
	if len(posts) != 1 {
		t.Fatalf("expected 1 post, got %v", posts)
	}
	want := "🎉 A new avatar has been hatched: **Newbie** — materializing in *Fountain*… 🌐 · 1 avatar in-world"
	if posts[0] != want {
		t.Fatalf("post = %q, want %q", posts[0], want)
	}
}

func TestPresenceDebounceHandoffRoundTrip(t *testing.T) {
	p, hook, now := newTestPresence(t)
	p.noteDisconnect("user-randy", "Randy", true, "")
	exported := p.exportDebounce()
	if len(exported) != 1 {
		t.Fatalf("export = %v", exported)
	}
	// Fresh registry (the reloaded child process) imports and still debounces.
	p2, hook2, now2 := newTestPresence(t)
	*now2 = *now
	p2.importDebounce(exported)
	p2.noteConnect(connectInfo("user-randy", "Randy", "context-Downtown_4f"))
	if posts := hook2.posts(); len(posts) != 0 {
		t.Fatalf("imported debounce must suppress; got %v", posts)
	}
	_ = hook
}

func TestDiscordNotifierUnconfiguredIsNoop(t *testing.T) {
	// Dev default: no channels → posts are silent no-ops, and presence records
	// reason=disabled instead of posting.
	p := newPresenceRegistry(&Bridge{DataRate: 1 << 20, Sessions: map[string]*ClientSession{}},
		NewDiscordNotifier(nil))
	now := time.Unix(1_800_000_000, 0)
	p.now = func() time.Time { return now }
	p.noteConnect(connectInfo("user-randy", "Randy", "context-Downtown_4f"))
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.history) != 1 || p.history[0].Alerted || p.history[0].Reason != "disabled" {
		t.Fatalf("history = %+v", p.history)
	}
}

func TestDiscordChannelNamesFromEnvSuffix(t *testing.T) {
	t.Setenv("DISCORD_WEBHOOK_LOGINS", "http://127.0.0.1:1/logins")
	t.Setenv("DISCORD_WEBHOOK_ORACLE_REQUESTS", "http://127.0.0.1:1/oracle")
	d := NewDiscordNotifierFromEnv()
	if !d.Enabled("logins") || !d.Enabled("oracle-requests") {
		t.Fatalf("channels = %v", d.channels)
	}
}

func TestPrettifyContextRef(t *testing.T) {
	cases := map[string]string{
		"context-Downtown_4f":  "Downtown 4f",
		"context-Popustop.822": "Popustop 822",
		"":                     "parts unknown",
	}
	for ref, want := range cases {
		p := &presenceRegistry{regionNames: map[string]string{}, now: time.Now}
		if got := p.regionName(ref); got != want {
			t.Fatalf("regionName(%q) = %q, want %q", ref, got, want)
		}
	}
}
