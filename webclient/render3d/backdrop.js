// backdrop.js — split the region backdrop at the horizon onto the 3D wall (above) and floor (below).
//
// The backdrop itself is composited by the SHARED 2D compositor (habirender/region.js
// compositeRegion, bgOnly) so it is bit-identical to the 2D web client's render — there is no
// per-renderer reimplementation. Here we only split that canvas geometrically: the bottom
// region.depth rows (below the horizon) are the 2D ground band; remapped onto the receding 3D floor
// they become the perspective floor. The top rows are the sky/wall surface.

import { STAGE_H } from "./project.js"

// Split the backdrop at the horizon (region.depth rows up from the bottom).
//   wall  = the top (STAGE_H − depth) rows  → above the horizon → the sky/wall surface
//   floor = the bottom depth rows           → below the horizon → remapped onto the receding floor
// Both are drawn with standard UVs (quadUV) + the CanvasTexture default flipY, which lands the
// horizon-adjacent row at each plane's base — see env.js.
export const splitBackdrop = (backdrop, regionDepth) => {
  const w = backdrop.width
  const wallH = STAGE_H - regionDepth
  const wall = document.createElement("canvas")
  wall.width = w
  wall.height = wallH
  wall.getContext("2d").drawImage(backdrop, 0, 0, w, wallH, 0, 0, w, wallH)
  const floor = document.createElement("canvas")
  floor.width = w
  floor.height = regionDepth
  floor.getContext("2d").drawImage(backdrop, 0, wallH, w, regionDepth, 0, 0, w, regionDepth)
  return { wall, floor }
}
