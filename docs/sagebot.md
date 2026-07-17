# Sagebot — an LLM-driven Habitat resident

**Sagebot** (the Sage) is a fully autonomous, AI-driven citizen of NeoHabitat.
It wanders the world, keeps track of the avatars and objects around it, and
uses [Claude](https://www.anthropic.com/claude) to decide what to do and say —
in character, with persistent memory of the people it has met. When a new
avatar appears in its region it walks over and says hello; talk to it and it
answers.

It is, as far as we know, the first LLM agent living inside the world's first
graphical MMO — 1986 meets 2026.

## Meet the Sage

Just play ([any client](play.md)) and wander Populopolis — if the Sage is
about, it will likely find *you*. Speak to it like you'd speak to anyone.

## How it's built

Sagebot is the showcase for two reusable libraries in this repo:

### [habiworld](../habiworld/README.md) — the world model

The canonical client-side Habitat world model: feed it the server's message
stream and it maintains a faithful mirror of region state — object table,
container tree, avatar positions — **exactly the way the original 1986 C64
client did**, with every state delta ported from and cited against the
original C64 sources. The Sage's situational awareness ("who is here, what are
they holding, what just happened") is habiworld queries; the same library
powers the [web client](webclient.md), the [3D client](webclient3d.md), and
the [text client](../textclient/README.md).

### [habibots](../habibots/README.md) — the bot framework

The connection and agent layer: dialing the server through `bridge_v2`
(port 2026), region transit, reconnects, and high-level verb helpers
(`performVerb`, `getIntoHands`, `walkToExit`, `openDoor`, …). Sagebot's Claude
tool catalogue maps straight onto these helpers, so the model acts in the
world with the same verbs a human player has.

On top of those, the Sage adds ([habibots/bots/sage.js](../habibots/bots/sage.js)):

- **awareness** — synthesizes the habiworld state into a scene description for the prompt;
- **memory** — Mongo-backed persistent memory of avatars and conversations;
- **tools** — the Claude tool catalogue + dispatcher (speak, walk, emote, …);
- **anti-loop guards** — bot-to-bot silence, greeting cooldowns, rate limits.

## Run your own

With [your own server](run-your-own-server.md) up:

```sh
export ANTHROPIC_API_KEY=sk-ant-...   # or set it in .env
cd habibots && npm install
./run sage --persona "a curious old-timer of Habitat who's seen it all"
```

Options: `ANTHROPIC_MODEL` (default `claude-haiku-4-5-20251001`),
`HABIBOTS_MONGO_URL` for the memory store, `--wander-seconds` for roaming
cadence. See [habibots/README.md](../habibots/README.md) and
[.env.example](../.env.example).
