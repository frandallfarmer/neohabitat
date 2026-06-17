// Phase 0 capstone: the C64 Habitat title sequence.
//
// Faithful to Main/init.m + Main/comet.m (the comet is credited "By Kevin Furry"):
//   1. queue the 3-part title tune  → habisound.playTune('title')
//   2. zoom: a white sprite sweeps across the skyline, descending slightly
//   3. prompt the player to proceed
//
// Two deliberate web adaptations, both noted inline:
//   • Audio can't autoplay — the original's music just started; here a first click
//     supplies the gesture browsers require, then the sequence runs.
//   • The C64 comet had sprite priority *behind* the background; over an opaque photo
//     backdrop that would be invisible, so we draw it in front.
//
// The balloon here is a plain CSS bubble — the real Main/balloons.m port lands in
// Phase 4.

import { h } from "preact"
import htm from "htm"
import { useEffect, useRef, useState } from "preact/hooks"

const html = htm.bind(h)

// Region playfield is 320×200 C64 px; the stage shows it at this integer scale.
const SCALE = 2

// ── the comet sprite, exactly as poked into sprite 0 by Main/comet.m ──
// A 24-wide C64 sprite; init.m sets only these first three rows (the rest are 0).
// Bytes (MSB = leftmost pixel): rows at $41c1.. → sprite bytes 1,2 / 3,4,5 / 7,8.
const COMET_ROWS = [
  [0x00, 0x21, 0x26],
  [0x84, 0x44, 0x5f],
  [0x00, 0x10, 0x96],
]
const COMET_PIXELS = (() => {
  const px = []
  COMET_ROWS.forEach((row, y) =>
    row.forEach((byte, b) => {
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (0x80 >> bit)) px.push([b * 8 + bit, y])
      }
    }))
  return px
})()

// The C64 screen is exactly 320×200, but the VIC-II places that visible bitmap at
// *sprite* coordinates (24, 50): sprite X=24 is screen pixel 0, sprite Y=50 is screen
// pixel 0. comet.m moves the sprite in sprite coordinates, so we must subtract that
// origin to get screen pixels. (Skipping this is what put the comet ~50px too low —
// sprite y 148 is screen y 98, the vertical middle, not y 148 near the floor.)
const SPRITE_ORIGIN_X = 24
const SPRITE_ORIGIN_Y = 50

// Trajectory from comet.m: x_pos 24→344, y_pos comet_start_y(148)→+16, x moving ~20×
// faster than y. In screen pixels that is a full-width sweep (0→320) across the vertical
// middle (98→114). The exact inner-loop tick counts only set the speed, which we time.
const COMET = {
  x0: 24 - SPRITE_ORIGIN_X,  x1: 344 - SPRITE_ORIGIN_X,   // → 0 → 320
  y0: 148 - SPRITE_ORIGIN_Y, y1: 164 - SPRITE_ORIGIN_Y,   // → 98 → 114
  ms: 2400,
}

const TITLE_SRC = "./assets/title.png"
// Luminance below this counts as "black" art (or letterbox) that occludes the comet;
// brighter banner pixels reveal it. Tune if the comet shows too much / too little.
const DARK_THRESHOLD = 64

// Lazy, shared sound engine. Imported dynamically so a failure to load/init audio
// (or its AudioWorklet) degrades to a silent-but-working title — the visuals and the
// "proceed" flow never depend on sound.
let _hsPromise = null
async function getSound() {
  if (!_hsPromise) {
    _hsPromise = (async () => {
      const { HabiSound } = await import("../../habisound/lib/habisound.js")
      const hs = new HabiSound()
      await hs.init()
      return hs
    })()
  }
  return _hsPromise
}

