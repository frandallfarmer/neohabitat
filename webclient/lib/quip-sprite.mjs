// C64 balloon quip renderer — transparent 24×21 mono sprite + shadow.

import { makeCanvas } from "../habirender/shim.js"
import {
  QUIP_SPRITE_W,
  QUIP_SPRITE_H,
  QUIP_PIXELS,
  quipOutlineShadowPixels,
  vicCss,
} from "./quip-sprite-data.mjs"

export {
  QUIP_SPRITE_ROWS,
  QUIP_SHADOW_ROWS,
  QUIP_SPRITE_W,
  QUIP_SPRITE_H,
  QUIP_SCREEN_Y,
  C64_TEXT_WINDOW_PX,
  QUIP_PANEL_OVERLAP_PX,
  quipSpriteLeftPx,
  quipPixelCounts,
} from "./quip-sprite-data.mjs"

export function renderQuipCanvas(vicColor) {
  const canvas = makeCanvas(QUIP_SPRITE_W, QUIP_SPRITE_H)
  const ctx = canvas.getContext("2d")
  ctx.clearRect(0, 0, QUIP_SPRITE_W, QUIP_SPRITE_H)
  ctx.fillStyle = "#000000"
  for (const [x, y] of quipOutlineShadowPixels()) ctx.fillRect(x, y, 1, 1)
  ctx.fillStyle = vicCss(vicColor)
  for (const [x, y] of QUIP_PIXELS) ctx.fillRect(x, y, 1, 1)
  return canvas
}