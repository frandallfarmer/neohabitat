// Node tests for region pick (pointer.m / fine_cel_point).
import {
  canvasPixelToMod,
  hitTestFrame,
  limbAtFrame,
  pickAt,
  findGroundObject,
  HELD_PICK_MARKER,
  REGION_CANVAS_W,
} from "./habirender/pick.mjs"

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

assert(canvasPixelToMod(80, 127).x === 40, "habitat x from canvas")
assert(canvasPixelToMod(80, 127).y === 0, "habitat y from bottom click")

const mockCanvas = (w, h, opaqueAt) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (const [x, y] of opaqueAt) {
    const i = (y * w + x) * 4
    data[i + 3] = 255
  }
  return {
    width: w,
    height: h,
    getContext: () => ({
      getImageData: (x, y) => ({ data: data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4) }),
    }),
  }
}

const frame = {
  canvas: mockCanvas(16, 16, [[4, 4]]),
  minX: 0,
  maxX: 2,
  minY: -2,
  maxY: 0,
}
assert(hitTestFrame(frame, 36, 117, 32, 113), "pixel hit on opaque cel")
assert(!hitTestFrame(frame, 0, 0, 32, 113), "miss outside cel")

const regionRef = "context-test"
const objects = [
  { ref: regionRef, type: "context", mods: [{ type: "Region" }] },
  {
    ref: "item-ground",
    type: "item",
    in: regionRef,
    mods: [{ type: "Ground", noid: 1, x: 0, y: 0 }],
  },
  {
    ref: "item-box",
    type: "item",
    in: regionRef,
    mods: [{ type: "Box", noid: 42, x: 40, y: 100 }],
  },
]

const layoutMap = {
  "item-box": {
    layout: {
      x: 4,
      y: 14,
      z: 100,
      frames: [{ ...frame, minX: 0, maxX: 2, minY: -2, maxY: 0 }],
    },
  },
}

const pick = pickAt(layoutMap, objects, 36, 117)
assert(pick?.noid === 42, "picks foreground box noid")
assert(pick.habitatX === 16, "pick carries habitat x from click")

const groundPick = pickAt({}, objects, 8, 8)
assert(groundPick?.noid === 1, "falls back to ground object")
assert(findGroundObject(objects)?.ref === "item-ground", "findGroundObject")

assert(REGION_CANVAS_W === 320, "region width")

// ── Table (non-opaque container) — items on it are directly pickable ─────────
// A Table displays its contents (prop.contentsXY non-empty, contentsInFront), so the
// pick must walk those contents and let them win over the table they sit on.
const tableObjects = [
  { ref: regionRef, type: "context", mods: [{ type: "Region" }] },
  { ref: "item-table", type: "item", in: regionRef, mods: [{ type: "Table", noid: 50, x: 40, y: 140 }] },
  { ref: "item-on-table", type: "item", in: "item-table", mods: [{ type: "Box", noid: 51, x: 0, y: 0 }] },
]
const onTableFrame = { canvas: mockCanvas(16, 16, [[4, 4]]), minX: 0, maxX: 2, minY: -2, maxY: 0 }
const tableFrame = { canvas: mockCanvas(16, 16, [[4, 4]]), minX: 0, maxX: 2, minY: -2, maxY: 0 }
const tableLayoutMap = {
  "item-table": {
    prop: { contentsXY: [{ x: 0, y: 0 }], contentsInFront: true },
    layout: { x: 4, y: 14, z: 100, frames: [tableFrame] },
  },
  "item-on-table": { layout: { x: 4, y: 14, z: 100, frames: [onTableFrame] } },
}
assert(pickAt(tableLayoutMap, tableObjects, 36, 117)?.noid === 51,
  "item on the table is picked over the table")

// An opaque container (no contentsXY) hides its contents — the container itself wins.
const opaqueLayoutMap = {
  "item-table": { prop: { contentsXY: [] }, layout: { x: 4, y: 14, z: 100, frames: [tableFrame] } },
  "item-on-table": { layout: { x: 4, y: 14, z: 100, frames: [onTableFrame] } },
}
assert(pickAt(opaqueLayoutMap, tableObjects, 36, 117)?.noid === 50,
  "contents of an opaque container are not pickable")

// ── container_type==1 whole-object box hit (pointer.m fine_cel_point) ─────────
// A prop whose offset-3 byte == 1 (decodeProp boxHit) is hit by its whole bounding box with
// NO pixel test — every cel's box, even transparent ones. Newsstand fronts (newsstand1.bin) need
// this: a bitmap booth with a transparent display window must still select the vendor when the
// window (or the item shown behind it) is clicked.  A 16x16 frame with NO opaque pixels and a
// single full-frame celLayer: a normal cel would miss everywhere; boxHit makes the whole box win.
const boxHitFrame = {
  canvas: mockCanvas(16, 16, []), // entirely transparent
  boxHit: true,
  celLayers: [{ canvas: mockCanvas(16, 16, []), offsetX: 0, offsetY: 0, celIndex: 0 }],
  minX: 0, maxX: 2, minY: -2, maxY: 0,
}
assert(hitTestFrame(boxHitFrame, 36, 117, 32, 113), "container_type==1 box-hit on a transparent cel")
assert(!hitTestFrame(boxHitFrame, 0, 0, 32, 113), "boxHit still misses outside the cel box")
// Without boxHit the same transparent frame misses (proves the flag is what flips it).
assert(!hitTestFrame({ ...boxHitFrame, boxHit: false }, 36, 117, 32, 113),
  "same frame without boxHit misses the transparent cel")
