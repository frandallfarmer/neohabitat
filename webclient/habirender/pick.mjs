// Region picking — port of Main/pointer.m boundary_check / fine_cel_point.
//
// Walk the same z-ordered region objects the renderer draws (create_sort_table in
// render.m), front-to-back, and return the topmost object whose cel bitmap is
// non-transparent at the click. Only objects contained directly in the region are
// pickable (C64: OBJECT_contained_by == 0).

export const REGION_CANVAS_W = 320
export const REGION_CANVAS_H = 127
const REGION_SPACE = { minX: 0, minY: 0, maxX: 160 / 4, maxY: 127 }

const translateSpace = ({ minX, maxX, minY, maxY, ...extra }, dx, dy) => ({
  ...extra,
  minX: minX + dx,
  maxX: maxX + dx,
  minY: minY + dy,
  maxY: maxY + dy,
})

const compositeSpaces = (spaces) => ({
  minX: Math.min(...spaces.map((f) => (f ? f.minX : Infinity))),
  maxX: Math.max(...spaces.map((f) => (f ? f.maxX : -Infinity))),
  minY: Math.min(...spaces.map((f) => (f ? f.minY : Infinity))),
  maxY: Math.max(...spaces.map((f) => (f ? f.maxY : -Infinity))),
})

const topLeftCanvasOffset = (outerSpace, innerSpace) => {
  if (!innerSpace) return [0, 0]
  return [
    (innerSpace.minX - outerSpace.minX) * 8,
    outerSpace.maxY - innerSpace.maxY,
  ]
}

const zIndexFromObjectY = (modY) => (modY > 127 ? (128 + (256 - modY)) : modY)

export const canvasPixelToMod = (canvasX, canvasY) => {
  const displayX = Math.floor(canvasX / 8)
  const displayY = REGION_SPACE.maxY - Math.floor(canvasY)
  return {
    x: Math.max(0, Math.min(255, displayX * 4)),
    y: Math.max(0, Math.min(255, displayY)),
    displayX,
    displayY,
  }
}

const layoutValue = (entry) => entry?.layout?.value ?? entry?.layout ?? null

const objectSpaceFromLayout = ({ x, y, frames }) =>
  translateSpace(compositeSpaces(frames), x, y)

const positionInRegion = (space) => {
  const s = { ...space }
  if (s.minX >= REGION_SPACE.maxX) {
    s.minX -= 64
    s.maxX -= 64
  }
  return topLeftCanvasOffset(REGION_SPACE, s)
}

const frameAt = (layout) => {
  const frames = layout?.frames
  if (!frames?.length) return null
  return frames[0]
}

/** C64 fine_cel_point: non-transparent bitmap pixel at the click. */
export const hitTestFrame = (frame, canvasX, canvasY, itemPx, itemPy) => {
  if (!frame?.canvas) return false
  const lx = Math.floor(canvasX - itemPx)
  const ly = Math.floor(canvasY - itemPy)
  if (lx < 0 || ly < 0 || lx >= frame.canvas.width || ly >= frame.canvas.height) return false
  const ctx = frame.canvas.getContext("2d", { willReadFrequently: true })
  const { data } = ctx.getImageData(lx, ly, 1, 1)
  return data[3] > 0
}

/**
 * pointer.m which_limb: for an avatar frame carrying a limb-id buffer (region.js
 * composeAvatarFrame), read which body part (0=LEG, 1=TORSO, 2=ARM, 3=FACE) covers
 * the click. Returns null off any limb (non-avatars, gaps, held-item pixels).
 */
export const limbAtFrame = (frame, canvasX, canvasY, itemPx, itemPy) => {
  const limb = frame?.limbCanvas
  if (!limb) return null
  const lx = Math.floor(canvasX - itemPx)
  const ly = Math.floor(canvasY - itemPy)
  if (lx < 0 || ly < 0 || lx >= limb.width || ly >= limb.height) return null
  const ctx = limb.getContext("2d", { willReadFrequently: true })
  const { data } = ctx.getImageData(lx, ly, 1, 1)
  if (data[3] === 0 || data[0] === 0) return null
  return data[0] - 1
}

export const regionTopLevelItems = (objects) => {
  const regionRef = objects.find((o) => o.type === "context")?.ref
  if (!regionRef) return []
  return objects
    .filter((o) => o.type === "item" && o.in === regionRef)
    .sort((a, b) => zIndexFromObjectY(a.mods[0].y) - zIndexFromObjectY(b.mods[0].y))
}

/** Ground / street surface for cursor GO when nothing else is hit (kernel findGround). */
export const findGroundObject = (objects) => {
  const regionRef = objects.find((o) => o.type === "context")?.ref
  if (!regionRef) return null
  let ground = null
  for (const o of objects) {
    if (o.type !== "item" || o.in !== regionRef) continue
    const t = o.mods[0]?.type
    if (t === "Street" || t === "Ground") ground = o
    if ((t === "Flat" || t === "Trapezoid" || t === "Super_trapezoid")
        && o.mods[0].flat_type === 2) {
      ground = o
    }
  }
  return ground
}

/**
 * @returns {{ object, noid, mod, habitatX, habitatY, canvasX, canvasY } | null}
 */
export const pickAt = (layoutMap, objects, canvasX, canvasY) => {
  if (canvasX < 0 || canvasY < 0 || canvasX >= REGION_CANVAS_W || canvasY >= REGION_CANVAS_H) {
    return null
  }
  const items = regionTopLevelItems(objects)
  const { x: habitatX, y: habitatY } = canvasPixelToMod(canvasX, canvasY)
  let hit = null
  let hitFrame = null
  let hitPx = 0
  let hitPy = 0
  for (const obj of items) {
    const layout = layoutValue(layoutMap[obj.ref])
    const frame = layout && frameAt(layout)
    if (!layout || !frame) continue
    const space = objectSpaceFromLayout(layout)
    const [px, py] = positionInRegion(space)
    if (hitTestFrame(frame, canvasX, canvasY, px, py)) {
      hit = obj
      hitFrame = frame
      hitPx = px
      hitPy = py
    }
  }
  const picked = hit ?? findGroundObject(objects)
  if (!picked) return null
  const mod = picked.mods[0]
  // pointer.m which_limb — only set when an actual avatar limb was touched.
  const whichLimb = hit ? limbAtFrame(hitFrame, canvasX, canvasY, hitPx, hitPy) : null
  return {
    object: picked,
    noid: mod.noid,
    mod,
    habitatX,
    habitatY,
    canvasX,
    canvasY,
    whichLimb,
  }
}