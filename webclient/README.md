# NeoHabitat web client

An all-JavaScript, browser-only graphical Habitat client that follows the original
**C64 client model** (not the habibot model). See **[DESIGN.md](./DESIGN.md)** for the
architecture and phase roadmap.

> **Status:** **Live region viewer** — connect to a running server, enter a context, and
> watch the region update from habiworld (make-storm + inbound host behaviors). Avatar
> walks and gestures replay client-side; behavior-driven sound and a simple word-balloon
> strip are wired. No pie menu or outbound verbs in the UI yet (use `habitatDo(noid)` in
> the browser console for DO).

## Running

No build step. Native ES modules + importmap + vendored Preact/htm/signals, served static.
Serve from the **repo root** (`~/neohabitat`) so the client can reach sibling libraries
(`habiworld`, `habirender`, `habisound`). Native ESM, importmaps, `fetch`, and the
habisound `AudioWorklet` all require http(s) — not `file://`.

```sh
cd ~/neohabitat
python3 -m http.server 8000
```

| URL | Purpose |
|-----|---------|
| [http://localhost:8000/webclient/](http://localhost:8000/webclient/) | Title sequence + Phase 0 shell |
| [http://localhost:8000/webclient/live.html](http://localhost:8000/webclient/live.html) | **Live region viewer** (WebSocket → habiworld → habirender) |
| [http://localhost:8000/webclient/region.html](http://localhost:8000/webclient/region.html) | Static region JSON demo |

### Live viewer

1. Start the stack (elko, bridge_v2, pushserver / `docker compose` per repo docs).
2. Open `live.html`.
3. Set WebSocket proxy (default `ws://localhost:1987`), context, and avatar name → **Connect**.

Query params seed the form: `?ws=ws://localhost:1987&context=context-Downtown_5f&user=randy`

Data path:

```
websocketProxy → Transport → habiworld.apply (state + host behaviors) → regionView
                              └─ ctx.sound / ctx.chore / ctx.balloon
```

## Layout

```
index.html        title + shell sandbox
live.html         live region viewer
region.html       static region render test
lib/live.js       WebSocket harness, habiworld, avatar motion, sound glue
lib/avatar-chore.js   client-side walk/gesture replay
lib/presentation.js   ctx.sound / ctx.chore / balloon callbacks
habirender/       C64 art codec + region renderer (vendored from inspector)
lib/title.js      C64 title sequence (comet + habisound title tune)
style.css
vendor/           Preact/htm/signals
```