const boxHitObjects = [
  { ref: regionRef, type: "context", mods: [{ type: "Region" }] },
  { ref: "item-stand", type: "item", in: regionRef, mods: [{ type: "Vendo_front", noid: 70, x: 40, y: 100 }] },
]
const boxHitLayoutMap = {
  "item-stand": { layout: { x: 4, y: 14, z: 100, frames: [{ ...boxHitFrame, minX: 0, maxX: 2, minY: -2, maxY: 0 }] } },
}
assert(pickAt(boxHitLayoutMap, boxHitObjects, 36, 117)?.noid === 70,
  "newsstand-style box-hit object is picked through its transparent window")

// ── which_limb buffer (pointer.m which_limb / region.js limb-id twin) ─────────
// The avatar's limbCanvas stores which_limb+1 in the red channel of each opaque
// pixel; limbAtFrame decodes it back to 0=LEG, 1=TORSO, 2=ARM, 3=FACE.
const mockLimbCanvas = (w, h, idAt) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (const [x, y, id] of idAt) {
    const i = (y * w + x) * 4
    data[i] = id // red channel = which_limb + 1
    data[i + 3] = 255
  }
  return {
    width: w,
    height: h,
    getContext: () => ({
      getImageData: (x, y) => ({ data: data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4) }),
    }),
  }
}

const limbFrame = {
  canvas: mockCanvas(16, 16, [[4, 4], [6, 6]]),
  limbCanvas: mockLimbCanvas(16, 16, [[4, 4, 3], [6, 6, 1]]), // (4,4)→ARM(2), (6,6)→LEG(0)
  minX: 0, maxX: 2, minY: -2, maxY: 0,
}
assert(limbAtFrame(limbFrame, 36, 117, 32, 113) === 2, "which_limb ARM at (4,4)")
assert(limbAtFrame(limbFrame, 38, 119, 32, 113) === 0, "which_limb LEG at (6,6)")
assert(limbAtFrame(limbFrame, 33, 114, 32, 113) === null, "transparent buffer pixel → no limb")
assert(limbAtFrame(frame, 36, 117, 32, 113) === null, "frame without limbCanvas → null")

const limbLayoutMap = {
  "item-box": { layout: { x: 4, y: 14, z: 100, frames: [limbFrame] } },
}
const limbPick = pickAt(limbLayoutMap, objects, 36, 117)
assert(limbPick?.noid === 42, "limb pick still resolves the object")
assert(limbPick.whichLimb === 2, "pick carries which_limb (ARM) from the buffer")
assert(pickAt(layoutMap, objects, 36, 117).whichLimb === null, "no buffer → whichLimb null")

// ── held-item picking (mix.m drawing_which_object) ───────────────────────────
// Held-item pixels carry HELD_PICK_MARKER in the pick buffer; a click there targets the
// held object (the avatar's HANDS-slot item, mod.y === 5), not the avatar or a limb.
const avatarObjects = [
  { ref: regionRef, type: "context", mods: [{ type: "Region" }] },
  { ref: "user-av", type: "item", in: regionRef, mods: [{ type: "Avatar", noid: 80, x: 40, y: 140 }] },
  { ref: "item-held", type: "item", in: "user-av", mods: [{ type: "Wand", noid: 81, x: 0, y: 5 }] },
]
const avatarFrame = {
  canvas: mockCanvas(16, 16, [[4, 4], [6, 6]]),
  limbCanvas: mockLimbCanvas(16, 16, [[4, 4, 3], [6, 6, HELD_PICK_MARKER]]), // (4,4)→ARM, (6,6)→held
  minX: 0, maxX: 2, minY: -2, maxY: 0,
}
const avatarLayoutMap = { "user-av": { layout: { x: 4, y: 14, z: 100, frames: [avatarFrame] } } }
const avLimbHit = pickAt(avatarLayoutMap, avatarObjects, 36, 117)
assert(avLimbHit?.noid === 80 && avLimbHit.whichLimb === 2, "avatar limb pixel → avatar + which_limb")
const heldHit = pickAt(avatarLayoutMap, avatarObjects, 38, 119)
assert(heldHit?.noid === 81, "held-item pixel targets the held object's noid")
assert(heldHit.whichLimb === null, "held-item pick reports no limb")

console.log("test-pick: ok")