import assert from "node:assert/strict"
import {
  QUIP_SPRITE_W,
  QUIP_SPRITE_H,
  QUIP_PANEL_OVERLAP_PX,
  QUIP_SPRITE_ROWS,
  QUIP_SHADOW_ROWS,
  quipSpriteLeftPx,
  quipPixelCounts,
  quipOutlineShadowPixels,
  QUIP_PIXELS,
} from "./lib/quip-sprite-data.mjs"

assert.equal(QUIP_SPRITE_W, 24)
assert.equal(QUIP_SPRITE_H, 21)
assert.equal(QUIP_PANEL_OVERLAP_PX, 8)
assert.equal(quipSpriteLeftPx(88), 76)
assert.equal(QUIP_SPRITE_ROWS.length, 21)
assert.equal(QUIP_SHADOW_ROWS.length, 21)
const counts = quipPixelCounts()
assert.ok(counts.main > counts.shadow)
const outline = quipOutlineShadowPixels()
assert.ok(outline.length < counts.shadow)
const mainRight = QUIP_PIXELS.reduce((acc, [x, y]) => {
  acc[y] = Math.max(acc[y] ?? -1, x)
  return acc
}, [])
for (const [x, y] of outline) assert.ok(x <= (mainRight[y] ?? -1))

console.log("quip sprite tests ok")