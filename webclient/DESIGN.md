# NeoHabitat Web Client — Design

An all-JavaScript, **browser-only** graphical Habitat client. Type to raise word
balloons, click an object to pop a pie menu (GO / GET / PUT / DO), use function and
control keys — every action becomes a server request message. It loads and runs in a
browser with no build step.

> **Status:** exploratory. This document is the canonical design reference; it is written
> before the code so the architecture and its constraints are explicit. The phase roadmap
> at the bottom tracks what exists.

## Guiding principle: the C64 model, not the habibot model

This client is a faithful descendant of the **original 1986 Commodore 64 Habitat client**.
The C64 client received the region once (the *make-storm*), applied small delta ops as
things changed, rendered the world from original art, and turned player input into request
messages to the host. We rebuild exactly that loop in the browser.

It is **not** built on `habibot`. habibot is a bot / test-automation platform; its verb
helpers, narration, name-or-noid resolution, and command parsing are the wrong abstraction
for a graphical client. This client takes **no habibot semantics and does no text
processing**. The only thing it borrows from the bot world is the *comms transport* (how a
process reaches the server). Everything else — rendering, input, verbs — follows the C64
sources.

Contrast with `textclient/`, which deliberately *is* a HabiBot wired to a terminal and
borrows habibot's semantic layer. The two clients are intentionally different shapes.

## The pieces we already have

Every major subsystem already exists as an independent, tested library. This client is the
integration layer.

| Piece | Repo / path | Role here |
|---|---|---|
| **habiworld** | `~/neohabitat/habiworld` | C64-faithful **world model**. `world.apply(msg)` ingests the make-storm + delta ops and maintains the live object table (avatars, containers, region props). Emits `added`, `removed`, `moved`, `containerChanged`, `fieldChanged`, `lighting`, `regionDescribed`, and raw `op`. **Inbound only** — it does not build outbound messages. |
| **inspector renderer** | `~/neohabitat-doc/inspector` | The **video** engine. `codec.js` decodes original C64 art (props / bodies / charset); `render.js` composites cels, text, and animations to canvas; `region.js` lays out and renders a region as Preact components. Today it renders *static* region JSON fetched from `db/`. |
| **habisound** | `~/neohabitat/habisound` | The **audio** engine. Ports the C64 SID sound driver; `hs.play(name)` turns symbolic `ctx.sound` names into sound in the browser. |
| **pushserver `websocketProxy.js`** | `~/neohabitat/pushserver` | The **transport**. A WebSocket⇄TCP bridge — the only way a browser reaches the elko/bridge server. |

The reason the integration is clean: **the inspector renders the same object-table shape
that habiworld maintains.** A region file the inspector draws and a live habiworld object
record are both `{ ref, type, name, in, mods: [{ x, y, orientation, gr_state, style, … }] }`.
The inspector currently `fetch`es that array from disk; the live client feeds it the same
array straight from habiworld and re-renders on habiworld events.

## Architecture

```
                            ┌───────────────────────────┐
   server (elko/bridge)     │         webclient         │
        ▲     │             │                           │
        │     │   WebSocket │   ┌───────────────────┐   │
        │     └────────────────▶│ habiworld         │   │   inbound: make-storm + deltas
        │                     │ │  (world model)    │   │   → world.apply()
        │  pushserver         │ └─────────┬─────────┘   │
        │  websocketProxy     │    events │             │
        │   (WS ⇄ TCP)        │           ▼             │
        │                     │   ┌───────────────────┐ │
        │                     │   │ inspector renderer│ │   video (Preact + canvas)
        │                     │   │ habisound         │ │   audio (SID)
        │                     │   └───────────────────┘ │
        │                     │                         │
        │   outbound          │   ┌───────────────────┐ │
        └─────────────────────────│ C64 input layer   │ │   pointer/keys → verb
            request messages   │   │ (ported from .m)  │ │   → request message
                               │   └───────────────────┘ │
                               └───────────────────────────┘
```

