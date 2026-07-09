// Node tests for the 3D diorama coordinate projection (render3d/project.js).
// Locks the projection to the 2D client's exact numbers so the two renderers agree on placement.
import {
  signedX,
  zLayerFromY,
  isForeground,
  worldXFromModX,
  bandDepth,
  worldFromObjectXY,
  effectiveXY,
  DEFAULT_REGION_DEPTH,
} from "./render3d/project.js"

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, `${msg} (got ${a}, want ${b})`)

// ── signedXCoordinate parity (region.js:552) ──
near(signedX(40), 40, "signedX in-range")
near(signedX(208), 208, "signedX boundary stays positive")
near(signedX(210), -46, "signedX past 208 is negative")

// ── horizontal placement parity with propLocationFromObjectXY (region.js:556) ──
// display column = floor(signedX/4); canvas px = column × 8.
near(worldXFromModX(80), 160, "worldX: 80 → col 20 → 160px")
near(worldXFromModX(0), 0, "worldX: left edge")
near(worldXFromModX(156), Math.floor(156 / 4) * 8, "worldX: right side")

// ── FOREGROUND bit routing (kernel.js:50-56) ──
assert(isForeground(160) === true, "avatar y=160 is foreground")
assert(isForeground(50) === false, "prop y=50 is background")

// ── foreground avatar stands on the floor at depth (y&0x7f), receding toward −Z ──
{
  const p = worldFromObjectXY(80, 160, 32)
  near(p.wx, 160, "fg wx")
  near(p.wy, 0, "fg rests on floor")
  near(p.wz, -32 * 4.0, "fg depth 32 × depthScale(4), into −Z")
  assert(p.foreground === true, "fg flagged")
  near(p.zLayer, 224, "fg zLayer = 128+(256-160)")
}

// ── background prop hangs on the back wall at height y, just in front of the wall plane ──
{
  const p = worldFromObjectXY(80, 50, 32)
  near(p.wy, 50, "bg height up the wall = y")
  near(p.wz, -32 * 4.0 + 51 * 0.06, "bg just in front of the wall, staggered by height")
  assert(p.foreground === false, "bg flagged")
  near(p.zLayer, 50, "bg zLayer = y")
}

// ── background front-to-back order preserved: higher-y art sits in front (larger, less-negative z) ──
{
  const low = worldFromObjectXY(80, 10, 32)
  const high = worldFromObjectXY(80, 90, 32)
  assert(high.wz > low.wz, "higher-y background draws in front of lower-y (2D zIndexFromObjectY)")
  assert(low.wz < 0 && high.wz < 0, "both background sit in the −Z scene near the wall")
}

// ── depth clamps into the walkable band (kernel.js:65-68) ──
near(bandDepth(160, 32), 32, "avatar depth 32 within band")
near(bandDepth(128 + 40, 32), 32, "depth 40 clamps to band 32")
near(bandDepth(128 + 10, 32), 10, "depth 10 within band")

// ── nearer foreground sorts in front (parity tiebreak) ──
assert(zLayerFromY(129) > zLayerFromY(160), "depth 1 (nearer) in front of depth 32")
assert(zLayerFromY(160) > zLayerFromY(127), "any foreground in front of any background")

// ── seating: a seated avatar projects at the SEAT's floor position, not its slot data ──
{
  const regionRef = "context-reg"
  const seat = { ref: "seat-1", mod: { x: 100, y: 128 + 20 }, containerRef: regionRef }
  const seated = { ref: "av-1", mod: { x: 0, y: 3 /* slot */ }, containerRef: "seat-1" }
  const eff = effectiveXY(seated, seat, regionRef)
  near(eff.x, 100, "seated avatar takes seat x")
  near(eff.y, 128 + 20, "seated avatar takes seat y")

  const free = { ref: "av-2", mod: { x: 60, y: 160 }, containerRef: regionRef }
  const effFree = effectiveXY(free, null, regionRef)
  near(effFree.x, 60, "free avatar keeps own x")
  near(effFree.y, 160, "free avatar keeps own y")
}

// ── default region depth constant matches habiworld ──
assert(DEFAULT_REGION_DEPTH === 32, "default band depth")

console.log("project3d: all assertions passed")
