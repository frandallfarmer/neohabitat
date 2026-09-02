package bridge

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"go.mongodb.org/mongo-driver/bson"
)

// Presence alerting: post to the Discord "logins" channel when a human logs in, debounced so
// reconnect churn (page refreshes, deploy reconnects, crash-retry loops) stays silent. Every
// connect AND disconnect — including suppressed and bot ones — is recorded in an in-memory
// history ring (served at the admin /presence endpoint) and as a structured `presence_event`
// log line (journald → Loki), which together are the alert framework's durable history;
// disconnects are never posted to Discord.

const (
	presenceDebounceWindow = 5 * time.Minute
	presenceHistoryCap     = 500
	presenceLoginsChannel  = "logins"
	// presenceDebouncePruneLen bounds lastDisconnect: past this, expired entries are pruned.
	presenceDebouncePruneLen = 1024
)

// PresenceEvent is one connect/disconnect observation, JSON-shaped for /presence.
type PresenceEvent struct {
	Time      time.Time `json:"time"`
	Kind      string    `json:"kind"` // "connect" | "disconnect"
	UserRef   string    `json:"user_ref"`
	Name      string    `json:"name"`
	RegionRef string    `json:"region_ref,omitempty"`
	Region    string    `json:"region,omitempty"` // display name, or "their turf"
	Client    string    `json:"client,omitempty"` // "c64" | "web"
	IP        string    `json:"ip,omitempty"`     // origin address (PROXY-header-aware)
	Alerted   bool      `json:"alerted"`
	Reason    string    `json:"reason,omitempty"` // why a connect was NOT posted
}

// presenceConnect carries a session's login facts, captured under its stateMu at arrival time
// so the async alert path never touches session state.
type presenceConnect struct {
	session   *ClientSession
	userRef   string
	name      string
	regionRef string
	turfRef   string
	newUser   bool
	json      bool
	ip        string
	// hidden: the arriving avatar carries elko's HIDDEN_AVATAR nitty_bit — a service
	// avatar (the Oracle) that elko already keeps out of Region.NameToUser.
	hidden bool
}

type presenceRegistry struct {
	bridge   *Bridge
	notifier *DiscordNotifier
	exclude  map[string]struct{}
	now      func() time.Time // test seam

	mu             sync.Mutex
	lastDisconnect map[string]time.Time
	regionNames    map[string]string
	history        []PresenceEvent
}

// newPresenceRegistry wires the presence producer. DISCORD_ALERT_EXCLUDE (comma-separated
// names/userRefs) supplements the built-in `*bot` exclusion for bots whose names don't end
// in "bot".
func newPresenceRegistry(b *Bridge, notifier *DiscordNotifier) *presenceRegistry {
	exclude := map[string]struct{}{}
	for _, name := range strings.Split(os.Getenv("DISCORD_ALERT_EXCLUDE"), ",") {
		if name = strings.TrimSpace(strings.ToLower(name)); name != "" {
			exclude[strings.TrimPrefix(name, "user-")] = struct{}{}
		}
	}
	return &presenceRegistry{
		bridge:         b,
		notifier:       notifier,
		exclude:        exclude,
		now:            time.Now,
		lastDisconnect: map[string]time.Time{},
		regionNames:    map[string]string{},
	}
}

// hiddenAvatarBit is elko's Constants.HIDDEN_AVATAR (nitty_bit 30). The bit constants are
// 1-based (inherited from PL/1), and HabitatMod.packBits maps bit N to 1<<(N-1), so 30 is
// 1<<29. Elko keeps such an avatar out of Region.NameToUser — the table behind the F3 list,
// /online counts, ESP and tellEveryone — so presence honours the same bit: a hidden service
// avatar neither announces itself in the logins channel nor counts toward "N in-world".
const hiddenAvatarBit int32 = 1 << 29

// modIsHiddenAvatar reads that bit off an own-avatar (you:true) make. Avatar.encode emits
// nitty_bits whenever the packed value is non-zero, on the client control path as well as the
// durable one, so the bridge sees it on arrival without consulting Mongo.
func modIsHiddenAvatar(mod *HabitatMod) bool {
	return mod != nil && mod.NittyBits != nil && *mod.NittyBits&hiddenAvatarBit != 0
}

// isBot: `*bot` names (welcomebot, elizabot, sagebot…) and DISCORD_ALERT_EXCLUDE entries are
// excluded from channel posts AND from the in-world avatar count (humans only). Hidden
// service avatars get the same treatment via modIsHiddenAvatar, keyed on state rather than
// on a name — see hiddenAvatarBit.
func (p *presenceRegistry) isBot(userRef string, name string) bool {
	for _, id := range []string{userRef, name} {
		id = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(id)), "user-")
		if id == "" {
			continue
		}
		if strings.HasSuffix(id, "bot") {
			return true
		}
		if _, ok := p.exclude[id]; ok {
			return true
		}
	}
	return false
}

