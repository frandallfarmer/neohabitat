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

# Solid avatars

*A second experiment: `voxel.js` / `avatarvox.js` / `gifenc.js` / `avatar3d.html`.
User-facing writeup: [neohabitat.org → Solid Avatars](https://frandallfarmer.github.io/neohabitat-doc/docs/solid-avatars.html).*

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
what is in it (`habitat-human-wizard0-6968.gif`).

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

---

# Habitat Figure Lab — a skeletal 3D avatar with C64 colouring

```
http://localhost:1701/webclient/figure3d.html
```

A **second, separate** experiment from the solid avatar above, and both stay. The solid recovers a
true 3D figure from the 1986 cels and is pixel-exact at the cardinals — but it can only ever stand,
walk and sit, because those are the only poses the artists drew from more than one angle
(`POSE_TRIPLES` in `avatarvox.js`). A figure that cannot wave is not a Habitat avatar.

So this one inverts the trade. The body is a **CC0 rigged humanoid** (Quaternius *Casual Character*
— see `../assets3d/CREDITS.md`) that can be posed and animated freely, and the Habitat *look* is
bought back by porting the thing that actually makes a Habitat avatar look like one:

**the colouring model, not the artwork.**

## The core of it: `rgbaFromNibble` in GLSL

`habirender/palette.js` is Habitat's entire colour system, and it is four values deep:

```
patternColors = [6, wildcard, 0, skin]     // 6 is a fixed dark blue
nibble 0 → transparent
nibble 1 → WILD: two bits of celPatterns[pattern][y%4] chosen by (x%4)*2 → index patternColors
nibble 2 → black
nibble 3 → skin
```

Not a texture — an **index map plus three player-controlled values**, which is why a spray can could
recolour an avatar in 1986. `habimat.js` ports that to a shader and `test-habimat.mjs` proves the
port by running it against `rgbaFromNibble` itself over **every** combination of nibble, x%4, y%4,
pattern and a spread of colour choices. The GLSL mirrors `resolveNibble` statement for statement, so
it inherits that proof.

Three things make it work on geometry the C64 never drew:

1. **The nibble comes from the MATERIAL, the limb class from the SKELETON.** They cannot come from
   the same place: the Quaternius shirt is one material, but its short sleeves belong to Habitat's
   ARM slot while its body belongs to TORSO, and the bare arm below the sleeve is skin on the same
   mesh. Material answers *cloth / skin / outline*; the dominant skinning bone answers *which
   garment*.
2. **There are no textures to classify.** The pack ships nine flat-colour materials and
   `images: 0` — a surface already partitioned into nine regions is an index map somebody else
   drew. `CASUAL_MATERIAL_NIBBLES` makes the nine decisions explicitly; the heuristics in
   `classifyMaterials` are only a starting point for an unknown asset, and every material's
   deciding rule is printed in the lab.
3. **Shading stays inside the palette.** Habitat has no lighting, but an unlit low-poly humanoid at
   three-quarters has no readable form. `paletteRampFor` derives a dark/base/light ramp out of the
   16 colodore colours by hue and lightness, so an N·L term picks a neighbouring *palette entry*
   rather than inventing a colour. Off by default — the C64 was flat.

## The head is not an interpretation

The body is a stand-in; the head is the character. `buildHeadPart` (extracted from
`buildFigureParts`, registered to its own cel space instead of to a Habitat limb chain) recovers the
same true solid from the same three cels, for every entry in `heads.json`, and it hangs off the
rig's `Head` bone — so all 160-odd heads come along and follow every animation for free.

Two numbers had to be measured off the rig rather than guessed, and both were guessed wrong first:

- **Scale.** The head bone carries a world scale of **100** (the pack came out of FBX in
  centimetres) and a voxel is 2×1×2 world units. A hardcoded factor produced a head that filled half
  the frame. The lab now solves for the scale from the measured figure height, hull height and bone
  scale, so the requested head/body fraction is the fraction you get.
- **Where it mounts.** The `Head` bone is up inside the skull, so anchoring the hull's base there
  leaves the head on a stalk — and the bigger you make it the further it flies. The mount drops to
  the `Neck` bone, measured at bind, so growing the head engulfs the shoulders instead. Which is
  what a Habitat avatar looks like.

**The proportion is the real experiment.** On the C64 an avatar is 58 units and `head0` is 26 of
them — a Habitat head is **45%** of the figure. The Quaternius character's own head is 19%. The
slider spans both, and the default (30%) is a bid, not an answer.

## Gestures: authored, not found

Habitat has 30 chore actions; the pack has 24 clips. Three line up (`Idle`, `Walk`, `Wave`) and
nothing outside Habitat has `gimme`, `unpocket` or `bend_over`. But most Habitat gestures are a
**single held pose**, not a loop — so a gesture is about six numbers on four bones, which is a
slider panel and a JSON file rather than a Blender pipeline.

`habipose.js` keeps that pure (a pose is `{bone: [x,y,z]}` in degrees **as a delta from rest**, so it
transfers if the body is ever swapped); `poses.json` holds the table; the lab is the editor and
exports the file the same way the GIF export works.

⚠️ **Restoring bind pose before applying a pose is not optional.** Stopping an action does not undo
it — every bone stays where the last evaluated frame left it, and a pose only names twenty of
sixty-two. The other forty-two keep the residue of whatever played last, including `Root` and
`Body`, and the figure comes out subtly rotated and never the same twice. It reads as a broken pose
rather than as a stale skeleton.

**Coverage today: 3 authored, 4 from clips, 17 to do.** `poseCoverage` reports it and the lab prints
it; the remaining seventeen want somebody with the live slider and the original cel side by side,
which is exactly what the editor is for.

## The retro dial

`postfx.js`: render into a target 1/N the size, snap every pixel to the nearest colodore colour, ink
depth discontinuities black. Depth edges rather than an inverted hull because they need no second
skinning-aware material, they ink the seam where an arm crosses the torso, and they measure the
keyline in **final pixels** — so a 1px line stays 1px at every pixel size, which is what Habitat's
keylines were.

## Animated GIF export

`render3d/gifenc.js` is reused unchanged — see the Solid Avatar Lab section above for why a
hand-written encoder is the *small* option here (a Habitat frame carries about four colours, so the
palette is the set of colours present and the mapping is exact).

What is different is that this figure can move, so there are two independent things to animate and
the interesting one is not the turntable:

| motion | what it does |
|---|---|
| **spin + play** | one full turn while the clip loops a whole number of times — the default |
| **play in place** | camera still, one pass of the animation. A Habitat avatar *walking* |
| **spin only** | figure held still, 360° turn. What the solid lab does |

Every mode is seamless by construction: frame *N* would be frame 0 again, so it is not emitted.
**When there is a clip, the clip's own duration sets the tempo** — a walk cycle played at an
arbitrary frame rate is a walk cycle at the wrong speed, and that reads as wrong instantly. The
`fps` slider is only consulted when there is nothing to take the tempo from.

A gesture is a held pose with no timeline, so asking for "play in place" on one degrades to a
turntable and says so in the status line rather than emitting N copies of a single frame.

## Verification

```
cd webclient
node --test                     # includes test-habimat.mjs and test-habipose.mjs
node check-figure3d.mjs --screenshot --gif
```

The GIF path is checked by **encoding one and parsing it back** — header, one Graphic Control
Extension per frame, the trailer, an exact palette, and `animated` actually true for the clip modes.
The failure worth catching is not "the button threw"; it is a file that downloads happily and then
will not open, or opens as a still.

The headless check asserts two things that are exactly checkable, at every yaw and pixel size:

- **PALETTE** — with quantize on, *every* pixel in the framebuffer is one of the 16 colodore
  colours. Antialiasing, tone mapping, a stray sRGB conversion or a lit material all break this, and
  all of them are invisible by eye until the image is subtly not-C64 any more.
- **PIXEL GRID** — at pixel size N the framebuffer is constant over every aligned N×N block. This is
  what separates a real low-resolution render from a full-resolution one with a blur.

Plus role-colour presence (if skin stops appearing, the arms have gone missing) and a pin on the
vendored rig's 10 primitives / 62 bones / 24 clips.

⚠️ **Colour management must stay off on this page** (`THREE.ColorManagement.enabled = false`, plus
`LinearSRGBColorSpace` output and `NoToneMapping`). The shader's palette values were already exact —
they come from a `NoColorSpace` lookup texture — but the *clear colour* was not: Three converted the
hex to linear on assignment, nothing converted it back, `0x4a4a55` reached the framebuffer as
`0x141418`, and that quantized to **black**, which hid the black keyline against a black background.
Found by dumping actual pixels, not by reading documentation.

## Known limitations

- **Seventeen gestures are unposed** and fall back to rest. Stated, not hidden.
- **The pack's `Idle` and `Walk` are its own**, not Habitat's — Habitat's walk is a 7-frame cycle
  with a very particular gait, and matching it would mean authoring the cycle too.
- **The held prop is a billboard**, which is correct rather than lazy: Habitat props were drawn once
  from one angle, so there is no second view to build a solid from. It has a size slider but no hand
  offset, so it sits at the wrist rather than in the grip.
- **Non-human bodies are out of scope.** Habitat has seven body styles including Dragon, Tank and
  Tentacle; a humanoid rig covers none of them. They keep the hull/billboard path.
- **Height and sex** (`SEX_BIT`, `HEIGHT_MASK` in `lib/customize.mjs`) are not wired up yet; they
  want bone scaling rather than a second mesh.
- Nothing here touches `live.html` or `live3d.html`.
