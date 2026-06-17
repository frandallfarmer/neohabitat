# NeoHabitat web client

An all-JavaScript, browser-only graphical Habitat client that follows the original
**C64 client model** (not the habibot model). See **[DESIGN.md](./DESIGN.md)** for the
architecture and phase roadmap.

> **Status:** Phase 0 — page shell + the C64 title sequence (comet, title music, "press
> any key"). Nothing talks to the server yet.

## Running

No build step. Native ES modules + importmap + vendored Preact/htm/signals, served static.
Serve from the **repo root** (`~/neohabitat`) so the client can reach its sibling libraries
(`habisound` now; `habiworld` in Phase 2). Native ESM, importmaps, `fetch`, and the
habisound `AudioWorklet` all require http(s) — not `file://`.

```sh
cd ~/neohabitat
python3 -m http.server 8000
# open http://localhost:8000/webclient/
```

Click once to start (browser autoplay needs a gesture): the comet sweeps the skyline while
the title tune plays, then a balloon invites you to press any key to drop into the Phase 0
shell sandbox.

## Layout

```
index.html      shell + importmap (vendored deps)
app.js          top-level screen switch; Phase 0 shell sandbox (connect panel is a stub)
lib/title.js    the C64 title sequence — comet (Main/comet.m) + habisound title tune
style.css       spare sandbox styling
vendor/         Preact/htm/signals, copied from neohabitat-doc/inspector
assets/title.png  Lucasfilm's Habitat title art (heavy placeholder; optimize later)
```