// noteConnect decides whether this login gets posted, and records it in history either way.
// Runs on its own goroutine (it takes sessionsMutex and other sessions' stateMu).
func (p *presenceRegistry) noteConnect(info presenceConnect) {
	if p == nil || info.userRef == "" {
		return
	}
	now := p.now()
	concurrent, humans := p.scanSessions(info)

	reason := ""
	switch {
	case concurrent:
		// Another live session for this user (second window, takeover, supersede race):
		// they were already in-world, so this is not a fresh arrival.
		reason = "concurrent-session"
	default:
		p.mu.Lock()
		if t, ok := p.lastDisconnect[info.userRef]; ok && now.Sub(t) < presenceDebounceWindow {
			reason = "debounce"
		}
		p.mu.Unlock()
	}
	if reason == "" {
		switch {
		case info.hidden:
			reason = "hidden"
		case p.isBot(info.userRef, info.name):
			reason = "bot"
		}
	}
	if reason == "" && !p.notifier.Enabled(presenceLoginsChannel) {
		reason = "disabled"
	}

	atTurf := info.turfRef != "" && info.turfRef == info.regionRef
	regionLabel := p.regionName(info.regionRef)
	eventRegion := regionLabel
	if atTurf {
		eventRegion = "their turf"
	}
	p.record(PresenceEvent{
		Time: now, Kind: "connect", UserRef: info.userRef, Name: info.name,
		RegionRef: info.regionRef, Region: eventRegion, Client: clientKind(info.json),
		IP: info.ip, Alerted: reason == "", Reason: reason,
	})
	if reason == "" {
		p.notifier.Post(presenceLoginsChannel, formatLoginAlert(info, regionLabel, atTurf, humans))
	}
}

// noteDisconnect stamps the debounce clock and records history. Never posts.
func (p *presenceRegistry) noteDisconnect(userRef string, name string, json bool, ip string) {
	if p == nil || userRef == "" {
		return
	}
	now := p.now()
	p.mu.Lock()
	p.lastDisconnect[userRef] = now
	if len(p.lastDisconnect) > presenceDebouncePruneLen {
		for ref, t := range p.lastDisconnect {
			if now.Sub(t) >= presenceDebounceWindow {
				delete(p.lastDisconnect, ref)
			}
		}
	}
	p.mu.Unlock()
	p.record(PresenceEvent{
		Time: now, Kind: "disconnect", UserRef: userRef, Name: name, Client: clientKind(json),
		IP: ip,
	})
}

// scanSessions reports whether another live session exists for this user, and the human
// (non-bot) in-world count INCLUDING the arriving user. Lock discipline: snapshot under
// sessionsMutex, release, then read each userRef under its own stateMu (never nested).
func (p *presenceRegistry) scanSessions(info presenceConnect) (concurrent bool, humans int) {
	seen := map[string]struct{}{}
	if !info.hidden && !p.isBot(info.userRef, info.name) {
		seen[info.userRef] = struct{}{}
	}
	if p.bridge != nil {
		p.bridge.sessionsMutex.Lock()
		others := make([]*ClientSession, 0, len(p.bridge.Sessions))
		for _, s := range p.bridge.Sessions {
			if s != info.session {
				others = append(others, s)
			}
		}
		p.bridge.sessionsMutex.Unlock()
		for _, s := range others {
			s.stateMu.Lock()
			ref, name, hidden := s.userRef, s.UserName, s.presenceHidden
			s.stateMu.Unlock()
			if ref == "" {
				continue
			}
			if ref == info.userRef {
				concurrent = true
			}
			if !hidden && !p.isBot(ref, name) {
				seen[ref] = struct{}{}
			}
		}
	}
	return concurrent, len(seen)
}

func clientKind(json bool) string {
	if json {
		return "web"
	}
	return "c64"
}

// formatLoginAlert renders the lore-flavored one-liner:
//
//	✨ **Randy** materializes in *Plaza West*… 🕹️ · 3 avatars in-world
//	✨ **Chip** materializes at *their turf*… 🌐 · 2 avatars in-world
//	🎉 A new avatar has been hatched: **Name** — materializing in *The Fountain*… 🌐 · 1 avatar in-world
func formatLoginAlert(info presenceConnect, regionLabel string, atTurf bool, humans int) string {
	place := "in *" + regionLabel + "*"
	if atTurf {
		place = "at *their turf*"
	}
	icon := "🕹️"
	if info.json {
		icon = "🌐"
	}
	plural := "s"
	if humans == 1 {
		plural = ""
	}
	var b strings.Builder
	if info.newUser {
		b.WriteString("🎉 A new avatar has been hatched: **")
		b.WriteString(info.name)
		b.WriteString("** — materializing ")
	} else {
		b.WriteString("✨ **")
		b.WriteString(info.name)
		b.WriteString("** materializes ")
	}
	b.WriteString(place)
	b.WriteString("… ")
	b.WriteString(icon)
	b.WriteString(" · ")
	b.WriteString(strconv.Itoa(humans))
	b.WriteString(" avatar")
	b.WriteString(plural)
	b.WriteString(" in-world")
	return b.String()
}

