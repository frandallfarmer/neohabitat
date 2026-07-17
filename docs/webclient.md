# The NeoHabitat web client

An **all-JavaScript, browser-only graphical Habitat client**. No emulator, no
plugins, no build step — it decodes the original C64 art, replays the original
animations and SID sound effects, and follows the original C64 client's world
model faithfully (the C64 client is our ground truth). Same world, same rules,
same look — just fast and crisp.

## Play it

| URL | What you get |
|---|---|
| **[habitat.themade.org/neohabitat](http://habitat.themade.org/neohabitat)** | The web client framed with the **Docent** guide — best on desktop. |
| **[habitat.themade.org/webclient/live.html](https://habitat.themade.org/webclient/live.html)** | The client full-page — best for **mobile** and small screens. Add `?osk=1` for an on-screen keyboard. |

Log in with your avatar name on the left panel. New avatars hatch through the
same immigration flow as every other client.

**The Docent** is our browser-side companion software: it tracks your avatar as
you move and serves contextual help, object documentation, region descriptions,
and Habitat history — interactive, no clicking required. In the `/neohabitat`
flow it sits beside the game; in the full-page flow the same help content is
reachable from the client's Help link.

## What's under the hood

The client is built from small, reusable libraries that live in this repo:

- **[habiworld](../habiworld/README.md)** — the client-side world model and
  1986-faithful behavior dispatcher (ported from the original C64 sources).
- **[habirender](../webclient/habirender/README.md)** — the C64 art codec and
  region render pipeline.
- **[habisound](../habisound/README.md)** — the original 1986 SID sound driver
  bytecode, played live via Web Audio.

There is also an experimental **3D diorama** presentation of the same client —
see **[webclient3d.md](webclient3d.md)**.

## For developers

- **[webclient/README.md](../webclient/README.md)** — how to run it locally
  (dev compose serves it at `http://localhost:1701/webclient/`, live-reload).
- **[webclient/DESIGN.md](../webclient/DESIGN.md)** — the canonical
  architecture document: C64 model, phase roadmap, invariants.
- **[run-your-own-server.md](run-your-own-server.md)** — the server stack it
  talks to (WebSocket → `bridge_v2` → Elko).
