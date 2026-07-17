# Experiments — alternate clients, agents & tools

NeoHabitat is a living research project as much as a game. Beyond the
[standard clients](play.md), these are the experimental clients, agents, and
tools that orbit the world. Everything here is functional but evolving —
expect rough edges, and bring your findings to the
[Discord](https://discord.gg/rspcX27Vt4).

## ⭐ Sagebot — an LLM lives in Habitat

An autonomous, Claude-driven resident that wanders the world, remembers who it
meets, and converses in character — built on the **habibots** framework and
the **habiworld** world model. The flagship experiment.

👉 **[sagebot.md](sagebot.md)**

## 3D "Diorama" web client

The web client re-presented as a fixed-camera 3D set: real floor and wall
geometry, billboarded avatars and props, neighbor regions visible down the
street. Same world model, swapped renderer.

👉 **[webclient3d.md](webclient3d.md)** · play at [habitat.themade.org/neohabitat3d](http://habitat.themade.org/neohabitat3d)

## Text client

Habitat as a MUD: a human-driven, text-only terminal client that narrates
everything around you and takes verb-first commands (`GO`, `GET`, `SAY`,
`ESP`, …) targeting objects by name or noid.

👉 **[textclient/README.md](../textclient/README.md)**

## The Inspector

A browser app for exploring (and editing!) the original Habitat art and
regions: region gallery, avatar bodies, the Hall of Heads, props, beta-only
art, and a **region editor** whose output you can import into a NeoHabitat
server. Lives in the [neohabitat-doc](https://github.com/frandallfarmer/neohabitat-doc)
repo.

👉 **[Inspector app](https://frandallfarmer.github.io/neohabitat-doc/inspector/)** ·
[source](https://github.com/frandallfarmer/neohabitat-doc/tree/master/inspector)

## habibots — the bot framework

Write your own in-world bot in a few dozen lines of Node: connection, region
transit, world model, and verb helpers are all handled. Ships with `hatchery`,
`eliza`, `oracle`, `greeter`, and friends.

👉 **[habibots/README.md](../habibots/README.md)**

## habisound — the 1986 SID driver in your browser

A JS port of Habitat's original C64 sound driver that plays the actual 1986
`sfx.m` bytecode through Web Audio.

👉 **[habisound/README.md](../habisound/README.md)** ·
[Soundboard demo](https://frandallfarmer.github.io/neohabitat-doc/docs/sounds/)

## Region & protocol tooling

- **[regionator](../regionator/README.md)** — compile human-writable `.rdl`
  region description files into NeoHabitat JSON regions.
- **[log-parser](../tools/log-parser/README.md)** — decode and analyze
  Habitat protocol traffic from server logs.
- **[tools/](../tools/README.md)** — VICE login automation, the Book of
  Records generator, welcomebot, and other operational odds and ends.
- **[mamelink](https://github.com/frandallfarmer/neohabitat-doc/tree/master/mamelink)** —
  C tooling for linking an emulated machine to Habitat (the "reno"/"griddle"
  lineage), in the neohabitat-doc repo.

## Under it all

- **[PROTOCOL.md](../PROTOCOL.md)** — the Habitat/Elko wire protocol reference.
- **[bridge_v2](../bridge_v2/)** — the Go protocol bridge every client and bot
  connects through; see [run-your-own-server.md](run-your-own-server.md).
