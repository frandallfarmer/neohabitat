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

    *Status:* reading done — `text-view.js` renders the page with the canonical charset
    (black ink on C64 `color_pink`) and the `Book_Menu` (NEXT/BACK/PAGE #/QUIT) in the game
    font on white; paging via the READ protocol (`Document.java`). The **pen cursor** caret
    (typewriter-tip, snaps to a char cell, moves on arrows / advances on type) is drawn but
    is currently an *independent* overlay. **Next:** (1) make the pen cursor **replace the
    mouse cursor** (hide the OS pointer, the pen *is* the pointer) so it can also point at and
    trigger the bottom menu commands — one cursor for both the page and the menu, like the
    C64; (2) it should be **2× size** (the C64 pen sprite is double-height). Then **paper
    editing**: type into the page buffer, `Paper_Menu` (ERASE/REPLY/MAIL IT/QUIT), and
    `TRANSMIT_PAGE` send-as-mail.

  - **6c. Ghost mode (`actions.m:274`, `farmers_equates.m:41`).** See **`GHOST_MODE.md`** for
    the full behavior guide (limits gathered from C64 + server ground truth). A region change can
    **force-transform** the avatar into a ghost — entering a full region makes you a ghost
    (`ghost_noid = 255`; the avatar mod carries `amAGhost`). While a ghost the command cursor
    is restricted to **GO only** — every other verb is blocked (`actions.m:276` "ghosts can
    ONLY go!") — and a region-level GO with verb slot **9 = deghost** re-materializes you when
    space frees (region-edge GO still transits). Port: gate verb dispatch on the ghost flag,
    render the avatar in its ghost form, and surface the deghost GO. Pairs with region transit
    (the `changeRegion` client capability), since transit is what can drop you into ghost
    state.

  - **6d. Region transit (`GoToNewRegion`/`sky_go`/`transit_region` → `changeRegion`). DONE
    (the explicit-target subset).** Sequenced **last in Phase 6**, after the in-region UI (6a
    inventory + 6b documents). The world side was already complete in habiworld — `sky_go`,
    `GoToNewRegion`, and `transit_region` all call `ctx.changeRegion(direction)`. The flow,
    traced against the C64 (`actions.m region_change`/`GoToNewRegion`, `comm_control.m
    wait_for_region`) and the modern elko/bridge path:

    - **Outbound.** The client capability is now provided (`world-client.js changeRegion`),
      mirroring `habibot.js`: `direction` is a screen word (`up/right/down/left`), mapped to
      the orientation-adjusted neighbor index `(k − 2·orientation + 9) % 4` and sent as
      `{op:"NEWREGION", to: avatarRef, direction}`. elko (`Avatar.NEWREGION`) replies err/ok,
      then pushes **`changeContext {context}`**; the bridge/pushserver cycles the elko-side TCP
      and streams a fresh make storm. This covers **sky / wall edges, neighbor-doors, and ghost
      drift** (ghost GO is transit-only).
    - **Teleports.** Server-initiated: elko sends **`AUTO_TELEPORT_$`**, and the client replies
      `NEWREGION direction=4` (`AUTO_TELEPORT_DIR`), which makes elko emit the real
      `changeContext`. Handled in `live.js applyInbound` (a client capability, like
      `changeRegion`; habiworld leaves it to us). User-initiated teleports/elevators ride the
      **TALK→`ZAPTO`** flow (6-TALK routing) and the server drives `changeContext` from there —
      already working.
    - **Inbound teardown (the C64 `wait_for_region` discipline).** habiworld already purges its
      object table (`changeContext → world.clear`, which also resets `meNoid`), and `regionView`
      fully unmounts while `objects` is empty (so `RegionCursor` park/hold + the live
      `pickState` reset on remount). `live.js resetForRegion` (on `regionChanged`) tears down
      the presentation state that outlives that unmount: **`clearTrapCache()`** (the one
      confirmed leak — decoded region art keyed by ref), word balloons (`kill_quip`), the typed
      text line, balloon talker slots (re-seated), `lastCursor`, any pending verb / speak-reply
      timer, and any open modal (paper/book/inventory). So a long session of region hops can't
      leak memory or bleed stale state between regions.

    **Doors (connection / building) — DONE.** Two pieces, both ported from the C64:
    - *Pass-through is gated on the cel under the cursor.* `generic_goToOrPassThrough.m` only
      transits when `pointed_at_cel_number == 2` — the door's **black-opening cel**; any other
      cel just walks up to the door. The web pick now resolves cel-level hits: props tag each
      decoded cel with its absolute index (`codec.js`), `frameFromCels` keeps per-cel hit
      regions on the frame (`render.js frame.celLayers`), and `pick.mjs celNumberAtFrame` walks
      them front-to-back to return the 1-based `cel_number` (`mix.m` numbers cels from 1, so the
      black opening = `prop.cels[1]` = `cel_number 2`). `verb-dispatch.js` maps `celNumber === 2`
      → `args.passThrough`, which the behavior reads.
    - *`passage_id`.* elko's `avatar_NEWREGION` uses `region.neighbors[direction]` when
      `passage_id == 0`; a door/building whose connection is **not** a map neighbor (a building
      interior) needs the door's noid. The C64 sends `pointed_noid`; habiworld's
      `kernel.js ctx.changeRegion` now forwards the pointed passage —
      `client.changeRegion(direction, pointed ? pointed.noid : 0)` — and `world-client.js`
      sends it as `passage_id`. The extra arg is additive and sagebot-safe (the bot's
      `changeRegion` takes only direction); verified by the full habiworld suite (135 green) +
      habibots/habiworld load. Sky/wall/region edges forward a non-passage noid (or 0) the
      server ignores, so they still fall back to `neighbors[direction]`.

    **Open-terrain edge walk — frame chevrons.** On the C64 the hardware clamped the joystick
    cursor at the playfield edge, so a GO there ran `region_change` (`actions.m:841`), which
    derived the transit direction purely from *which screen edge* the cursor sat on (left / right
    / bottom) and let the **server** apply the region's orientation — there is no client-side
    cardinal-direction math. The browser has no hard cursor boundary, and clamping an absolute
    mouse would also steal the edge coordinate from ordinary GO/walk. So the edge directions live
    as **chevrons running the full length of each frame side, outside the region canvas** (`◀`
    left column, `▶` right column, `▼` bottom row — `live.js region-frame` + `style.css`): they
    use the normal OS pointer (outside the `cursor:none` play area), and an in-region click keeps
    its true coordinate for GO/walk. `up` is the sky (clicked in-region); chevrons show only while
    standing in a region (`MODE_REGION`).

    A chevron reproduces what `region_change` does. The C64 detail: at the screen edge
    `update_cursor` (`pointer.m`) **skips the object pick** (`desired_x==0/160 → beq pexit`), so
    `pointed` is the **region (0)**, not the ground — and the region's GO is `GoToNewRegion` →
    `region_change`, which walks to the edge (nested GO on the ground) and *then* transits. The
    ground's own GO (`generic_goToCursor`) never transits, which is why aiming a plain GO at the
    floor only walks. So `onEdgeClick` does both steps: a GO/walk at the clamped edge coordinate
    (the click's cross-axis position along the chevron), then `dispatchClient.changeRegion(edge)`.
    Direction uses the **C64 screen-edge encoding** (`left=0, up=1, right=2, down=3`) sent raw;
    the server applies the region's orientation (`Avatar.NEWREGION: (direction+orientation+2)%4`)
    — there is no client-side cardinal/orientation math (the earlier `(k−2·orientation+9)%4` was
    the bot's formula and produced wrong neighbors at non-zero orientation). The **side chevrons
    span only the walkable band** — from the region's bottom edge up by `region.depth` (canvasY is
    1:1 with habitat y, so the band is the bottom `depth` px; bottom-aligned past the one
    text-input line below the graphics band) — so a click always maps into habitat y ∈ [0, depth]
    (ground), never the sky; the sky is reached by clicking it in-region (`up`).
    *Polish left for later:* dimming a chevron when that direction has no neighbor; the bottom/down
    edge (C64 reaches `region_change` for `down` by a different path than the x-edge pick-skip —
    verify it transits).

- **Phase 7 — Polish: load experience, performance, cleanup.** Everything that makes the
  client shippable rather than merely functional. None of it is new C64 behavior; it is the
  production wrapper around the working client.

  - **7a. Full load experience — launch screen + login. DONE.**
    `live.js boot()` shows the **title/launch sequence** (`lib/title.js` — the Phase 0 comet +
    3-part tune, over the original `habsill3.m` art) immediately, while `main()` loads the heavy
    all-JS client (habiworld, the renderer, art decoders) in the background. The title is the
    C64-faithful "loading from disk" moment: load the screen, the first click starts the music
    (and supplies the gesture audio needs), the comet shoots across, and the final prompt is
    **gated on the load finishing** (`TitleScreen ready` — holds at "Loading…" until `main()`
    resolves). When ready it asks **only for the Avatar name** (no region prompt); entering it
    dismisses the curtain and starts the client. `App` carries no connect form — it auto-connects
    once on mount via `connect(wsDefault(), null, name)`: **no context**, so the server lands the
    avatar wherever they last were (`transport.enterContext` omits `context`). The proxy URL is
    **synthesized from `location`** (same origin as the page, ws/wss to match; `?ws=` overrides
    for dev where the proxy is a separate port). `live.html` is a clean shell.
    *Open:* the title and client each spin up their own habisound engine — share one (a 7b
    concern). (The title-music opening ~1s swallow is **resolved** — it has played correctly
    since at least the Alpha release, locally; no warm-up workaround needed.)

  - **7b. Performance — render cadence + steady-state memory. DONE (load-time deferred).**
    A no-build, native-ESM client that decodes original C64 art in the browser. The render
    cadence and the across-region memory creep are fixed; first-paint load time is deferred
    (see below). Verified in-browser with real numbers: INP warms from ~72ms to ~144ms over
    the first few regions (decoded-art cache filling — `imageFileMapSignal`, bounded/intended)
    then stays **flat** walking across town, instead of doubling region-over-region.
    - **Background/foreground render split (C64 `Main/render.m`). DONE.** On the C64, the
      foreground objects — avatars, always flagged `0x80` (`walkto.m: ora #0x80`) — are the
      only ones redrawn every frame; background objects are re-rendered only when
      `background_render` is set (region load, `forced_render_region` on mode exit, a BG-object
      change). The webclient renders one Preact component per object, each with a `layout`
      signal computed in an effect that read `avatarMotion.tick` **unconditionally** — so every
      static prop re-decoded on every frame. Fixed by reading tick only in the avatar (body)
      branch: avatars recompose per frame, BG props recompute only on their own obj/prop/
      container change, held items ride their carrier's tick-reactive layout. `computeLayoutMap`
      no longer re-runs per frame either.
    - **Steady-state memory / across-region INP creep. DONE (this was the real degradation).**
      `computeLayoutMap` created two root `effect()`s per object and never disposed them. A bare
      effect lives until its disposer is called, holding its signal subscriptions (notably
      `avatarMotion.tick`) and closure — so every region walked through permanently left its
      objects' effects alive and **still firing every animation frame**, making per-frame work
      and INP climb monotonically and never recover on leaving a heavy region. Fixed by
      capturing each effect's disposer and tearing them down when an object leaves the map
      (departed / region hop) and on `regionView` unmount. (Ruled out as non-leaks first:
      modal keydown listeners are paired; balloon scrollback is capped; the avatar override
      maps are 256-noid-bounded; `trapCache` is cleared on region hop.) Also: the avatar
      sprite-mover `setInterval` now stops when nothing is animating.
    - **Load time — DEFERRED (not blocking).** `lib/habiworld.js` still crawls + fetches
      habiworld's ~27 modules in a waterfall; bundling/precomputing the module graph and
      memoizing decoded cels/charset glyphs would cut time-to-first-region. Not done — the
      interactive/steady-state cost (above) was the priority and is resolved.
    - **Pick-path readback — DONE.** Picks read composite-layer canvases via `getImageData`
      (`pick.mjs:85/97/116`) whose contexts were created during compositing **without**
      `willReadFrequently` (so the pick-time flag was ignored — context attributes are fixed at
      first `getContext`); this was the `pointerup took NNNms` jank. Fixed by creating the
      read-back canvases with the flag at their `getContext("2d", { willReadFrequently: true })`
      in `render.js` (per-cel, `compositeLayers`, `flipCanvas`). Measured in-browser: pointerup
      dropped from ~73ms to 41–48ms (under Chrome's 50ms violation threshold).

  - **7c. Cleanup — repo hygiene and ground-truth debts.**
    - **`classes.js` → beta.mud ground truth.** The committed `habiworld/lib/classes.js` was
      generated from the **older `new.mud`**, which disagrees with the canonical
      `~/habitat-orig/habitat/Beta/Bak/beta.mud` (see `lib/tools/parse_mud.js`). Known-wrong
      rows include **Region** F-key slots 9–16 (the webclient currently bypasses them via
      `performFnKey` — see memory `fkey-region-table-stale`), **Flag** GET
      (`generic_goToAndGet` vs the correct mass-gated `generic_getMass`), and **Mailbox**
      (obsolete `mailbox_get`/`generic_sendMail` vs inert `noEffect`). The fix is to point
      `parse_mud.js` at beta.mud and regenerate; this surfaces ~21 beta-only behaviors that
      must be **ported or left as loud `unported` stubs**. Because `classes.js` is shared with
      sagebot/habibots, this requires an explicit **sagebot/habibots compatibility check**
      before landing (memory: `textclient-no-habibots-changes`). Once done, `performFnKey` can
      optionally route region F-keys through the class table instead of its direct mapping.
    - **Diagnostic test debris.** The untracked `webclient/test-*.mjs` live diagnostics
      (`test-habiworld-load`, `test-speak-trace`, `test-speak-ws-trace`, `test-live-connect`,
      …) need fetch/WebSocket and fail under `node --test`; either gate them out of the test
      run or move them under a `diagnostics/` dir so the suite is green. Remove the
      `webclient.stash-*` working-tree backup dirs once their changes are confirmed landed.

  - **7d. Emulate C64 traffic speeds — don't overflow real C64 clients.** A real C64 client
    is on a slow modem with a tiny serial input buffer; it consumes host traffic at ~300-baud
    pace. The webclient can emit requests (and the server can fan out the resulting broadcasts)
    far faster than a C64 can drain them, overflowing its buffer and desyncing/crashing it when
    a webclient and a C64 share a region. Pace outbound interaction to a C64-safe rate:
    rate-limit/coalesce bursty user actions (rapid walks, gestures, speak) and throttle to the
    original on-wire cadence so co-present C64 clients stay within buffer. Establish the target
    rate from the C64 comms (`Main/comm_control.m` / `protocol.m` / `mikes_protocol.m` — the
    modem/serial timing) and verify against an actual C64 client (VICE) sharing a region.

  - **7e. Cursor model — pie-menu input on an absolute mouse (LATE in Phase 7).** The C64
    cursor was a **joystick** — a *relative* device: after a verb the cursor freezes at the
    target and "returns" there for the next command, with no notion of an absolute pointer
    position. The browser has **no API to move the OS pointer**, so on an absolute mouse a
    frozen sprite and the real pointer inevitably diverge — resuming must either **warp** (snap
    the sprite to the mouse) or **drift** (a relative offset that accumulates and makes pointing
    impossible). The committed cursor (`cursor-view.js`) takes the warp tradeoff: it freezes at
    the press point and the next press re-anchors there — **good enough for now**. The real fix
    is one of: (a) **Pointer Lock** — relative motion (`movementX/Y`), OS cursor hidden, the game
    cursor is the sole pointer = a faithful port of the joystick (freeze/return work with no
    warp/drift); cost is click-to-engage + Esc-to-release UX. (b) A **redesigned absolute pie
    menu** that doesn't need the cursor to return to a point — e.g. press opens a radial menu
    anchored at the press point, the cursor roams freely to a wedge, release selects, and the
    target stays the press point. Decide between (a) and (b) here; both are legitimate.
    **DEFERRED to the future (Randy, 2026-06-29) — do not redesign the model now.** Notes that
    constrain any future redesign:
    - On a **touch-screen / pen**, *flicking* with the CURRENT UI already gives the experience
      most like the C64 joystick. The absolute-pointer divergence is **only a mouse-like-pointer
      problem**. Any revised model **must retain** the touch/pen flick experience.
    - The **mouse** experience is comparatively awkward, but acceptable for now (MFA).
    - So the model redesign (a vs b) is not the priority. The priority is the **busy cursor**
      (next item) — making the cursor wait/blink and block new commands while one is in flight.
  - **7f. Hatchery — new-avatar onboarding (LATE in Phase 7).** The Hatchery is the original
    Habitat first-connection flow: a brand-new user has no turf/avatar customization and is
    routed through the hatchery region to be "hatched" (avatar created, turf assigned) before
    normal play. The dev stack already exposes `NEOHABITAT_ORIGINAL_HATCHERY` (bridge_v2). The
    webclient needs to recognize and survive the hatchery context — including any prompts /
    custom region flow it drives — so a first-time login doesn't dead-end. Scope the exact
    server-driven sequence (PROMPT_USER, customize, the hatchery region's behaviors) when we
    pick this up; treat it as its own onboarding sub-mode rather than a normal region.
  - **7g. Busy/wait cursor + co-presence delays (webclient). DONE (webclient round).** The all-JS
    client acts instantly, with none of the latency a real C64 lived under (slow modem + floppy
    disk loads). Sharing a region with native C64 clients that makes it both **unfair** (arrive,
    draw, and fire before co-present C64s have rendered you — the "gunfight") and a **load hazard**
    (firing commands while C64s are mid disk-load piles broadcasts into their queues). The bridge
    already byte-paces each C64 at modem baud (`client_connection.go` `ratelimit.Writer`) — the
    byte-level crash backstop, untouched. What it can't model is the C64's **disk-load time** and
    the original command **cadence**; this reproduces that client-side. Faithful to `Main/cursor.m`:
    while a command is in flight (`command_selected ≥ 0`) the selected icon **freezes and blinks to
    black** (`maintain_flashing`) and **all** input is refused (`keyboard.m` bails on
    `command_selected` — typing/gestures/F-keys included), released after the reply +
    `animation_wait_bit` (here: `avatarMotion.whenIdle`) + a base throttle (`throttle_duration`).
    - **`lib/busy.mjs`** — pure, testable state machine (`BusyState`, `shouldPace`, constants;
      `test-busy.mjs`). `THROTTLE_MS` is always-on per command; the **co-presence catch-up** holds
      are skipped when alone: **+`OBJECT_LOAD_MS` (1s) per object** in a make-storm *my* command
      triggered (each `make`/`HEREIS_$` while my command is outstanding), and an **`ARRIVAL_MS`
      (~5s) hold on my own `APPEARING_$`** (co-present clients loading my head/hands/3 pockets).
      Idle makes from others (someone grabbing an ATM coin) are inert — they never freeze my UI,
      exactly as the C64 didn't.
    - **`lib/live.js`** — a `busy` signal + `withBusy(fn)` wrapper replaces the old `verbInFlight`
      latch and **gates every** outbound user action (pie verb + face-POSTURE, gesture, F-key,
      edge-walk, speak/TALK, ESP); `applyInbound` feeds `APPEARING_$`/makes to the state machine.
      Server-initiated ops (`AUTO_TELEPORT_$`, the hatchery `CUSTOMIZE` modal) stay ungated.
    - **`lib/cursor-view.js` / `cursor-sprites.mjs`** — the blink (icon↔black at `BLINK_MS`) and the
      frozen input bail. Region transit stays **blink-only** over the instantly-rendered region (no
      `wait_for_region` black curtain — a deliberate deviation).
    - *Deferred:* lift `busy.mjs` into habiworld so habibot/sagebot/textclient inherit the same
      pacing (it's pure precisely so the lift is mechanical); calibrate the constants against the
      C64 (`flash_rate`/`throttle_duration`) + VICE; a bridge "C64-present" flag to refine
      `shouldPace`. No bridge changes this round. Acceptance bar before release: a co-present C64 in
      VICE neither overruns nor sees the webclient act before it has rendered it.

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
