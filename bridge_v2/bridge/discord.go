package bridge

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// DiscordNotifier posts messages to named Discord channels via webhooks. It is a generic
// sink — producers (presence alerts today, oracle-request relays tomorrow) address a channel
// by NAME and never see webhook URLs. Channels come from the environment: every
// DISCORD_WEBHOOK_<NAME> variable defines one, with the suffix lowercased and underscores
// dashed (DISCORD_WEBHOOK_LOGINS → "logins", DISCORD_WEBHOOK_ORACLE_REQUESTS →
// "oracle-requests"). With no such variables set — the dev default; themade.org's Discord is
// public and must not get dev traffic — every Post is a silent no-op.
//
// Delivery is decoupled from callers by a single worker goroutine and a bounded queue:
// a slow or down Discord can never block a session goroutine. When the queue is full the
// message is dropped (with a warning) — alerts are best-effort, gameplay is not.
type DiscordNotifier struct {
	channels map[string]string
	queue    chan discordPost
	client   *http.Client
}

type discordPost struct {
	channel string
	content string
}

const (
	discordEnvPrefix   = "DISCORD_WEBHOOK_"
	discordQueueCap    = 64
	discordHTTPTimeout = 10 * time.Second
	discordRetryCap    = 5 * time.Second
)

// NewDiscordNotifierFromEnv builds a notifier from all DISCORD_WEBHOOK_* variables.
func NewDiscordNotifierFromEnv() *DiscordNotifier {
	channels := map[string]string{}
	for _, kv := range os.Environ() {
		k, v, ok := strings.Cut(kv, "=")
		if !ok || v == "" || !strings.HasPrefix(k, discordEnvPrefix) {
			continue
		}
		name := strings.ReplaceAll(strings.ToLower(strings.TrimPrefix(k, discordEnvPrefix)), "_", "-")
		if name != "" {
			channels[name] = v
		}
	}
	return NewDiscordNotifier(channels)
}

// NewDiscordNotifier builds a notifier for an explicit channel→webhook-URL map (the
// env-independent constructor, used by tests). Only channel NAMES are ever logged.
func NewDiscordNotifier(channels map[string]string) *DiscordNotifier {
	d := &DiscordNotifier{
		channels: channels,
		client:   &http.Client{Timeout: discordHTTPTimeout},
	}
	if len(channels) > 0 {
		names := make([]string, 0, len(channels))
		for name := range channels {
			names = append(names, name)
		}
		log.Info().Strs("channels", names).Msg("Discord notifier enabled")
		d.queue = make(chan discordPost, discordQueueCap)
		go d.run()
	}
	return d
}

// Enabled reports whether a named channel is configured.
func (d *DiscordNotifier) Enabled(channel string) bool {
	if d == nil {
		return false
	}
	_, ok := d.channels[channel]
	return ok
}

// Post enqueues content for a named channel. No-op (never an error) when the notifier or
// the channel is unconfigured; drops with a warning when the queue is full.
func (d *DiscordNotifier) Post(channel string, content string) {
	if d == nil || d.queue == nil || !d.Enabled(channel) {
		return
	}
	select {
	case d.queue <- discordPost{channel: channel, content: content}:
	default:
		log.Warn().Str("channel", channel).Msg("Discord queue full; dropping message")
	}
}

func (d *DiscordNotifier) run() {
	for p := range d.queue {
		d.deliver(p)
	}
}

func (d *DiscordNotifier) deliver(p discordPost) {
	// allowed_mentions:[] so an avatar named "@everyone" (or containing any mention) can
	// never ping the channel — names are player-controlled input.
	body, err := json.Marshal(map[string]interface{}{
		"content":          p.content,
		"allowed_mentions": map[string]interface{}{"parse": []string{}},
	})
	if err != nil {
		log.Error().Err(err).Str("channel", p.channel).Msg("Could not marshal Discord message")
		return
	}
	for attempt := 0; attempt < 2; attempt++ {
		resp, perr := d.client.Post(d.channels[p.channel], "application/json", bytes.NewReader(body))
		if perr != nil {
			log.Warn().Err(perr).Str("channel", p.channel).Int("attempt", attempt).
				Msg("Discord webhook POST failed")
			return
		}
		retryable := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
		retryAfter := resp.Header.Get("Retry-After")
		resp.Body.Close()
		if resp.StatusCode < 300 {
			return
		}
		log.Warn().Int("status", resp.StatusCode).Str("channel", p.channel).Int("attempt", attempt).
			Msg("Discord webhook rejected message")
		if !retryable || attempt > 0 {
			return
		}
		delay := time.Second
		if secs, aerr := strconv.ParseFloat(retryAfter, 64); aerr == nil && secs > 0 {
			delay = time.Duration(secs * float64(time.Second))
		}
		if delay > discordRetryCap {
			delay = discordRetryCap
		}
		time.Sleep(delay)
	}
}
