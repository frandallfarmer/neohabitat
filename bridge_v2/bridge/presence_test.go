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

// capturingWebhook is an httptest Discord endpoint recording each post. Producers use
// either plain `content` (presence) or a single embed (oracle), so it records the prose of
// both — an embed's description — under contents, plus the embed footers separately.
type capturingWebhook struct {
	mu           sync.Mutex
	contents     []string
	embedFooters []string
	srv          *httptest.Server
}

func newCapturingWebhook(t *testing.T) *capturingWebhook {
	t.Helper()
	c := &capturingWebhook{}
	c.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Content string         `json:"content"`
			Embeds  []discordEmbed `json:"embeds"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		c.mu.Lock()
		if len(body.Embeds) > 0 {
			c.contents = append(c.contents, body.Embeds[0].Description)
			footer := ""
			if body.Embeds[0].Footer != nil {
				footer = body.Embeds[0].Footer.Text
			}
			c.embedFooters = append(c.embedFooters, footer)
		} else {
			c.contents = append(c.contents, body.Content)
			c.embedFooters = append(c.embedFooters, "")
		}
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

// footers returns the embed footer of each post ("" for plain-content posts). Call after
// posts(), which is the call that waits for the worker to drain.
func (c *capturingWebhook) footers() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.embedFooters...)
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

// A hidden service avatar (the Oracle) carries elko's HIDDEN_AVATAR nitty_bit. It must be as
// invisible to #just-connected as a *bot is: no login post, and no seat in the "N avatars
// in-world" tally that every human's login line carries.
func TestPresenceHiddenAvatarSuppressedAndUncounted(t *testing.T) {
	p, hook, _ := newTestPresence(t)
	oracle := &ClientSession{
		bridge: p.bridge, userRef: "user-oracle", UserName: "oracle", presenceHidden: true,
	}
	p.bridge.Sessions["oracle"] = oracle

	info := connectInfo("user-oracle", "oracle", "context-oraclehome")
	info.session = oracle // this arrival IS that session, not a concurrent one
	info.hidden = true
	p.noteConnect(info)
	if posts := hook.posts(); len(posts) != 0 {
		t.Fatalf("hidden avatar login must be silent; got %v", posts)
	}
	p.mu.Lock()
	reason := p.history[len(p.history)-1].Reason
	p.mu.Unlock()
	if reason != "hidden" {
		t.Fatalf("reason = %q, want hidden", reason)
	}

	p.noteConnect(connectInfo("user-randy", "Randy", "context-Downtown_4f"))
	posts := hook.posts()
	if len(posts) != 1 {
		t.Fatalf("human login must post; got %v", posts)
	}
	if !strings.Contains(posts[0], "1 avatar in-world") {
		t.Fatalf("hidden avatar must not inflate the count: %q", posts[0])
	}
}

// The bit is read off the arrival make, not off a name — 1<<29 is Constants.HIDDEN_AVATAR (30)
// through packBits' 1-based mapping. An avatar with other nitty_bits set stays visible.
func TestModIsHiddenAvatar(t *testing.T) {
	if modIsHiddenAvatar(nil) {
		t.Fatal("nil mod must not be hidden")
	}
	if modIsHiddenAvatar(&HabitatMod{}) {
		t.Fatal("absent nitty_bits must not be hidden")
	}
	if modIsHiddenAvatar(&HabitatMod{NittyBits: Int32P(1 << 3)}) { // GOD_FLAG (4)
		t.Fatal("an unrelated nitty_bit must not read as hidden")
	}
	if !modIsHiddenAvatar(&HabitatMod{NittyBits: Int32P(536870912)}) {
		t.Fatal("HIDDEN_AVATAR (536870912) must read as hidden")
	}
	if !modIsHiddenAvatar(&HabitatMod{NittyBits: Int32P(536870912 | 1<<3)}) {
		t.Fatal("HIDDEN_AVATAR alongside another bit must read as hidden")
	}
}