// regionName resolves a context ref to its human-readable name ("context-Downtown_4f" →
// "Plaza West") via the region doc's top-level `name`, cached forever (region names are
// static seed data). Fallback when Mongo is unavailable or the doc is nameless: a prettified
// ref ("Downtown 4f").
func (p *presenceRegistry) regionName(ref string) string {
	if ref == "" {
		return "parts unknown"
	}
	p.mu.Lock()
	cached, ok := p.regionNames[ref]
	p.mu.Unlock()
	if ok {
		return cached
	}
	name := ""
	if p.bridge != nil && p.bridge.MongoCollection != nil {
		obj := &HabitatObject{}
		err := p.bridge.MongoCollection.
			FindOne(p.bridge.mongoCtx, bson.M{"ref": ref}).
			Decode(obj)
		if err == nil {
			name = strings.TrimSpace(obj.Name)
		}
	}
	if name == "" {
		name = prettifyContextRef(ref)
	}
	p.mu.Lock()
	p.regionNames[ref] = name
	p.mu.Unlock()
	return name
}

func prettifyContextRef(ref string) string {
	name := strings.TrimPrefix(ref, "context-")
	name = strings.NewReplacer("_", " ", ".", " ").Replace(name)
	return strings.TrimSpace(name)
}

// record appends to the history ring and emits the structured presence_event log line
// (journald → promtail → Loki carries the durable history).
func (p *presenceRegistry) record(ev PresenceEvent) {
	p.mu.Lock()
	p.history = append(p.history, ev)
	if len(p.history) > presenceHistoryCap {
		p.history = p.history[len(p.history)-presenceHistoryCap:]
	}
	p.mu.Unlock()
	log.Info().
		Str("kind", ev.Kind).
		Str("user_ref", ev.UserRef).
		Str("name", ev.Name).
		Str("region_ref", ev.RegionRef).
		Str("region", ev.Region).
		Str("client", ev.Client).
		Str("ip", ev.IP).
		Bool("alerted", ev.Alerted).
		Str("reason", ev.Reason).
		Msg("presence_event")
}

// exportDebounce / importDebounce carry the debounce clock across a tableflip handoff so a
// deploy's reconnect wave doesn't re-announce everyone (unix seconds; JSON-manifest-safe).
func (p *presenceRegistry) exportDebounce() map[string]int64 {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string]int64, len(p.lastDisconnect))
	for ref, t := range p.lastDisconnect {
		out[ref] = t.Unix()
	}
	return out
}

func (p *presenceRegistry) importDebounce(m map[string]int64) {
	if p == nil || len(m) == 0 {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for ref, unix := range m {
		t := time.Unix(unix, 0)
		if existing, ok := p.lastDisconnect[ref]; !ok || t.After(existing) {
			p.lastDisconnect[ref] = t
		}
	}
}

// ImportPresenceDebounce restores the debounce clock from a handoff manifest.
func (b *Bridge) ImportPresenceDebounce(m map[string]int64) {
	if b == nil || b.presence == nil {
		return
	}
	b.presence.importDebounce(m)
}

// PresenceHandler serves GET /presence on the admin mux: who is online now plus the recent
// event history (alerted and suppressed alike).
func (b *Bridge) PresenceHandler() http.Handler {
	type onlineEntry struct {
		Name      string `json:"name"`
		UserRef   string `json:"user_ref"`
		RegionRef string `json:"region_ref,omitempty"`
		Client    string `json:"client"`
		SessionID string `json:"session_id"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var online []onlineEntry
		b.sessionsMutex.Lock()
		sessions := make([]*ClientSession, 0, len(b.Sessions))
		for _, s := range b.Sessions {
			sessions = append(sessions, s)
		}
		b.sessionsMutex.Unlock()
		for _, s := range sessions {
			s.stateMu.Lock()
			entry := onlineEntry{
				Name: s.UserName, UserRef: s.userRef, RegionRef: s.regionRef,
				Client: clientKind(s.jsonPassthrough), SessionID: s.sessionID,
			}
			s.stateMu.Unlock()
			if entry.UserRef != "" {
				online = append(online, entry)
			}
		}
		var events []PresenceEvent
		if b.presence != nil {
			b.presence.mu.Lock()
			events = append(events, b.presence.history...)
			b.presence.mu.Unlock()
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"online": online,
			"events": events,
		})
	})
}
