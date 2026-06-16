# textclient — a text-only terminal client for NeoHabitat

A human-driven, text-only client for the Habitat world. It is a
[`HabiBot`](../habibots/habibot.js) wired to a terminal instead of a bot
loop: it **narrates** everything happening around you (speech, emotes,
arrivals/departures, sounds, object changes, room contents) and accepts
**verb-first commands** (`GO`, `GET`, `SAY`, …) that operate on objects by
**name or noid**.

It is built entirely on top of the existing libraries and changes none of
them:

- **`habibots/habibot.js`** — connection, reconnect, region transit, the
  `habiworld` world model, and the verb helpers (`performVerb`,
  `getIntoHands`, `walkToExit`, `openDoor`, `readObject`, …).
- **`habiworld`** — the canonical client-side world model and behavior
  dispatcher.

> **Project rule:** the text client is purely additive. We do **not** modify
> `habibots/` or `habiworld/` from here without explicit permission and a
> compatibility check against `habibots`/`sagebot`. The client only consumes
> the public `HabiBot` API.

## Running

No dependencies to install — the only third-party modules used belong to
`HabiBot` and resolve from `habibots/node_modules` automatically.

```sh
node textclient/index.js -c context-Downtown_5f -u myname
```

Connects to the dev bridge at `127.0.0.1:2026` by default (the
`bridge_v2` port from `docker-compose.dev.yml`; bots always dial the
bridge, never elko directly). Override with flags:

```
-c, --context    region context to enter (required), e.g. context-Downtown_5f
-u, --username   avatar username (required)
-h, --host       server/bridge host (default 127.0.0.1)
-p, --port       server/bridge port (default 2026)
    --loglevel   HabiBot log level: error|warn|info|debug (default warn)
```

Make sure elko + `bridge_v2` are up first (e.g.
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`).

## Commands

Targets accept a **name or a noid** — `LOOK` lists both. A line whose first
word is not a known command is spoken aloud.

| Command | Effect |
|---|---|
| `LOOK` / `L` | describe the room: exits, people, objects, your inventory |
| `GO <dir\|name\|noid>` | walk to an exit (`UP/DOWN/LEFT/RIGHT` or `N/E/S/W`) or to an object |
| `GET <name\|noid>` | pick an item up into your hands |
| `DROP` / `PUT [tgt] [x y]` | drop what you hold — on the floor, or into a named container |
| `SAY <text>` | speak aloud (bare lines are spoken too) |
| `ESP` / `WHISPER <who> <text>` | private telepathic message |
| `OPEN` / `CLOSE <tgt>` | open/close a door or container |
| `READ <tgt> [page]` | read a book / paper / sign / plaque |
| `DO <tgt> [text]` | the universal Habitat DO verb |
| `TALK <tgt> <text>` | talk to an object (oracle, teleport, elevator, …) |
| `SIT <tgt>` / `STAND` | sit on furniture / stand up |
| `GIVE <avatar>` | hand what you hold to an avatar |
| `GRAB <avatar>` | take what an avatar is holding |
| `TOUCH <avatar>` | a friendly touch |
| `FACE <dir>` | turn `LEFT/RIGHT/FORWARD/BEHIND` |
| `WAVE` `JUMP` `FROWN` `POINT` `PUNCH` `BEND_OVER` `STAND_UP` `EXTEND_HAND` | postures / emotes |
| `INV` / `I` | list what you are carrying |
| `WHO` | who is online |
| `GHOST` / `CORPORATE` | toggle ghost form |
| `HELP` / `?` | in-world command list |
| `QUIT` / `EXIT` | leave |

## Layout

```
index.js        entrypoint: args, HabiBot wiring, readline loop
lib/render.js   inbound elko op  → narration line (verbose)
lib/commands.js command parser + dispatch; LOOK scene renderer
lib/resolve.js  "name or noid" → habiworld record
```
