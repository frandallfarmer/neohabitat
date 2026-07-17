# Run your own NeoHabitat server

The whole stack — game server, protocol bridge, web clients, docent, bots —
runs from this repo with Docker Compose. Ten minutes from clone to a world of
your own.

## The architecture, in one picture

```
 C64 / VICE / U64 ──binary──┐
 web client ──ws :1987──────┤                        ┌────────────┐
 textclient / bots ─:2026───┼──►  bridge_v2  ──────► │  Habiproxy │──► Elko game
                            │   (Go protocol         │   :2018    │    server
                            │    bridge)             └────────────┘   (Java, src/)
                            │                                            │
   browser ──http :1701──► pushserver (Express)                       MongoDB
              (webclient, docent, help docs)                          (world DB)
```

**Everything connects through `bridge_v2`** — the Go protocol bridge that
maintains client sessions, speaks the 1986 binary protocol *and* the web
client's JSON protocol, and handles region-transit choreography. Clients and
bots never dial the Elko server directly.

## Quickstart (dev stack)

Prereqs: Docker + Docker Compose, git.

```sh
git clone https://github.com/frandallfarmer/neohabitat.git
cd neohabitat
cp .env.example .env          # optional: add ANTHROPIC_API_KEY etc. — see the file
docker compose up             # base + docker-compose.override.yml (auto-loaded)
```

That brings up:

| Service | What it is | Ports (host) |
|---|---|---|
| `neohabitat` | Elko game server + Habiproxy + pushserver (web/docent) | `1701` (http), `1987` (ws), `127.0.0.1:2018` (habiproxy), `127.0.0.1:5005` (JVM debug) |
| `bridge_v2` | the protocol bridge (dev image, hot-reload) | `2026` (clients/bots), `2027` (admin) |
| `neohabitatmongo` | MongoDB 7 world database | `127.0.0.1:27017` |
| `bots` | hatchery, eliza (+ sage with an API key) | — (dial `bridge_v2:2026`) |

First boot seeds the world database automatically. Working on the webclient or
libraries? Use the dev overlay, which bind-mounts the working tree for
edit-and-reload: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
(or just `./dev.sh`).

## Connect your clients

- **Web client (2D):** http://localhost:1701/webclient/ — set the WebSocket
  proxy to `ws://localhost:1987`, pick a context and avatar name, Connect.
  Docent-framed flow: http://localhost:1701/neohabitat.
- **3D client:** http://localhost:1701/webclient/live3d.html.
- **Text client:** `node textclient/index.js -c context-Downtown_5f -u myname`
  (defaults to the dev bridge at `127.0.0.1:2026`).
- **VICE / C64:** point the emulator's network at the bridge:
  `x64 -rsuser -rsuserdev 0 -rsdev1 '|nc 127.0.0.1 2026' -rsuserbaud 1200 -flipname fliplist-C64.vfl Habitat-Boot.d64`
  (the public server also exposes the classic port `1986`; both speak the same
  binary protocol). Disks: see [c64-clients.md](c64-clients.md).
- **Ultimate 64:** set your server address in the modem config per the
  [U64 guide](https://github.com/ssalevan/habiclient/blob/main/docs/U64.md).
- **Your own bot:** see [habibots](../habibots/README.md) — and remember, bots
  dial the bridge (`:2026`), never Elko.

## Configuration

`.env` (copied from [`.env.example`](../.env.example)) is loaded by every
compose service and by `habibots/run`. Notables: `ANTHROPIC_API_KEY` (enables
[Sagebot](sagebot.md)), `HABIBOTS_SLACK_TOKEN`, per-bot region/user overrides.
The file documents itself.

## Production notes

Our production deployment (habitat.themade.org) differs from dev in two ways:

1. **`docker-compose.prod.yml`** — production config for the game/web
   services, plus **Caddy** terminating TLS on :443 in front of the pushserver
   (`caddy/Caddyfile` routes `/neohabitat`, `/webclient`, `/ws`, docent SSE, …):
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
2. **`bridge_v2` runs on the host, not in Docker** — as a systemd service
   (listening on `1337`/`1986`/`2026`), because its zero-downtime restart
   mechanism (tableflip re-exec on SIGHUP) is incompatible with Docker's
   PID-1 lifecycle. The [`ansible/`](../ansible/README.md) roles build the
   binary, install the unit, and manage deploys.

Observability sidecars (Grafana Cloud OTLP + log shipping) are optional:
[`monitoring/README.md`](../monitoring/README.md).

## The legacy path (historical)

The original 2017-era setup — QuantumLink Reloaded, MySQL, port 5190, Vagrant —
is **obsolete**: the modern client path bypasses Q-Link entirely. The old guide
is preserved in
[neohabitat-doc/getting_started.md](https://github.com/frandallfarmer/neohabitat-doc/blob/master/docs/getting_started.md)
for the curious.

## Going deeper

- [PROTOCOL.md](../PROTOCOL.md) — the wire protocol.
- [bridge_v2/](../bridge_v2/) — bridge internals (catch-up interlock, Discord
  alerts, QLink framing).
- The Elko server sources live in `src/main/java/org/made/neohabitat/`.
- Questions? [Discord](https://discord.gg/rspcX27Vt4) **#developers**.
