# The 3D "Diorama" web client (experimental)

A second, **3D-native** presentation of the NeoHabitat web client: each region
is drawn as a **fixed-camera 3D diorama** — a real floor receding to a real
back wall, with props and avatars as depth-sorted billboards standing on that
geometry — instead of the flat 2D scene.

**Try it:**

| URL | |
|---|---|
| **[habitat.themade.org/neohabitat3d](http://habitat.themade.org/neohabitat3d)** | 3D client + Docent guide |
| **[habitat.themade.org/webclient/live3d.html](https://habitat.themade.org/webclient/live3d.html)** | 3D client full-page |

Enter your avatar name at the title screen — it's the same world and the same
account as every other client.

## Why this works

Habitat was *already 2.5-D* in 1986: an object's `y` coordinate doubles as
depth, and every region is a single-wall theater set viewed head-on. Because
our world model ([habiworld](../habiworld/README.md)) is renderer-agnostic, the
3D client is a **presentation swap, not a rewrite** — it reuses the model,
verbs, events, sound, and decoded C64 art from the 2D client and replaces only
the final drawing layer with a Three.js scene. The 2D client is untouched;
the two share one renderer-agnostic app shell.

## What works today

- Region backdrops as real floor + wall geometry, textured from the region's own art.
- Avatars (composed head/body/pose) and props as billboards; smooth walks; original SID sound.
- The full verb set, word balloons, inventory, containers, and region-to-region travel.
- **Neighbor-region previews**: the side margins are filled with the adjacent
  regions' pre-rendered backdrops, so Downtown streets visually continue into
  the next block (disable with `?neighbors=0`).
- Floating region-name and "To …" exit labels.

## Status & caveats

This is an **experimental** client — a proof of concept that keeps growing.
Expect rough edges (see the Known limitations section of the
[render3d README](../webclient/render3d/README.md)). Bugs to
[Discord](https://discord.gg/rspcX27Vt4) or
[GitHub issues](https://github.com/frandallfarmer/neohabitat/issues), please.

## For developers

- **[webclient/render3d/README.md](../webclient/render3d/README.md)** — the
  full design doc: coordinate model, horizon split, backdrop pipeline,
  picking transform-back, and unit tests.
- **[webclient/DESIGN.md](../webclient/DESIGN.md)** — the shared client
  architecture both renderers sit on.
