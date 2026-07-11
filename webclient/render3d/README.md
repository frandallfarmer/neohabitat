# NeoHabitat 3D "Diorama" Client — Proof of Concept

A second renderer for NeoHabitat that draws each region as a **fixed-camera 3D diorama**
instead of the flat 2D scene. It is a **separate, additive alternate client**: the existing
2D web client (`live.html`) is untouched. Entry point:

```
http://<host>/webclient/live3d.html[?debug=1]     # avatar name is prompted at the title screen
```

The bet — and why it works — is that Habitat is *already 2.5-D*: object `y` is overloaded as
depth, each region is a **single-wall theater set** viewed head-on, and `habiworld` (the world
model) is already renderer-agnostic. So a 3D client is a **presentation swap, not a rewrite** —
reuse the model, verbs, events, sound, and decoded art; replace only the 2D-DOM tail with a
Three.js scene.

## Status

Working end-to-end on the live bridge feed across indoor and outdoor regions (Immigration /
hatchery, City Library, Plaza Fountain/West, 44 Aric Ave front + interior):

- Region backdrop rendered as real floor + back-wall geometry, textured from the region's own art.
- Foreground props and avatars as depth-sorted billboards (GPU depth buffer, not painter's-Y).
- Avatar composition (head/hand/body/pose) reused from the 2D client; walks animate smoothly.
- Contained items (a phone on a desk) placed on their container's plane; opaque containers and
  avatar inventory correctly hidden.
- Original SID sound (via `habisound`), click-to-walk (GO), click-to-verb (GET / shift = DO).
- Camera auto-frames the full back wall per aspect; survives window resize; one bad object or a
  bad frame can't freeze the scene.

Remaining gaps are listed under **Known limitations**.

## Architecture — the seam

`habiworld` already defines the renderer contract as a `client` callback bag. The 2D web client is
one implementation of it; this is a second one. Data flow mirrors `lib/live.js`:

```
websocketProxy → Transport → world.apply (habiworld: state + host behaviors) → scene.syncObjects
                             └→ ctx.sound / dispatch (verbs)   ── same callback bag as 2D
```

| Layer | In the 3D client |
|---|---|
| World model, verbs, events (`habiworld`) | **reused verbatim** |
| Transport, presentation bag, dispatch (`lib/transport.js`, `presentation.js`, `world-client.js`) | reused; wired by `lib/live3d.js` (a lean clone of `live.js`) |
| Sound (`habisound` + `lib/sound.js`) | **reused 100%** |
| Cel decode + avatar composition (`habirender/codec.js`, `render.js`, `computeLayoutMap`) | reused — produces RGBA frame canvases used as billboard/backdrop textures |
| The 2D DOM tail (region.js DOM, `canvasImage`, CSS z-index, `pick.mjs` readback) | **replaced** by `render3d/` (Three.js) |

`render3d/` files: `project.js` (coordinate projection), `env.js` (floor/wall geometry),
`backdrop.js` (bg composite + split), `billboard.js` (textured quad), `scene.js` (the scene +
reconciler + picking). `project.js`/`env.js`/`backdrop.js` are pure and unit-tested
(`test-project3d.mjs`, `test-env3d.mjs`).

## The rendering model & insights

Most of this was learned by tracing live region data; several points are non-obvious C64-isms.

### Coordinates & the horizon
- **x** ∈ [0,160] (4px grid). Horizontal world-X = `floor(signedX(x)/4)*8`, exact 2D parity.
- **y** is dual-purpose: bit `0x80` (FOREGROUND) flags the render layer; the low 7 bits are the
  vertical value `v`. The **horizon is at `v = region.depth`** (verified: Immigration's door sits
  at `y=32`, `region.depth=32`).
  - `v ≤ region.depth` → **on the floor**, receding into the scene at depth `v`.
  - `v > region.depth` → **on the back wall**, height `v − region.depth` above the horizon.
  - The FOREGROUND bit only affects draw order (avatars over floor props), *not* vertical position.

### Axis convention
The scene recedes toward **−Z**; the camera sits in **front (+Z)** looking −Z. This makes habitat
`+X` land on **screen-right** and lets billboards face the camera with their default front (no
rotation). Getting this backwards mirrors the whole scene left-for-right — a bug that hides on a
symmetric room (Immigration) and is obvious on an asymmetric one (City Library).

### The backdrop: render the whole bg pass, then split at the horizon
Rather than classify flats (sky vs ground vs wall), we render the **entire background pass** into
one 320×128 canvas exactly as the 2D client's `generateRegionCanvas` (same `zIndexFromObjectY`
sort, same `positionInRegion` draw — `backdrop.js`), then **split it at the horizon**:

- top `STAGE_H − region.depth` rows → the **wall** (above the horizon = sky/backdrop);
- bottom `region.depth` rows → **remapped onto the receding floor** (the perspective un-projection
  of the 2D ground band).

This is fully general and honors a crucial C64 hack for free: **backdrop flats are given
artificially low Y** so the single Y-sorted paint puts them at the *back*; their cel art then
extends up/across to fill their band. The anchor-Y is a *z-sort device, not a position* — placing
a `v=0` sky by its anchor would drop it at the camera and paint the whole frame. Because we replay
the 2D paint order and split geometrically, stacked flats (Plaza Fountain's blue sky + green grass
band), doors, and signs all land correctly with no special cases.

### Async trap-fill gotcha
Trapezoid flats (sky/ground/wall) allocate their frame canvas at full size **up front** and fill
the pixels **in place** seconds later when the trap `.bin` loads — the frame object, the canvas
object, *and* its `width×height` all stay identical while opacity goes 0→100. A backdrop cache
keyed on set/size/identity therefore never rebuilds (City Library rendered all-black; the
Immigration sign lost its text). Fix: after a bg-set change, a throttled ~10 s window rebuilds +
**checksums** the composite and re-uploads only when the pixels change — self-healing, then it
settles. *Whenever a 3D texture derives from cel/trap art, watch for this in-place fill.*

