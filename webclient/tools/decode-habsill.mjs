// Decode the original C64 Habitat title "silhouette" (hab + sill) into a PNG.
//
// Main/habsill3.m is 5120 bytes of pure `byte` data, linked by Main/Makefile's slinky call
// (-l 0x4b40 $(OBJS4)) straight into Bitmap_screen_1 ($4b40) — the 128-line × 40-byte VIC
// multicolor bitmap band. It's compiled into the client and already in graphics RAM at boot;
// the comet flies over it. This script reads that source, decodes the C64 multicolor bitmap,
// and emits a crisp 320×128 PNG of the original bits.
//
// Multicolor palette (uniform, from Main/init.m): 00 → $d021 black, 01 → screen-RAM hi nibble
// (cyan), 10 → screen-RAM lo nibble (black), 11 → color-RAM (color_sky / light blue). C64 RGB
// from colodore (matches habirender/render.js c64Colors).
//
// Usage: node tools/decode-habsill.mjs [path/to/habsill3.m] [out.png]

import { readFileSync, writeFileSync } from "node:fs"
import { deflateSync } from "node:zlib"

const SRC = process.argv[2] || `${process.env.HOME}/habitat-orig/sources/c64/Main/habsill3.m`
const OUT = process.argv[3] || new URL("../assets/habsill.png", import.meta.url).pathname

const CELLS_W = 40          // bytes per scanline / cells across
const CELL_ROWS = 16        // 128 lines / 8
const W = 320               // 160 multicolor px × 2 display px
const H = 128

// Multicolor 2-bit → RGBA, snapped to the C64 16-color palette by sampling the original screen
// photo (assets/title.png) at each bit's positions and voting nearest-color:
//   00 → blue (the SKY) · 01 → cyan · 10 → black (the dominant silhouette mass) · 11 → light blue.
// The sky (00) is emitted TRANSPARENT so the blue .title-sky layer shows through and the comet,
// which sits behind the silhouette, streaks across it — occluded by the opaque foreground bits.
const C64 = { black: [0x00, 0x00, 0x00], cyan: [0x75, 0xce, 0xc8], blue: [0x2e, 0x2c, 0x9b], ltblue: [0x70, 0x6d, 0xeb] }
const PAL = [
  [0, 0, 0, 0],                  // 00 — sky (transparent; blue comes from .title-sky behind)
  [...C64.cyan, 0xff],           // 01 — cyan
  [...C64.black, 0xff],          // 10 — silhouette mass (black) — occludes the comet
  [...C64.ltblue, 0xff],         // 11 — light blue highlight
]

// Pull every 0xNN byte, in order, from the assembler source.
const bytes = (readFileSync(SRC, "utf8").match(/0x[0-9a-fA-F]{2}/g) || []).map((h) => parseInt(h, 16))
if (bytes.length < CELLS_W * CELL_ROWS * 8) {
  throw new Error(`habsill3.m: expected ${CELLS_W * CELL_ROWS * 8} bytes, got ${bytes.length}`)
}

// RGBA framebuffer.
const px = Buffer.alloc(W * H * 4)
const put = (x, y, rgba) => {
  const o = (y * W + x) * 4
  px[o] = rgba[0]; px[o + 1] = rgba[1]; px[o + 2] = rgba[2]; px[o + 3] = rgba[3]
}

// C64 bitmap layout: 8×8 cells, cell-major; each cell is 8 consecutive bytes (one per row).
for (let cy = 0; cy < CELL_ROWS; cy++) {
  for (let cx = 0; cx < CELLS_W; cx++) {
    for (let r = 0; r < 8; r++) {
      const b = bytes[(cy * CELLS_W + cx) * 8 + r]
      const y = cy * 8 + r
      for (let p = 0; p < 4; p++) {
        const bits = (b >> (6 - p * 2)) & 0x3   // MSB-first 2-bit pixels
        const rgb = PAL[bits]
        const x = (cx * 4 + p) * 2               // multicolor px = 2 display px wide
        put(x, y, rgb)
        put(x + 1, y, rgb)
      }
    }
  }
}

// ── minimal RGBA PNG encoder ───────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const typeData = Buffer.concat([Buffer.from(type, "latin1"), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(typeData))
  return Buffer.concat([len, typeData, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // 8-bit RGBA
// Filter byte 0 per scanline.
const raw = Buffer.alloc((W * 4 + 1) * H)
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
])
writeFileSync(OUT, png)
console.log(`wrote ${OUT} (${W}×${H}, ${png.length} bytes) from ${bytes.length} source bytes`)
