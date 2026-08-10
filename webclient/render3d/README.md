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

---

# Solid Avatars — a second experiment (`voxel.js` / `avatarvox.js` / `avatar3d.html`)

The diorama draws avatars as **billboards**, which is right for props: they were only ever drawn
once. Avatars and heads are different — the 1986 artists drew them **three times**, side, front and
back (the fourth view is the mirrored side, paint.m). Three orthographic silhouettes 90° apart are
exactly the input a **visual hull** wants, so a genuinely solid avatar can be *recovered from the
art* rather than modelled by hand. All 160+ heads come along for free.

This is an experiment, not part of the client: `live.html` and `live3d.html` are untouched.

```
http://<host>/webclient/avatar3d.html      # the turntable lab + cardinal diff panel
```

## How it works

Per **part**, never per figure — intersecting whole-body silhouettes produces the classic
visual-hull phantom (the arm's depth applied at the torso's width). Habitat hands us the
decomposition for free, because the art is already per-limb.

```
solid(x,y,z) ⟺ front(x,y) ∧ side′(z,y) ∧ envelope(x,y,z)
```

Registration is not estimated: `region.js avatarLimbChainAt` is run three times, once per view, and
**a limb's horizontal position in the side view is its depth**. Colours come from the art — each
face wears the view that looks at it — with no lighting term, because the artists already painted
the difference between the views.

Voxels are non-cubic (2 × 1 × 2 world units) because a C64 multicolor pixel is 2 world units wide
and 1 tall. That is what makes an orthographic render at yaw 0 land on the 2D client's pixel grid.

## The spray can

The lab's four limb pickers are the spray can's four targets — LEG / TORSO / ARM / FACE
(equates.m), which is what `habiworld` `class_spray_can` addresses with `{op:'SPRAY', limb}` and
what the can's `SPRAY_CUSTOMIZE_0/1` reply writes back into the avatar's two `custom` bytes
(custom.m F5–F8 set the same four).

Those nibbles are **not colours**: they are indices into `celPatterns` (render.js, from
paint.m:447), each a 4×4 dither whose 2-bit cells choose between blue, the wildcard, black and
skin. "Pattern 9" means nothing as a number, so each picker is a popdown of the sixteen real
swatches, rendered through the same `canvasFromBitmap` the avatar's own limbs go through, over a
bitmap of all-wild pixels.

## Exporting a rotation as an animated GIF

The lab's **export** panel captures one full turn — even yaw steps, frame *N* omitted because it
would be frame 0 again, so the loop is seamless — and downloads it as an animated GIF named after
what is in it (`habitat-human-wizard0-stand.gif`).

The encoder is ours (`render3d/gifenc.js`), not a vendored library, because the expensive part of a
general GIF encoder is **colour quantization** and we have the opposite problem. GIF is a
palettized format capped at 256 colours; a Habitat rotation contains about **four** — the backdrop
plus whatever the dither draws from (blue, black, skin). The palette is just the set of colours
present, the mapping is exact and lossless, and what is left is a header writer plus LZW. That
keeps the webclient's zero-dependency, no-build-step posture intact.

Two things the renderer must keep doing for this to stay lossless, both load-bearing rather than
cosmetic: `antialias: false` (smoothed edges would blend C64 colours into thousands of in-between
values) and `preserveDrawingBuffer: true` (so a frame can be read back after it is drawn). The
export reports the palette size and shouts if any colour had to be approximated.

Transparency is offered but **off by default** — the C64 dither paints real black pixels, so a
transparent GIF dropped on a dark page loses the hat and the outlines.

## What the art can and cannot support

- **Only stand, walk and sit have three views.** `choreographyActions` pairs facings for those
  three and nothing else, so `wave`, `point`, `bend_over`, `throw`, `punch` are side-only. A
  rotating solid of a gesture would be invention, not restoration.
- **The far limb has no side art at all** — seen from the side the human's left arm is hidden, so
  animate.m does not draw it. Its depth profile is borrowed from its mirror partner (the limb
  sharing its pattern class), which is the one silhouette Habitat *did* draw for "an arm, in
  profile".
- **The views disagree on limb height by 2–8 rows** (side legs y0..28 vs front y0..24, and so on).
  A solid has one height per limb, so the front wins — it is the (x,y) mask and the only view
  showing both arms. Measured cost: ~8% of the side silhouette at stand, ~14% mid-walk.
- **Front and back silhouettes cannot both be honoured** — a solid's shadow is the same along +Z
  and −Z. The back cel paints the far faces; it never carves.
- **Walk cycles do not correspond**: 7 side frames against 3 front/back frames, phase-mapped.

## Verification

```
cd webclient && npm test                     # pure tests: test-voxel.mjs + test-gifenc.mjs
node check-avatar3d.mjs                      # cardinal fidelity through the REAL compositor
node check-avatar3d.mjs --screenshot DIR     # …plus a yaw sweep to look at
node check-avatar3d.mjs --gif DIR            # …plus exported GIFs, decoded by Chromium itself
```

`check-avatar3d.mjs` needs `playwright` importable from `webclient/`; it is deliberately **not**
named `test-*.mjs`, because `node --test` stays dependency-free. It asserts that the solid
rasterized along **+z is alpha-identical** to `composeAvatarFrameAt` — currently true for every
body style, head and pose it covers — and holds the side view to a regression budget rather than
claiming an exactness the art cannot support.

## Known artifacts

- A head hull is nearly cubic (head0 is 12 wide × 26 tall × 16 deep — the side cel carries the nose
  and hair profile), and a cube wearing the front cel on one facet and the profile on the next reads
  at 45° as **two flat portraits meeting at an edge**. Rounding the head hard (`roundHead` 1) turns
  that into a single 3/4 view; limbs want much less (`roundLimb` ~0.45). Angle-blended face colours
  would be the real fix.
- The borrowed far-arm profile sits at the same depth as the near arm, so at 45° the two arms
  separate visibly.
- **Do not render these on a black background.** The C64 wild-colour dither legitimately paints
  black pixels (`rgbaFromNibble`: `patternColors[2]` is colour 0), so a dark hat or a dithered robe
  reads as holes in the mesh. The figure is not falling apart; it is camouflaged.
