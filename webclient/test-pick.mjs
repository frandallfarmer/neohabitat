// Node tests for region pick (pointer.m / fine_cel_point).
import {
  canvasPixelToMod,
  hitTestFrame,
  limbAtFrame,
  pickAt,
  findGroundObject,
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

console.log("test-pick: ok")