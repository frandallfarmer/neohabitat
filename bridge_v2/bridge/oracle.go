package bridge

import (
	"strings"
	"sync"

	"github.com/rs/zerolog/log"
	"go.mongodb.org/mongo-driver/bson"
)

// Oracle-request relay: speech sent TO oracular objects — ASK on a Fountain / Crystal_ball /
// Bureaucrat, WISH on a Magic_lamp's genie — is posted to the Discord "oracle-requests"
// channel so operators can play Oracle. This is the bridge-side realization of the elko
// message_to_god stub (HabitatMod.java: "full implementation when CLASS_ORACLE is ported").
// Second producer on the shared DiscordNotifier; same bot exclusion as presence alerts.

const oracleChannel = "oracle-requests"

// oracleIcons keys on the target's mod type (Mods[0].Type in the object doc).
var oracleIcons = map[string]string{
	"Fountain":     "⛲",
	"Crystal_ball": "🔮",
	"Magic_lamp":   "🧞",
	"Bureaucrat":   "📋",
}

const oracleDefaultIcon = "💬"

// oracleTextMax bounds the quoted question (Discord caps content at 2000; C64 balloons are
// far shorter, but the JSON path takes arbitrary client text).
const oracleTextMax = 300

// oracleAsk carries one request, captured under the session's stateMu.
type oracleAsk struct {
	userRef   string
	name      string
	regionRef string
	targetRef string
	verb      string // "ASK" | "WISH"
	text      string
}

type oracleRelay struct {
	presence *presenceRegistry // shared bot exclusion + region-name cache
	notifier *DiscordNotifier

	mu         sync.Mutex
	classCache map[string]string // target ref → mod type ("Fountain", …)
}

func newOracleRelay(presence *presenceRegistry, notifier *DiscordNotifier) *oracleRelay {
	return &oracleRelay{
		presence:   presence,
		notifier:   notifier,
		classCache: map[string]string{},
	}
}

// relay posts one oracle request. Runs on its own goroutine (Mongo lookup + shared caches);
// always logs the structured oracle_request line, even when the channel is unconfigured or
// the asker is a bot.
func (o *oracleRelay) relay(ask oracleAsk) {
	if o == nil {
		return
	}
	text := strings.TrimSpace(ask.text)
	if text == "" {
		return
	}
	if runes := []rune(text); len(runes) > oracleTextMax {
		text = string(runes[:oracleTextMax]) + "…"
	}
	class := o.targetClass(ask.targetRef)
	region := o.presence.regionName(ask.regionRef)
	bot := o.presence.isBot(ask.userRef, ask.name)
	posted := !bot && o.notifier.Enabled(oracleChannel)
	log.Info().
		Str("user_ref", ask.userRef).
		Str("name", ask.name).
		Str("verb", ask.verb).
		Str("target_ref", ask.targetRef).
		Str("class", class).
		Str("region", region).
		Str("text", text).
		Bool("posted", posted).
		Msg("oracle_request")
	if !posted {
		return
	}
	o.notifier.Post(oracleChannel, formatOracleRequest(ask.verb, ask.name, class, region, text))
}

// formatOracleRequest renders the channel line, e.g.:
//
//	⛲ **Randy** asks the Fountain in *Plaza Fountain*: “How do I remove a curse?”
//	🧞 **Randy** wishes upon the Magic Lamp in *Plaza West*: “a sword”
func formatOracleRequest(verb string, name string, class string, region string, text string) string {
	icon, ok := oracleIcons[class]
	if !ok {
		icon = oracleDefaultIcon
	}
	action := "asks the " + classDisplayName(class)
	if verb == "WISH" {
		action = "wishes upon the " + classDisplayName(class)
	}
	return icon + " **" + name + "** " + action + " in *" + region + "*: “" + text + "”"
}

// classDisplayName: "Crystal_ball" → "Crystal Ball"; unknown/empty → "Oracle".
func classDisplayName(class string) string {
	if class == "" {
		return "Oracle"
	}
	words := strings.Split(strings.ReplaceAll(class, "_", " "), " ")
	for i, w := range words {
		if w != "" {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// targetClass resolves the target ref's mod type from its object doc, cached forever (an
// object's class never changes). Empty when Mongo is unavailable or the ref is unknown
// (e.g. a runtime clone never checkpointed) — the formatter falls back to "Oracle"/💬.
func (o *oracleRelay) targetClass(ref string) string {
	if ref == "" {
		return ""
	}
	o.mu.Lock()
	cached, ok := o.classCache[ref]
	o.mu.Unlock()
	if ok {
		return cached
	}
	class := ""
	if b := o.presence.bridge; b != nil && b.MongoCollection != nil {
		obj := &HabitatObject{}
		if err := b.MongoCollection.FindOne(b.mongoCtx, bson.M{"ref": ref}).Decode(obj); err == nil &&
			len(obj.Mods) > 0 && obj.Mods[0].Type != nil {
			class = *obj.Mods[0].Type
		}
	}
	o.mu.Lock()
	o.classCache[ref] = class
	o.mu.Unlock()
	return class
}
