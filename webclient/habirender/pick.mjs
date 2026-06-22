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
const propValue = (entry) => entry?.prop?.value ?? entry?.prop ?? null

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

/**
 * pointer.m pointed_at_cel_number: which cel of a multi-cel object the click lands on.
 * Walks the frame's per-cel layers in draw order (last drawn = frontmost) and returns the
 * frontmost hit's 1-based cel number (mix.m numbers cels from 1), or null off every cel.
 * Used by generic_goToOrPassThrough.m (cel 2 = a door's black opening → walk through).
 */
export const celNumberAtFrame = (frame, canvasX, canvasY, itemPx, itemPy) => {
  const layers = frame?.celLayers
  if (!layers?.length) return null
  const lx = Math.floor(canvasX - itemPx)
  const ly = Math.floor(canvasY - itemPy)
  let celNumber = null
  for (const cl of layers) {
    const cx = lx - cl.offsetX
    const cy = ly - cl.offsetY
    if (cx < 0 || cy < 0 || cx >= cl.canvas.width || cy >= cl.canvas.height) continue
    const ctx = cl.canvas.getContext("2d", { willReadFrequently: true })
    if (ctx.getImageData(cx, cy, 1, 1).data[3] > 0) celNumber = cl.celIndex + 1
  }
  return celNumber
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

// region.js composeAvatarFrame paints the held item's pixels with this id in the avatar
// pick buffer (the rest hold which_limb+1, i.e. 1–4). The C64 sets drawing_which_object
// to the held object while drawing it (mix.m:568), making it pickable as its own object;
// the pick resolves this marker to the avatar's HANDS-slot item.
export const HELD_PICK_MARKER = 0x80
const AVATAR_HAND_SLOT = 5 // dataequates.m AVATAR_HAND

/** Raw pick-buffer id (red channel) at the click, or 0 for none/non-avatar. */
const markerAtFrame = (frame, canvasX, canvasY, itemPx, itemPy) => {
  const buf = frame?.limbCanvas
  if (!buf) return 0
  const lx = Math.floor(canvasX - itemPx)
  const ly = Math.floor(canvasY - itemPy)
  if (lx < 0 || ly < 0 || lx >= buf.width || ly >= buf.height) return 0
  const ctx = buf.getContext("2d", { willReadFrequently: true })
  const { data } = ctx.getImageData(lx, ly, 1, 1)
  return data[3] === 0 ? 0 : data[0]
}

/**
 * pointer.m which_limb: for an avatar frame carrying a pick buffer, read which body part
 * (0=LEG, 1=TORSO, 2=ARM, 3=FACE) covers the click. Returns null off any limb (non-avatars,
 * gaps, and the held item — that resolves to its own object in pickAt).
 */
export const limbAtFrame = (frame, canvasX, canvasY, itemPx, itemPy) => {
  const m = markerAtFrame(frame, canvasX, canvasY, itemPx, itemPy)
  return m >= 1 && m <= 4 ? m - 1 : null
}

/** The item an avatar holds (its HANDS-slot contents), for held-item picking. */
const heldItemOf = (objects, avatarRef) =>
  objects.find((o) => o.type === "item" && o.in === avatarRef
    && o.mods?.[0]?.y === AVATAR_HAND_SLOT) ?? null

export const regionTopLevelItems = (objects) => {
  const regionRef = objects.find((o) => o.type === "context")?.ref
  if (!regionRef) return []
  return objects
    .filter((o) => o.type === "item" && o.in === regionRef)
    .sort((a, b) => zIndexFromObjectY(a.mods[0].y) - zIndexFromObjectY(b.mods[0].y))
}

/**
 * Contents a non-opaque container displays on itself — e.g. items on a Table.
 * Mirrors regionItemView: a container shows its contents when prop.contentsXY is
 * non-empty (avatars composite their contents into the body frame, so they are
 * excluded via isBody). Order matches the renderer (contents sorted by slot/y
 * descending; last drawn is frontmost), and inFront says whether they draw on top
 * of (Table) or behind the container.
 */
const displayedContents = (objects, layoutMap, containerRef) => {
  const prop = propValue(layoutMap[containerRef])
  if (!prop || prop.isBody || !(prop.contentsXY?.length > 0)) {
    return { contents: [], inFront: true }
  }
  const contents = objects
    .filter((o) => o.type === "item" && o.in === containerRef)
    .sort((a, b) => b.mods[0].y - a.mods[0].y)
  return { contents, inFront: prop.contentsInFront !== false }
}

/**
 * The full back-to-front draw order the renderer produces: each region item, with
 * any displayed container contents placed in front of (Table) or behind it. The pick
 * walks this and keeps the last (frontmost) hit — the software twin of pointer.m
 * running boundary_check over the create_sort_table draw list.
 */
export const pickDrawOrder = (objects, layoutMap) => {
  const order = []
  for (const container of regionTopLevelItems(objects)) {
    const { contents, inFront } = displayedContents(objects, layoutMap, container.ref)
    if (inFront) order.push(container, ...contents)
    else order.push(...contents, container)
  }
  return order
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
  const items = pickDrawOrder(objects, layoutMap)
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
  let target = hit ?? findGroundObject(objects)
  if (!target) return null
  // pointer.m: the held item carries its own drawing_which_object, so a click on it
  // targets the held object, not the avatar; otherwise report which_limb for SPRAY.
  let whichLimb = null
  // pointer.m pointed_at_cel_number — which cel of the hit object the click landed on (1-based;
  // null off any cel or when nothing was hit and we fell back to the ground). generic_goToOrPassThrough
  // reads this: cel 2 is a door's black opening → walk through instead of up to the door.
  let celNumber = null
  if (hit) {
    celNumber = celNumberAtFrame(hitFrame, canvasX, canvasY, hitPx, hitPy)
    const marker = markerAtFrame(hitFrame, canvasX, canvasY, hitPx, hitPy)
    if (marker === HELD_PICK_MARKER) {
      target = heldItemOf(objects, hit.ref) ?? target
    } else if (marker >= 1 && marker <= 4) {
      whichLimb = marker - 1
    }
  }
  const mod = target.mods[0]
  return {
    object: target,
    noid: mod.noid,
    mod,
    habitatX,
    habitatY,
    canvasX,
    canvasY,
    whichLimb,
    celNumber,
  }
}