### Foreground billboards
Because the camera is fixed and front-facing, a billboard is just a vertical quad at constant Z —
no per-frame "face the camera". Floor objects stand on the floor; wall objects hang on the wall.
Avatar frames (with composed head/hand/pose) come straight from `computeLayoutMap`.

### Contained items (mirrors 2D `regionItemView` / `containedItemLayout`)
A contained item's layout is already **container-relative** (computeLayoutMap ran
`containedItemLayout`). It renders on the **container's plane**: `wx` from its own layout, `wy =
containerPlace.wy + (item.minY − container.minY)`, `wz = containerPlace.wz ± fgBias` (front/behind
per `contentsInFront`). Visibility:

- **Real container (box/desk):** shown only if the container displays that slot —
  `contentsXY.length > slot`. An **opaque** container (no `contentsXY` table) hides its contents
  (the open-box-showing-contents case). Glue containers offset via mod fields, always shown.
- **Body container (avatar):** head/hands are composed into the body frame; pocket inventory is
  invisible in-region — contained items on a body are **never** separate billboards.
- Seated avatars (an Avatar in a non-body seat) use the normal `effectiveXY` seat path, not this.

### Camera framing
Pull the camera back far enough to frame the **full wall width** (`STAGE_W`) for the current
aspect — `camZ = max(wallZ*1.15, ((STAGE_W/2)*1.15)/tan(hHalf) − wallZ)` — recomputed on resize.
Scaling distance by `wallZ` alone let a *shallow* region (Plaza, small `region.depth`) sit too
close and clip the wall. Deep regions keep black side-margins, which is fine.

## Item picking

**Implemented:**
- **Floor → GO.** Raycast the floor plane; inverse-project the hit to habitat `(x, y)` and dispatch
  GO against the region's ground object (`findGroundObject`) — matching the 2D pick's fallback.
- **Foreground billboard → verb.** Raycast the billboard group; each mesh carries `userData.noid`;
  dispatch GET (shift = DO) against it. Contained items (now billboards) are pickable this way too.

**Picking background objects (the transform-back) — implemented (`scene.js` `pickAt`).**
Background objects (signs, doors, machines, wall art) are **baked into the backdrop texture**, so
they have no individual meshes to raycast. The approach (fully general):

1. On a pointer event, first raycast the foreground billboard group (above). If it hits, done.
2. Otherwise raycast the **wall** and **floor** meshes. Three's `intersection.uv` gives the hit's
   texture coordinate on that mesh.
3. Convert that UV back into **2D backdrop canvas coordinates** — the inverse of the horizon split:
   - wall hit: `canvasX = uv.x * STAGE_W`, `canvasY = (1 − uv.y) * (STAGE_H − region.depth)`;
   - floor hit: `canvasX = uv.x * STAGE_W`, `canvasY = (STAGE_H − region.depth) + (1 − uv.y) * region.depth`.
     (Both account for `CanvasTexture` `flipY`; validate the exact `uv.y` handedness against a
     known landmark like the Immigration door.)
4. Run the **existing 2D picker** — `pick.mjs` `pickAt(layoutMap, objects, canvasX, canvasY)` — at
   those coordinates to resolve the background object (with cel-level `celNumber`, which the door's
   pass-through GO uses). Dispatch the verb against its noid.

This reuses the entire, already-correct 2D hit-test (cel-alpha, trapezoid quad containment,
held-item redirect) by mapping the 3D hit back onto the un-split backdrop the picker expects. Only
the UV→canvas mapping in step 3 is new. Keep a per-frame cache of the region↔backdrop mapping so a
click is O(1).

## Known limitations
The 3D client now runs on the shared app-shell (`lib/app-shell.js`) parameterized by a renderer
adapter (`lib/render3d-adapter.js`), so balloons, text input, the inventory grid, the customizer,
multi-region transitions (perspective edge wedges), the full verb set, and background-object /
held-item picking all work through the **same renderer-agnostic code as the 2D client** — no
3D-specific versions of those overlays. Remaining:
- **Neighbor-region previews (experimental, on by default).** The left/right grey margins are filled
  with the adjacent regions' pre-rendered bitmaps (`render3d/neighbors.js`) so streets visually
  continue. Disable with `?neighbors=0`. Matched/180°/±90° facings are handled; corner (diagonal)
  neighbors are a future refinement. The valid-exit chevrons (only where a neighbor exists) are
  independent of this switch and always on.
- **Floating region-name labels (experimental).** The current region's name floats in the grey band
  above the wall; each neighbor's name floats as a "To …" exit — the left/right ones raked onto the
  next-region selection wedge's diagonal, the down one in the chevron band (`render3d/labels.js`,
  drawn on top with `depthTest:false`). The current name always shows; the "To …" exit names ride the
  `?neighbors=0` switch. North (behind the wall) has no surface and is skipped.
- The ground is a flat receding quad; a genuinely trapezoidal ground flat isn't yet promoted to its
  own angled geometry (`env.js` `trapQuad` exists but isn't wired).
- Occasional all-black avatar (a container/composition edge case) still open.
- `?debug=1` exposes `window.__scene3d` / `__pickState3d` / `__pick2D` for inspection — dev only.

## Try it
```
cd webclient && npm test          # pure-module unit tests (projection + geometry)
# dev stack serves the working tree at http://localhost:1701/webclient/
open http://localhost:1701/webclient/live3d.html   # enter your avatar name at the title screen
```
