// project.js — habitat object coordinates → 3D world coordinates for the diorama client.
//
// PURE and dependency-free (no Three, no DOM, no habiworld import) so it runs identically in the
// browser and under `node --test`. Everything here is a faithful port of the C64/2D coordinate
// contract; the values are model invariants, not rendering choices:
//
//   • x ∈ [0,160], snapped to a 4px grid. signedXCoordinate() lets an object sit just off the
//     left edge (modX > 208 ⇒ negative), exactly as region.js:552.
//   • y is DUAL-PURPOSE (habiworld kernel.js:50-56): bit 0x80 (FOREGROUND_BIT) flags the
//     foreground/avatar render layer; the low 7 bits are depth into the region's walkable band
//     [0, region.depth]  (region.depth default 32 = DEFAULT_REGION_DEPTH).
//
// The 2D client overloads screen-Y as depth via zIndexFromObjectY (region.js:553) and paints
// back-to-front. We instead give depth a real axis and let the GPU depth-buffer order things.
// The faithful reading of the FOREGROUND bit for a *single-wall theater set* is:
//
//   • FOREGROUND object  → stands ON THE FLOOR at depth (y & 0x7f) into the walkable band.
//                          world-Z = depth, world-Y = 0 (its billboard base rests on the floor).
//   • BACKGROUND object  → hangs ON THE BACK WALL at height y (0..127 up the backdrop).
//                          world-Z = wall (max depth), world-Y = y.
//
// World units are the 320×128 stage's *canvas pixels* (before the 2D client's 3× display Scale),
// so billboard textures — which canvasFromBitmap already emits in doubled canvas px — share one
// scale with positions and land the same size the 2D client draws them.
//
// Axis convention: +X right, +Y up, and the scene RECEDES toward −Z (depth is negative). The
// camera sits in front (+Z) looking toward −Z, so world +X lands on screen-right (matching habitat
// x) and billboards' default front faces point at the camera (no mirroring). Getting this sign
// wrong flips the whole scene left-for-right.

// ── Model invariants (mirror habiworld/lib/constants.js + kernel.js) ─────────────────
export const FOREGROUND_BIT = 0x80
export const DEFAULT_REGION_DEPTH = 32
export const STAGE_W = 320 // canvas px; 160 habitat-x units × 2
export const STAGE_H = 128 // canvas px; also the max background wall height

// signedXCoordinate (region.js:552): x just past the right half of the byte is really a small
// negative x (object hanging off the left edge). 208 = the C64 threshold used by the 2D client.
export const signedX = (modX) => (modX > 208 ? modX - 256 : modX)

// zIndexFromObjectY (region.js:553) — kept for parity/diagnostics and as a stable tiebreaker for
// coplanar sprites; the depth buffer does the real ordering. Foreground (y>127) always sorts in
// front of background, nearer (smaller y&0x7f) in front within the foreground band.
export const zLayerFromY = (modY) => (modY > 127 ? 128 + (256 - modY) : modY)

export const isForeground = (modY) => (modY & FOREGROUND_BIT) !== 0

// Horizontal placement, exact parity with region.js propLocationFromObjectXY:
//   display column = floor(signedX / 4); canvas px = column × 8  (render.js:116,130).
export const worldXFromModX = (modX) => Math.floor(signedX(modX) / 4) * 8

// Default projection tuning. depthScale stretches the shallow (≤32px) walkable band into a floor
// that actually reads as receding; it's the one free aesthetic knob (the 2D client had none).
// bgLayerStep staggers background objects slightly toward the camera by height so the 2D
// front-to-back-by-Y order among wall art (zIndexFromObjectY = y for backgrounds) is preserved
// instead of every backdrop z-fighting on one plane.
export const DEFAULT_PROJECTION = {
  depthScale: 4.0,   // world-units of floor depth per habitat depth-unit
  bgLayerStep: 0.06, // world-units of forward stagger per habitat-y for background wall art
}

// Clamp a foreground object's depth into the region's walkable band, matching cursorGoXY /
// find_goto_coords clamping (kernel.js:65-68).
export const bandDepth = (modY, regionDepth = DEFAULT_REGION_DEPTH) => {
  let d = modY & 0x7f
  if (d < 0) d = 0
  else if (d > regionDepth) d = regionDepth
  return d
}

// The one function the renderer calls. (x, y) must already be the object's EFFECTIVE position —
// for a seated avatar the caller resolves to the seat's x/y first (see effectiveXY below), because
// a seated avatar's own x/y are slot data, not coordinates.
//
// Returns world coords in stage-canvas-px units:
//   wx: lateral (0..320)          wy: height off the floor (0 for floor-standers, y for wall art)
//   wz: depth into the scene (0 = nearest the camera, larger = toward the back wall)
//   foreground: which plane it belongs to      zLayer: parity z (diagnostic / coplanar tiebreak)
export const worldFromObjectXY = (modX, modY, regionDepth = DEFAULT_REGION_DEPTH, cfg = DEFAULT_PROJECTION) => {
  const wx = worldXFromModX(modX)
  const foreground = isForeground(modY)
  const floorZ = regionDepth * cfg.depthScale // magnitude of the floor's far (wall) edge
  if (foreground) {
    // Stands on the floor at depth (y&0x7f), receding toward −Z (nearest the camera at wz=0).
    const depth = bandDepth(modY, regionDepth)
    return { wx, wy: 0, wz: -depth * cfg.depthScale, foreground: true, zLayer: zLayerFromY(modY) }
  }
  // Background art hangs on the back wall: y is height up the backdrop (habitat y-up), not depth.
  // Sits just in front of the wall plane (−floorZ), staggered forward by height so higher-y art
  // draws in front — the 2D zIndexFromObjectY order for backgrounds.
  const h = modY & 0x7f
  const wz = -floorZ + (h + 1) * cfg.bgLayerStep
  return { wx, wy: h, wz, foreground: false, zLayer: zLayerFromY(modY) }
}

// Resolve an object's EFFECTIVE (x, y) before projection, handling the seating "pretend
// containership" hack (habiworld world.js:246-268): a seated avatar is contained by the SEAT, its
// own mod.x/y are the sit slot, and its floor position is the seat's. Pure over two records so it
// stays node-testable; the caller passes the container record (or null) it already has.
//   rec:          { mod:{x,y,...}, containerRef }
//   containerRec: the record for rec.containerRef, or null if rec is region-contained
//   regionRef:    world.region.ref
// Returns { x, y } in habitat coordinates to feed worldFromObjectXY.
export const effectiveXY = (rec, containerRec, regionRef) => {
  if (rec.containerRef && rec.containerRef !== regionRef && containerRec?.mod) {
    // Seated / contained: use the container's floor position (the seat), not our slot data.
    return { x: containerRec.mod.x, y: containerRec.mod.y }
  }
  return { x: rec.mod.x, y: rec.mod.y }
}