Five layers:

1. **Transport** — a browser `WebSocket` to `pushserver`'s `websocketProxy`, which relays
   the raw JSON-per-message protocol to the server. We borrow this comms path; we add no
   bot logic on top of it.
2. **World model** — habiworld, consumed read-only as the C64 state mirror. Inbound
   messages go to `world.apply()`; the UI subscribes to its events.
3. **Video** — the inspector's `codec` / `render` / `region` pipeline, driven from
   habiworld's live table instead of static JSON.
4. **Audio** — habisound, wired to habiworld's symbolic sound events.
5. **Input / verbs** — ported from the C64 sources (see below). Pointer + keys select a
   verb and a target; the verb is dispatched through the object's class table; the result
   is a request message sent back over the transport.

## Outbound verbs: ported from the C64 source

The outbound side is **not** taken from habibot. It is ported, faithfully, from the C64
client, per the standing rule that the C64 source (`~/habitat-orig/sources/c64`) is the
canonical truth — read the `.m`, don't guess.

The C64 interaction model is literally: **choose a VERB; the target is the object under the
cursor; execute `target.verb`, indirected to the object's actual handler through the class
verb table.** Clicking GET on a flashlight runs the flashlight class's GET handler, which
emits the corresponding request to the host.

**Modal cursor (`cursor.m`)** — not a radial wedge menu. Hold the trigger and drag a
direction; the cursor sprite swaps to DO/GO/GET/PUT/STOP icons from `sprites.m` while the
cursor position stays fixed. Release with stick centered commits `state_to_command`. A quick
tap without drag is STOP: `face_cursor` (`actions.m`) then `generic_cease`. Normal mode
(button up) moves the crosshair sprite. Web mapping: `pointerdown` = trigger, drag delta =
joystick nibble via `cursor_point_table`, `pointerup` = release → `execute_command` →
`dispatchVerbAtPick`.

Canonical sources to port from:

| Concern | C64 source |
|---|---|
| Pointer / cursor verb selection | `Main/pointer.m`, `Main/cursor.m` |
| Object under cursor (hit-testing) | `Main/pick.m` |
| Keyboard, function/control keys | `Main/keyboard.m`, `Main/keys.m`, `Main/akey.m` |
| Verb dispatch | `Main/actions.m` |
| Walk-to | `Main/walkto.m` |
| Get / drop | `Main/getdrop.m` |
| Throw | `Main/throw.m` |
| Postures / emotes | `Main/gestures.m` |
| Word balloons | `Main/balloons.m` |
| Text entry | `Main/text_handler.m` |
| Comms / protocol framing | `Main/comm_control.m`, `Main/protocol.m`, `Main/mikes_protocol.m` |
| Class → verb indirection tables | `class.dat`, `class_equates.m`, `action.dat` |

Where the *state* effect of an op is already modeled, it lives in habiworld
(`habiworld/lib/deltas.js`, `habiworld/lib/behaviors/`). This client builds the *requests*
that cause those ops; it never hand-rolls world state.

## Locked decisions

- **Location:** `~/neohabitat/webclient/` — alongside the live infrastructure it talks to
  (habiworld, habisound, pushserver). The renderer is consumed from
  `~/neohabitat-doc/inspector`.
- **No build step.** Native ES modules, `<script type="importmap">`, and vendored
  Preact / htm / signals — served as static files, exactly like the inspector and
  habisound. "Just JS in the browser." No bundler.
- **Outbound verbs ported from the C64 source**, as above.

## Open items

Resolved during the relevant phase; none blocks starting.

