// C64 balloon quip bitmaps — Main/sprites.m sprite:: + quip_shadow (no canvas).

export const QUIP_SPRITE_ROWS = [
  [0xff, 0xff, 0xff],
  [0x3f, 0xff, 0xfc],
  [0x0f, 0xff, 0xf0],
  [0x07, 0xff, 0xe0],
  [0x03, 0xff, 0xc0],
  [0x01, 0xff, 0x80],
  [0x00, 0xff, 0x00],
  [0x00, 0xff, 0x00],
  [0x00, 0xff, 0x00],
  [0x00, 0x7e, 0x00],
  [0x00, 0x7e, 0x00],
  [0x00, 0x7e, 0x00],
  [0x00, 0x3c, 0x00],
  [0x00, 0x3c, 0x00],
  [0x00, 0x3c, 0x00],
  [0x00, 0x3c, 0x00],
  [0x00, 0x18, 0x00],
  [0x00, 0x18, 0x00],
  [0x00, 0x18, 0x00],
  [0x00, 0x18, 0x00],
  [0x00, 0x18, 0x00],
]

export const QUIP_SHADOW_ROWS = [
  [0x00, 0x00, 0x00],
  [0x40, 0x00, 0x02],
  [0x10, 0x00, 0x08],
  [0x08, 0x00, 0x10],
  [0x04, 0x00, 0x20],
  [0x02, 0x00, 0x40],
  [0x01, 0x00, 0x80],
  [0x01, 0x00, 0x80],
  [0x01, 0x00, 0x80],
  [0x00, 0x80, 0x01],
  [0x00, 0x80, 0x01],
  [0x00, 0x80, 0x01],
  [0x00, 0x40, 0x02],
  [0x00, 0x40, 0x02],
  [0x00, 0x40, 0x02],
  [0x00, 0x40, 0x02],
  [0x00, 0x24, 0x00],
  [0x00, 0x24, 0x00],
  [0x00, 0x24, 0x00],
  [0x00, 0x24, 0x00],
  [0x00, 0x18, 0x00],
]

export const QUIP_SPRITE_W = 24
export const QUIP_SPRITE_H = 21
export const QUIP_SCREEN_Y = 64
export const C64_TEXT_WINDOW_PX = 56
export const QUIP_PANEL_OVERLAP_PX = QUIP_SCREEN_Y - C64_TEXT_WINDOW_PX

export const C64_COLORS = [
  0x000000, 0xffffff, 0x813338, 0x75cec8, 0x8e3c97, 0x56ac4d,
  0x2e2c9b, 0xedf171, 0x8e5029, 0x553800, 0xc46c71, 0x4a4a4a,
  0x7b7b7b, 0xa9ff9f, 0x706deb, 0xb2b2b2,
]

function pixelsFromRows(rows) {
  const px = []
  rows.forEach((row, y) => {
    row.forEach((byte, bi) => {
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (0x80 >> bit)) px.push([bi * 8 + bit, y])
      }
    })
  })
  return px
}

export const QUIP_PIXELS = pixelsFromRows(QUIP_SPRITE_ROWS)
export const QUIP_SHADOW_PIXELS = pixelsFromRows(QUIP_SHADOW_ROWS)

const QUIP_MAIN_SET = new Set(QUIP_PIXELS.map(([x, y]) => `${x},${y}`))
const QUIP_MAIN_RIGHT = QUIP_PIXELS.reduce((acc, [x, y]) => {
  acc[y] = Math.max(acc[y] ?? -1, x)
  return acc
}, [])

/** Shadow only where it borders the main sprite — omit detached right-edge pixels. */
export function quipOutlineShadowPixels() {
  return QUIP_SHADOW_PIXELS.filter(([x, y]) => {
    if (x > (QUIP_MAIN_RIGHT[y] ?? -1)) return false
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && QUIP_MAIN_SET.has(`${x + dx},${y + dy}`)) return true
      }
    }
    return false
  })
}

// Bottom tip of sprite:: is at left+12; align tip to speaker anchor, not sprite left edge.
export function quipSpriteLeftPx(anchorPx) {
  return anchorPx - QUIP_SPRITE_W / 2
}

export function quipPixelCounts() {
  return { main: QUIP_PIXELS.length, shadow: QUIP_SHADOW_PIXELS.length }
}

export function vicCss(vicColor) {
  const rgb = C64_COLORS[vicColor & 15]
  return `#${rgb.toString(16).padStart(6, "0")}`
}