const Comet = ({ playing, onDone }) => {
  const canvasRef = useRef(null)
  const maskRef = useRef(null) // offscreen: opaque black except the bright banner pixels

  // Build the occlusion mask once, from the same object-fit:contain rect the <img>
  // behind us uses. The C64 comet sprite had priority *behind* the foreground; this
  // reproduces that: black art, the dark gaps, and the letterbox cover the comet, so it
  // only shows over the lit/blue title pixels.
  useEffect(() => {
    const canvas = canvasRef.current
    const W = canvas.width, H = canvas.height
    const img = new Image()
    img.onload = () => {
      const s = Math.min(W / img.naturalWidth, H / img.naturalHeight) // contain
      const rw = img.naturalWidth * s, rh = img.naturalHeight * s
      const rx = (W - rw) / 2, ry = (H - rh) / 2
      const off = document.createElement("canvas")
      off.width = W; off.height = H
      const octx = off.getContext("2d")
      octx.drawImage(img, rx, ry, rw, rh)
      const id = octx.getImageData(0, 0, W, H), p = id.data
      for (let i = 0; i < p.length; i += 4) {
        const lum = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]
        if (p[i + 3] > 0 && lum >= DARK_THRESHOLD) {
          p[i + 3] = 0                                   // bright → reveal comet
        } else {
          p[i] = p[i + 1] = p[i + 2] = 0; p[i + 3] = 255 // dark/letterbox → occlude
        }
      }
      octx.putImageData(id, 0, 0)
      maskRef.current = off
    }
    img.src = TITLE_SRC
  }, [])

  useEffect(() => {
    if (!playing) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    const W = canvas.width, H = canvas.height
    let raf, start
    const trail = [] // recent head positions → a faint streak ("shoots across")
    const draw = (now) => {
      if (start === undefined) start = now
      const t = Math.min((now - start) / COMET.ms, 1)
      const hx = (COMET.x0 + (COMET.x1 - COMET.x0) * t) * SCALE
      const hy = (COMET.y0 + (COMET.y1 - COMET.y0) * t) * SCALE
      trail.unshift([hx, hy])
      if (trail.length > 14) trail.pop()

      ctx.clearRect(0, 0, W, H)
      trail.forEach(([tx, ty], i) => {
        ctx.globalAlpha = i === 0 ? 1 : (1 - i / trail.length) * 0.5
        ctx.fillStyle = "#fff"
        for (const [sx, sy] of COMET_PIXELS) {
          ctx.fillRect(tx + sx * SCALE, ty + sy * SCALE, SCALE, SCALE)
        }
      })
      ctx.globalAlpha = 1
      if (maskRef.current) ctx.drawImage(maskRef.current, 0, 0) // clip behind the art

      if (t < 1) { raf = requestAnimationFrame(draw) }
      else { ctx.clearRect(0, 0, W, H); onDone() }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  return html`<canvas ref=${canvasRef} class="title-comet"
                width=${320 * SCALE} height=${200 * SCALE}></canvas>`
}

export const TitleScreen = ({ onProceed }) => {
  // idle → (click: gesture + music + comet) → playing → (comet done) → ready
  const [phase, setPhase] = useState("idle")

  const begin = async () => {
    if (phase !== "idle") return
    setPhase("playing")
    try {
      const hs = await getSound()
      await hs.resume()       // must be inside the click for autoplay policy
      hs.playTune("title")
    } catch (e) {
      console.warn("title music unavailable:", e)
    }
  }

  const proceed = async () => {
    try { (await getSound()).stop() } catch (e) { /* fine */ }
    onProceed()
  }

  // In 'ready', any key proceeds — the literal "press any key".
  useEffect(() => {
    if (phase !== "ready") return
    const onKey = () => proceed()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase])

  const onStageClick = () => {
    if (phase === "idle") begin()
    else if (phase === "ready") proceed()
  }

  return html`
    <div class="title-stage" style=${`width:${320 * SCALE}px;height:${200 * SCALE}px`}
         onClick=${onStageClick}>
      <img class="title-logo" src="./assets/title.png" alt="Lucasfilm's Habitat" />
      <${Comet} playing=${phase === "playing"} onDone=${() => setPhase("ready")} />
      ${phase === "idle" && html`
        <div class="title-prompt">▶ Click to begin</div>`}
      ${phase === "ready" && html`
        <div class="balloon">Press any key to proceed<span class="balloon-tail"></span></div>`}
    </div>`
}