1. **habiworld in the browser.** ✅ Resolved (Phase 2): `lib/habiworld.js` is a tiny no-build
   CommonJS loader that fetches habiworld's ~27 modules over http and runs them through a
   Node-like synchronous `require()`, shimming the one bare dependency (`events`) with a
   minimal `EventEmitter`. habiworld is **unmodified** — its CommonJS API is untouched, so
   `habibots`/`sagebot` are unaffected. habiworld is fetched as a sibling under the dev root
   (`../habiworld/`), so it stays in sync automatically (not vendored, since it's in-repo).
2. **Renderer reuse across the repo boundary.** ✅ Resolved: the render pipeline and the
   prop-art database are **forked** into `webclient/habirender/` (started as a trimmed copy
   of `neohabitat-doc/inspector` in Phase 1; diverges from Phase 3 on as the webclient
   patches it — e.g. avatar rendering — see `habirender/README.md`), so the client is
   self-contained with no `neohabitat-doc` runtime dependency. `lib/region-view.js` /
   `lib/live.js` redirect the renderer's document-relative `fetch`es into that dir. The data
   seam used is the `objects` parameter of `regionView` (bypassing its
   `useHabitatJson(filename)` fetch); Phase 2 feeds that from habiworld's live table.
3. **websocketProxy login preamble.** ✅ Resolved (Phase 2): there is no separate auth
   handshake in dev — the whole login is a single `{op:"entercontext", to:"session",
   context, user:"user-<name>"}`. Wire framing matches habibot: outbound JSON + `"\n\n"`,
   inbound a byte stream of JSON split on `"\n"` (empty lines skipped). The proxy is a
   transparent byte pipe; `extractLoginName` only sniffs `"name"` for docent tracking and
   does not gate forwarding. See `lib/transport.js`.

## Known bugs (deferred)

Do not fix until explicitly picked up.

1. **Face plate on headless avatars** (noted 2026-06-18). The body face overlay
   (`head_placeholder` / `AVATAR_HEAD_CEL` limb 4 in `composeAvatarFrame`,
   `habirender/region.js`) is painted even when the equipped head has no face.
   `shouldPaintBackFacePlate` only suppresses the plate on back view when the head
   disk `colorBitmask` bit 7 is clear (`animate.m`); front and side views (and other
   head types) still show a face where the C64 client would not.

## Phase roadmap

Each phase is independently demoable in the page shell.

- **Phase 0 — Shell + title capstone.** `index.html` + importmap (reuse the inspector's
  vendored deps), an empty stage container, a status line, and a manual connect affordance
  (stubbed until Phase 2) — a sandbox for UI experiments. Capstone: the C64 title sequence
  (`lib/title.js`) — the comet ported from `Main/comet.m` (with the VIC-II sprite→screen
  origin offset of (24,50); the visible bitmap is exactly 320×200), the 3-part title tune
  via `habisound.playTune('title')`, and the "press any key" balloon, occluded behind the
  title art via a luminance mask. *Done when:* the page loads over http with no console
  errors and the title sequence plays.
- **Phase 1 — Render from an in-memory table.** Drive the inspector renderer from a JS
  object array (a captured make-storm) instead of `fetch`. *Done when:* a real region draws
  from an in-memory fixture, proving the renderer is decoupled from static-file fetch and
  the cross-repo import resolves.
- **Phase 2 — Transport + login + make-storm.** Connect through `websocketProxy`, send the
  login/context preamble, receive the make-storm, feed `world.apply`, render the live region.
- **Phase 3 — Deltas + sound.** Subscribe to habiworld events; re-render on
  `moved` / `fieldChanged` / `containerChanged` / `lighting` / `added` / `removed`; wire
  sound events to habisound. *Done when:* another avatar walking and acting updates live,
  with sound.
- **Phase 4 — Output + basic input.** Word balloons over avatars from speech/ESP
  (`balloons.m`); typing composes a SAY/ESP message (`text_handler.m`); unified verb
  dispatch (`actions.m` / `habiworld` class table); C64-faithful walk reply handling
  (`actions.m:goXY` → `walkto.m:start_walk`).
- **Phase 5 — Modal cursor verbs.** Port `Main/cursor.m` + `sprites.m`: hold
  pointer and drag to swap the cursor icon (DO/GO/GET/PUT/STOP); cursor **does not move**
  while held. Release runs `execute_command` (`actions.m`): `pointer.m` pick →
  `face_cursor` → class verb via `habiworld` dispatch. Quick tap (no drag) = STOP
  (face cursor only, `generic_cease`). Not a wedge/radial menu — directional stick
  table `cursor_point_table` exactly as on the C64.

  - **Return-to-center backs out (virtual joystick) — implemented.** On the C64 the stick
    could return to center *while the button is still down*, sending the cursor back to STOP
    so the user could abort a half-formed command. The mouse analog treats the press point as
    the center of a virtual joystick with **STOP at center**: `cursorStateFromStick` resolves
    to the *current* offset (no one-way latch), so a drag up (GO) that comes back down passes
    **through STOP** on its way to DO, and releasing at center backs out. The deadzone is
    `DRAG_THRESHOLD` (the STOP center).
- **Phase 6 — Full controls + modal displays.** Function/control keys, postures/emotes
  (`gestures.m`), get/drop (`getdrop.m`), throw (`throw.m`) — plus the two **modal display
  modes** that replace the region renderer while active. The C64 is authoritative here and
  ports nearly 1:1; the architecture is a single top-level display-mode state, with the same
  cursor/keyboard input *repurposed* per mode (read the `.m`, per RULE #1).

  - **The modal switch (`Main/main.m:75` `maintain_frame`).** Dispatch on two variables:
    `graphics_mode` (`0` = bitmap region, `0xff` = text, `1` = special) and
    `display_contents_noid` (nonzero → draw the inventory grid *instead of* the region).
    Three modes — **region / inventory-grid / text** — selected by state; the region is
    simply not drawn in the other two, and region objects are not selectable there. Port as
    one top-level signal (`region | inventory | text`) gating which view `live.js` mounts,
    mirroring `graphics_mode` + `display_contents_noid`. Exiting a mode force-redraws the
    region (`forced_render_region`).

  - **6a. Inventory picker — get-from-container (`Main/pick.m` + `actions.m:912`
    `pick_from_container`).** A GET that needs a noun from an opaque/pocket container sets
    `display_contents_noid = container`, fetches the contents' images, and loops
    `maintain_frame` until the trigger fires (`let_user_pick:`). `pick.m` lays the contents
    out in a **4-column grid** (`cont_x_pos`/`cont_y_pos`), skipping avatars. The **same
    `pointer.m`** does selection (it gates on `display_contents_noid` at `:34`). Paging: if
    nothing was pointed at and more remain (`lowest_to_display`), show the next page.
    Exit/abort clears `display_contents_noid`, restores the saved cursor, and returns
    `pointed_noid` — the GET target, or `0` = abort. Reuse the prop/cel renderer +
    `containedItemLayout` at grid coords and the existing cursor/`pickAt` to select; feed the
    result into the GET dispatch. This is the modal cousin of the in-region table-contents
    pick (`pick.mjs pickDrawOrder`): opaque/pocket containers use the grid, non-opaque ones
    (tables) show contents in-region.

  - **6b. Text mode — read documents / edit paper / send mail (`Main/text_handler.m`).**
    Host-driven via a command byte; bit flags carry the variant. `ENTER (0x00, :142)`: clear
    sheet, `graphics_mode=-1`, freeze cursor (`detach_from_stick`), `pen_cursor`.
    `RECEIVE_PAGE (0x02, :215)`: stream a page from the host, `print_to_page` each char
    (`page_line_delimiter` → return) — **reading**, with `IS_A_BOOK`/`TEXT_MULTIPAGE_MODE`
    paging (`BOOK_NEXT/BACK/RANDOM_ACCESS` bits). `TRANSMIT_PAGE (0x03, :170)`: walk the page
    buffer (`paper_window_size` × 40), trim trailing spaces, send each line via
    `MESSAGE_WRITE` to `pointed_noid` — **editing & sending**, → Habitat mail when
    `TEXT_MAIL_BIT`. `EXIT (0x01, :157)`: restore cursor, `forced_render_region`. The editor
    (`write_to_page`/`print_to_page`, `:41`) handles char/return/delete/clear + page-cursor
    movement; mode bits: `TEXT_WRITEABLE` (paper vs read-only doc), `TEXT_MAIL_BIT`,
    `TEXT_REPLY_BIT`. Reuse the charset renderer already powering balloons/signs/the speak
    line; run the page protocol over the same transport.

  - **6c. Ghost mode (`actions.m:274`, `farmers_equates.m:41`).** A region change can
    **force-transform** the avatar into a ghost — entering a full region makes you a ghost
    (`ghost_noid = 255`; the avatar mod carries `amAGhost`). While a ghost the command cursor
    is restricted to **GO only** — every other verb is blocked (`actions.m:276` "ghosts can
    ONLY go!") — and a region-level GO with verb slot **9 = deghost** re-materializes you when
    space frees (region-edge GO still transits). Port: gate verb dispatch on the ghost flag,
    render the avatar in its ghost form, and surface the deghost GO. Pairs with region transit
    (the `changeRegion` client capability), since transit is what can drop you into ghost
    state.

  - **6d. Region transit (`GoToNewRegion`/`sky_go`/`transit_region` → `changeRegion`).**
    Sequenced **last in Phase 6**, after the in-region UI (6a inventory + 6b documents) is
    done. The world side is already complete in habiworld — `sky_go`, `GoToNewRegion` ("the
    region's `go` — leave through an edge"), and `transit_region` (region slot 8) all call
    `ctx.changeRegion(direction)`. The missing piece is the **client capability**:
    `ctx.changeRegion` (`kernel.js:280`) delegates to `client.changeRegion(direction)` and
    today returns `needs-client-capability:changeRegion` because the webclient provides none.
    Implement it as: on walk-off-edge (or `changeRegion`), tear down the current region state
    and `transport.enterContext(world.region.neighbors[direction])`, then render the new
    make-storm. Goes after the modal UIs because it changes the top-level region state those
    modes assume, and it feeds **6c** — arriving in a full region force-transforms you to a
    ghost.

    *Open question — the off-edge trigger (explore when we build 6d).* On the C64, walking
    **off-screen** left / right / down was triggered by the **game-window boundary itself**:
    the hardware clamped the cursor at the playfield edge, so pushing into that edge was a
    free, obvious, always-accessible "GO off the edge in this direction" affordance. The
    browser playfield has **no such hard cursor boundary**, so we must invent an explicit
    target/affordance for edge transit (candidates: edge hot-zones, an off-edge GO target, or
    a directional control). Left, right, and down map to the three walkable edges. Decide the
    mechanism at this stage.

## Running (Phase 0–1)

Native ES modules, importmaps, `fetch`, and the habisound `AudioWorklet` require http(s),
not `file://` — same as the inspector and habisound. Serve from the **repo root** so the
client can import its sibling libraries (`habisound` now; `habiworld` in Phase 2) via
relative paths; habisound resolves its own worklet/data through `import.meta.url`, so it
works under any served root that contains it.

```sh
cd ~/neohabitat
python3 -m http.server 8000
# open http://localhost:8000/webclient/
```

(The renderer + art database are forked into `webclient/habirender/`, so nothing outside
this repo is needed at runtime — see open item #2 and `habirender/README.md`.)

From Phase 2, bring up elko + bridge + pushserver per `docker-compose.dev.yml`, then connect
the client and compare the live region against the textclient / inspector for the same context.

## Regression guard

After any change that touches a shared library, run `npm test` in `habiworld` and
`habisound`. If habiworld itself is modified, additionally confirm `habibots`/`sagebot`
still load — they depend on its current API.
