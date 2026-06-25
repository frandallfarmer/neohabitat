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

// The original C64 title "silhouette" (hab + sill), decoded from Main/habsill3.m by
// tools/decode-habsill.mjs — the genuine 320×128 multicolor bits the comet flew over. It is the
// bottom band of the 320×200 screen; the top 9 char rows (72px) held the "(c) 1987 Lucasfilm
// Ltd." text. habsill3.m is linked into Bitmap_screen_1 ($4b40) by Main/Makefile's slinky call.
const TITLE_SRC = "./assets/habsill.png"
const BITMAP_Y = 72 // 9 text rows × 8 — where the bitmap band begins on the C64 screen

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

  // The comet sits in its own layer BEHIND the silhouette <img> (whose sky pixels are
  // transparent) and IN FRONT of the blue sky background — so it shoots across the sky and is
  // naturally occluded by the foreground art, reproducing the C64's sprite-behind-bitmap
  // priority without any luminance mask (which used to paint black over the art = "colors break").
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

      if (t < 1) { raf = requestAnimationFrame(draw) }
      else { ctx.clearRect(0, 0, W, H); onDone() }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  return html`<canvas ref=${canvasRef} class="title-comet"
                width=${320 * SCALE} height=${200 * SCALE}></canvas>`
}

export const TitleScreen = ({ onProceed, ready = true }) => {
  // idle → (click: gesture + music + comet) → playing → (comet done) → ready.
  // `ready` gates the final "press any key": when the heavy client is still loading behind the
  // title (live.js boot), the comet can finish first — hold at "Loading…" until it's ready.
  const [phase, setPhase] = useState("idle")

  const begin = async () => {
    if (phase !== "idle") return
    setPhase("playing")
    try {
      const hs = await getSound()
      await hs.resume()       // must be inside the click for autoplay policy
      hs.playTune("title")    // opening-notes warm-up still TODO (see task: title music)
    } catch (e) {
      console.warn("title music unavailable:", e)
    }
  }

  // Once loaded, the player names their Avatar; submitting it dismisses the curtain and starts
  // the client (no region is asked — the server lands them wherever they last were).
  const [name, setName] = useState(() => new URLSearchParams(location.search).get("user") || "")
  const inputRef = useRef(null)
  const submit = async (e) => {
    e?.preventDefault?.()
    const n = name.trim()
    if (!ready || !n) return
    // Mobile browsers (notably Chrome) zoom the page IN when the name field is focused and leave
    // it there, so the client lands stuck at that text-zoom level. Blur the field and momentarily
    // clamp the visual viewport to scale 1 to snap it back, then restore the normal meta so the
    // user can still pinch-zoom to fit the 320×SCALE-wide region on a narrow screen. (The 16px
    // input font alone prevents the zoom on WebKit/iOS but not reliably on Chrome.)
    inputRef.current?.blur?.()
    const vp = document.querySelector('meta[name="viewport"]')
    if (vp) {
      vp.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1")
      setTimeout(() => vp.setAttribute("content", "width=device-width, initial-scale=1"), 350)
    }
    try { (await getSound()).stop() } catch (_) { /* fine */ }
    onProceed(n)
  }

  // Focus the name field as soon as it appears.
  useEffect(() => {
    if (phase === "ready" && ready) inputRef.current?.focus()
  }, [phase, ready])

  const onStageClick = () => { if (phase === "idle") begin() }

  return html`
    <div class="title-stage" style=${`width:${320 * SCALE}px;height:${200 * SCALE}px`}
         onClick=${onStageClick}>
      <div class="title-sky"></div>
      <${Comet} playing=${phase === "playing"} onDone=${() => setPhase("ready")} />
      <img class="title-logo" src=${TITLE_SRC} alt="Lucasfilm's Habitat" />
      <div class="title-copyright">(c) 1987 Lucasfilm Ltd.</div>
      ${phase === "idle" && html`
        <div class="title-prompt">▶ Click to begin</div>`}
      ${phase === "ready" && (ready
        ? html`<form class="title-login" onSubmit=${submit}>
            <span class="title-login-label">Avatar name</span>
            <input ref=${inputRef} class="title-login-input" value=${name} maxlength="20"
                   autocomplete="off" spellcheck="false"
                   onInput=${(e) => setName(e.target.value)} />
            <button class="title-login-go" type="submit" disabled=${!name.trim()}>Enter Habitat</button>
          </form>`
        : html`<div class="balloon">Loading…<span class="balloon-tail"></span></div>`)}
    </div>`
}
