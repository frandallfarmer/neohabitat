// env.js — the region's environment as REAL 3D geometry (not billboards).
//
// A Habitat region is a single-wall theater set: one backdrop wall, a floor, and props staged in
// front. The 2D client draws the ground/sky as flat "trapezoid" cels (trap / super_trapezoid) and
// fakes depth with painter's-Y order. Here we PROMOTE the set to actual geometry:
//
//   • the floor is one quad receding from the camera across the walkable band [0, region.depth];
//   • the back wall is one vertical quad at the far edge, STAGE_H tall.
//
// Props and avatars stay billboards (see billboard.js) standing on this floor. A genuinely
// trapezoidal ground flat (angled side walls / perspective floor in some regions) can be promoted
// per-cel with trapQuad() once its corners are validated against the 2D render (see the plan's
// risk note) — the basic floor+wall below is always correct and gets us a dimensional scene now.
//
// PURE and dependency-free: every function returns plain vertex arrays (flat [x,y,z, x,y,z, ...],
// two triangles per quad, CCW when viewed from the camera/front). Three consumes them in scene.js.
// World units are stage canvas px, matching project.js.

import { STAGE_W, STAGE_H, DEFAULT_REGION_DEPTH, DEFAULT_PROJECTION } from "./project.js"

// Two triangles (6 verts) for a quad given its four corners (each [x,y,z]).
// Order tl, tr, br, bl → triangles (tl,bl,br) and (tl,br,tr).
const quad = (tl, tr, br, bl) => [
  ...tl, ...bl, ...br,
  ...tl, ...br, ...tr,
]

// Matching UVs for the quad() vertex order (tl=(0,1) tr=(1,1) br=(1,0) bl=(0,0)).
const quadUV = () => [
  0, 1, 0, 0, 1, 0,
  0, 1, 1, 0, 1, 1,
]

// The floor plane: spans the full stage width, from the camera-near edge (depth 0, wy=0, wz=0)
// back to the wall (depth = region.depth → wz = wallZ). Lies flat (constant wy=0), so its far
// edge meets the base of the wall.
export const floorGeometry = (regionDepth = DEFAULT_REGION_DEPTH, cfg = DEFAULT_PROJECTION) => {
  const wallZ = regionDepth * cfg.depthScale // magnitude; the scene recedes toward −Z
  // Near edge (z=0) toward the front camera, far edge (z=−wallZ) at the wall.
  const nearL = [0, 0, 0]
  const nearR = [STAGE_W, 0, 0]
  const farR = [STAGE_W, 0, -wallZ]
  const farL = [0, 0, -wallZ]
  return { positions: quad(farL, farR, nearR, nearL), uvs: quadUV(), wallZ }
}

// The back wall = the SKY, the region ABOVE the horizon. Its base is the horizon (y=0, where the
// floor's far edge meets it) and it rises only (STAGE_H − region.depth) — the bottom region.depth
// rows of the full-frame sky are below the horizon (the ground) and are clipped off the texture
// (see applyFlatTexture). Background props hang just in front (project.js: wz = −wallZ + stagger).
export const wallGeometry = (regionDepth = DEFAULT_REGION_DEPTH, cfg = DEFAULT_PROJECTION) => {
  const wallZ = regionDepth * cfg.depthScale
  const wallH = STAGE_H - regionDepth
  const topL = [0, wallH, -wallZ]
  const topR = [STAGE_W, wallH, -wallZ]
  const botR = [STAGE_W, 0, -wallZ]
  const botL = [0, 0, -wallZ]
  return { positions: quad(topL, topR, botR, botL), uvs: quadUV(), wallZ, wallH }
}

// Promote a single trapezoidal ground/wall flat to a receding floor quad.
//
// A trap cel (region.js celLayerRenderer.trap, render.js:309) defines two horizontal edges in
// canvas space: a TOP edge from x1a→x1b at canvas row yTop, and a BOTTOM edge from x2a→x2b at
// canvas row yBottom (= yTop + height). On a floor flat the top edge is farther from the camera.
// We map each corner's canvas row to a depth and each canvas x to world-X, producing a real quad
// whose near edge (bottom, larger screen-y) sits toward the camera and whose far edge (top) recedes.
//
//   corners: { x1a, x1b, x2a, x2b, yTop, yBottom }  — canvas-space (px), as computed by the trap
//            renderer (post origin/xCorrection); pass them straight through.
//   toDepth(canvasY): stage-row → world depth (z). Larger canvasY (lower on screen) → smaller z.
//   toWorldX(canvasX): stage-column px → world x (identity in stage-px world; kept for symmetry).
//
// Returned positions are in the same stage-canvas-px world units as floorGeometry. This is the
// REFINEMENT path; validate its output against the 2D trapezoid for one region before relying on
// it (plan risk: the trap math is C64-quirky). Kept pure + tested with representative numbers.
export const trapQuad = (corners, toDepth, toWorldX = (x) => x) => {
  const { x1a, x1b, x2a, x2b, yTop, yBottom } = corners
  const zFar = toDepth(yTop)
  const zNear = toDepth(yBottom)
  const farL = [toWorldX(x1a), 0, zFar]
  const farR = [toWorldX(x1b), 0, zFar]
  const nearR = [toWorldX(x2b), 0, zNear]
  const nearL = [toWorldX(x2a), 0, zNear]
  return { positions: quad(farL, farR, nearR, nearL), uvs: quadUV() }
}

// A stage-row → depth mapping consistent with project.js: the walkable band occupies the bottom
// `region.depth` rows of the STAGE_H-tall stage; row (STAGE_H-1) is depth 0 (nearest), and rows
// climb toward the wall depth. Used to feed trapQuad's toDepth for floor flats.
export const stageRowToDepth = (regionDepth = DEFAULT_REGION_DEPTH, cfg = DEFAULT_PROJECTION) => {
  return (canvasY) => {
    let depth = STAGE_H - 1 - canvasY // rows below bandTop map into [0, regionDepth]
    if (depth < 0) depth = 0
    else if (depth > regionDepth) depth = regionDepth
    return -depth * cfg.depthScale // world Z (negative = into the scene)
  }
}
