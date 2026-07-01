# Discord Alerts — bridge_v2's channel framework

*Shipped 2026-07-01; validated live on prod (logins + oracle-requests channels).*

bridge_v2 posts game events to themade.org's Discord through a small, generic,
multi-channel webhook layer. Two producers exist today; the layer is designed so the
next one is a one-file change. This document is the map for future hookups.

## Architecture

```
                         ┌──────────────────────────────┐
  client_session.go ────▶│ producers                    │
   hooks (both protocol  │  presence.go  → "logins"     │
   paths: binary + JSON) │  oracle.go    → "oracle-     │
                         │                  requests"   │
                         └──────────────┬───────────────┘
                                        │ notifier.Post(channel, content)
                         ┌──────────────▼───────────────┐
                         │ discord.go — DiscordNotifier │
                         │  channels from env:          │
                         │   DISCORD_WEBHOOK_<NAME>     │
                         │  async queue (cap 64,        │
                         │  drop-on-full), 1 retry      │
                         │  honoring Retry-After,       │
                         │  allowed_mentions locked     │
                         └──────────────┬───────────────┘
                                        ▼
                              Discord webhook POST
```

**`discord.go` — the sink.** Channel names are discovered from the environment at
process start: every `DISCORD_WEBHOOK_<NAME>` variable defines one channel, suffix
lowercased with `_` → `-` (`DISCORD_WEBHOOK_ORACLE_REQUESTS` → `oracle-requests`).
`Post()` to an unconfigured channel is a silent no-op — **with no env vars set (the
dev default) the whole system is inert**. One worker goroutine drains a bounded
queue so a slow/down Discord can never block a session goroutine; overflow drops
with a warning (alerts are best-effort, gameplay is not). Player-controlled text
cannot ping the channel (`allowed_mentions: {parse: []}`).

**`presence.go` — login alerts → `logins`.**
`✨ **Randy** materializes in *Plaza West*… 🕹️ · 3 avatars in-world`

- Hook: once per session, at the first `make you:true`, on **both** protocol paths
  (binary `handleElkoMessage` and JSON `handleElkoMessageJson` — a you-make fires on
  every region entry; the `presenceAnnounced` latch keeps only the login).
- Suppression order: another live session for the same user (takeover/second window)
  → 5-minute debounce since the user's last disconnect → `*bot` names +
  `DISCORD_ALERT_EXCLUDE` (comma list, for bots not ending in "bot").
- Bots are also excluded from the "avatars in-world" count.
- Variants: `at *their turf*` when the entry region is the user's turf; 🎉 hatched
  fanfare for brand-new users; 🕹️ = binary/C64 path, 🌐 = web/JSON path.
- Disconnects are recorded (they arm the debounce) but **never posted**.
- History: 500-event ring at admin `GET /presence` (port 2027) + a structured
  `presence_event` log line per event (journald → promtail → Loki), including
  suppressed ones with their reason.
- Tableflip continuity: the debounce map + per-session latches ride the handoff
  manifest, and JSON sessions skipped by the snapshot are pre-stamped — a deploy's
  reconnect wave stays off Discord.

**`oracle.go` — oracular speech → `oracle-requests`.**
`⛲ **Randy** asks the Fountain in *Plaza Fountain*: “How do I remove a curse?”`

- Hook: client→elko **ASK** and **WISH** ops on both paths (binary: after translator
  in `handleClientMessage`; JSON: at parse in `runJsonPassthrough`, observation only —
  the line still relays verbatim).
- This is the working realization of elko's `message_to_god` stub
  (`HabitatMod.java`: *"full implementation when CLASS_ORACLE is ported"*) — done
  bridge-side, zero elko changes.
- Covered classes / icons: ⛲ `Fountain`, 🔮 `Crystal_ball`, 🧞 `Magic_lamp` (WISH →
  "wishes upon"), 📋 `Bureaucrat` — including its `COMPLAINT:` moderator-help command,
  which is just an ASK; the prefix stays visible in the quote. Unknown classes fall
  back to 💬 / "Oracle". Class comes from the target's object doc (`Mods[0].Type`),
  cached.
- Bot askers are excluded (same rule as presence). Text is trimmed, truncated at 300
  runes, quoted. Every request also logs a structured `oracle_request` line whether
  or not it posts.

## Configuration & secrets (prod-only by design)

themade.org's Discord is public — **dev stacks must never set `DISCORD_WEBHOOK_*`**.
The flow, end to end:

1. GitHub repo secret `DISCORD_WEBHOOK_<NAME>` (webhook URL from Discord: channel →
   Settings → Integrations → Webhooks; the webhook's display name/avatar is set there).
2. `.github/workflows/build-and-push.yml` deploy step passes it through as env.
3. `ansible/playbooks/deploy.yml` renders it into `/etc/neohabitat/alerts.env` (0600).
4. `ansible/roles/bridge_host/templates/bridge_v2.service.j2` loads it via
   `EnvironmentFile=-/etc/neohabitat/alerts.env`.

⚠️ **Env is read once at process start.** A SIGHUP/tableflip re-exec inherits the OLD
environment, so a changed `alerts.env` needs a **hard restart** — deploy.yml already
has the restart→reload task keyed on the file changing. A hard restart drops live
sessions (including TCP_REPAIR'd C64s); steady-state deploys with an unchanged
alerts.env stay on the seamless tableflip path.

`DISCORD_ALERT_EXCLUDE` (optional, comma-separated names/refs) extends the `*bot`
exclusion for bots whose names don't end in "bot".

## Adding a channel (the recipe)

1. Create the webhook in Discord; `gh secret set DISCORD_WEBHOOK_<NAME> --body "<url>"`.
2. One env lookup + one line in the `alerts.env` content block
   (`ansible/playbooks/deploy.yml`).
3. One env line in the CI deploy step (`.github/workflows/build-and-push.yml`).
4. Write a producer that calls `notifier.Post("<name>", content)` — see `oracle.go`
   for the shape (a small struct captured under the session's `stateMu`, the decision
   + Mongo lookups + post on their own goroutine, a structured log line always).

The notifier itself never changes.

## Testing

- Unit: `presence_test.go` / `oracle_test.go` — the `capturingWebhook` httptest helper
  plays Discord; `newTestPresence`/`newTestOracle` give a fake clock and a
  Mongo-less bridge (region names fall back to prettified refs).
- Live, without touching the real Discord: run the local stack, point the env var at
  a local capture server, and drive a login / ASK through the bridge's JSON port.
  Never post test traffic to the public channels.

## Future hookup candidates

- **Server-internal `message_to_god` events** — "Tome Recovered!" and
  `"UNAUTHORIZED USE OF A GOD TOOL!"` (`Magical.java`) never pass through client
  speech, so the bridge can't see them; catching them means implementing
  `message_to_god` in elko (needs sign-off) and probably a third ops/security
  channel.
- **Oracle *answers*** — two-way flow (operator replies in Discord → in-game
  `object_say`) would need an inbound bot/webhook listener, a bigger design.
- **"Where is everyone?" (issue #245)** — the `GET /presence` endpoint already
  exposes who's online + regions; an in-game or /status rendering can build on it.
- Known gap: the webclient's genie flow is broken (issue #607), so `WISH` relay is
  unit-tested but not yet live-verified.
