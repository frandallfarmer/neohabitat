// Node tests for the environment geometry (render3d/env.js).
import { floorGeometry, wallGeometry, trapQuad, stageRowToDepth } from "./render3d/env.js"
import { STAGE_W, STAGE_H } from "./render3d/project.js"

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, `${msg} (got ${a}, want ${b})`)

// ── floor: 6 verts (2 tris), flat (all wy=0), spanning z 0..wallZ and x 0..STAGE_W ──
{
  const f = floorGeometry(32)
  assert(f.positions.length === 18, "floor has 6 verts")
  assert(f.uvs.length === 12, "floor has 6 uvs")
  near(f.wallZ, 32 * 4, "wallZ = depth × depthScale")
  const ys = f.positions.filter((_, i) => i % 3 === 1)
  assert(ys.every((y) => y === 0), "floor is flat on the ground")
  const zs = f.positions.filter((_, i) => i % 3 === 2)
  near(Math.max(...zs), 0, "floor near edge at camera")
  near(Math.min(...zs), -128, "floor far edge at wall (−Z)")
  const xs = f.positions.filter((_, i) => i % 3 === 0)
  near(Math.min(...xs), 0, "floor left edge")
  near(Math.max(...xs), STAGE_W, "floor right edge")
}

// ── wall: vertical plane at z=wallZ, y from 0..STAGE_H ──
{
  const w = wallGeometry(32)
  const zs = w.positions.filter((_, i) => i % 3 === 2)
  assert(zs.every((z) => z === -128), "wall is at the far edge (−Z)")
  const ys = w.positions.filter((_, i) => i % 3 === 1)
  near(Math.max(...ys), STAGE_H - 32, "wall rises only above the horizon (STAGE_H − depth)")
  near(Math.min(...ys), 0, "wall base at the horizon")
}

// ── stageRowToDepth: bottom row is nearest (z 0), higher rows recede toward −Z, clamped to band ──
{
  const toDepth = stageRowToDepth(32)
  near(toDepth(STAGE_H - 1), 0, "bottom stage row → z 0 (nearest)")
  near(toDepth(STAGE_H - 1 - 10), -10 * 4, "10 rows up → −depth 10 × scale")
  near(toDepth(0), -32 * 4, "top of stage clamps to band depth (−Z)")
}

// ── trapQuad: far edge (top canvas row) recedes toward −Z, near edge (bottom row) toward camera ──
{
  const toDepth = stageRowToDepth(32)
  const corners = { x1a: 40, x1b: 120, x2a: 20, x2b: 140, yTop: STAGE_H - 1 - 20, yBottom: STAGE_H - 1 }
  const q = trapQuad(corners, toDepth)
  assert(q.positions.length === 18, "trapQuad has 6 verts")
  const zFar = toDepth(corners.yTop)
  const zNear = toDepth(corners.yBottom)
  assert(zFar < zNear, "far edge is deeper (more negative) than near edge")
  near(zNear, 0, "near edge at camera")
  near(zFar, -20 * 4, "far edge at depth 20 (−Z)")
}

console.log("env3d: all assertions passed")
