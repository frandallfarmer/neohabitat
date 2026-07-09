// backdrop.js — composite the region's BACKGROUND objects into one 320×128 canvas exactly as the
// 2D client's bg pass (habirender/region.js generateRegionCanvas), then split it at the horizon
// onto the 3D wall (above) and floor (below).
//
// This replaces per-flat classification (sky vs ground vs wall): the C64 backdrop is whatever the
// bg pass paints — sky, ground, walls, signs, gradients, any stack of flats — so we just render it
// and split it geometrically. The bottom region.depth rows (below the horizon) are the 2D ground
// band; remapped onto the receding 3D floor they become the perspective floor. The anchor-Y sort
// hack (backdrop flats get low Y so they paint first/behind) is honored for free — we sort by the
// same zIndexFromObjectY the 2D client uses.

import { translateSpace, topLeftCanvasOffset } from "../habirender/render.js"
import { STAGE_W, STAGE_H, zLayerFromY } from "./project.js"

// The 2D region canvas space (pick.mjs REGION_CANVAS_W/H): x in 0..40 columns, y in 0..127 rows.
const REGION_SPACE = { minX: 0, minY: 0, maxX: STAGE_W / 8, maxY: STAGE_H - 1 }

// items: [{ frame, x, y, modY }] — frame = layout.frames[0]; x/y = layout.x/layout.y (draw origin,
// as computeLayoutMap produced them); modY = the object's raw y for the paint-order sort.
export const renderBackdrop = (items) => {
  const canvas = document.createElement("canvas")
  canvas.width = STAGE_W
  canvas.height = STAGE_H
  const ctx = canvas.getContext("2d")
  // Back-to-front, exactly like sortObjects/zIndexFromObjectY (low Y = drawn first = behind).
  const sorted = [...items].sort((a, b) => zLayerFromY(a.modY) - zLayerFromY(b.modY))
  for (const it of sorted) {
    if (!it.frame?.canvas) continue
    const [ix, iy] = topLeftCanvasOffset(REGION_SPACE, translateSpace(it.frame, it.x, it.y))
    ctx.drawImage(it.frame.canvas, ix, iy)
  }
  return canvas
}

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
