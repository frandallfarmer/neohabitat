// C64 word balloons — port of Main/balloons.m + balloonMessage (actions.m).
// Renders in the inspector charset above the graphics band, with a brief quip
// sprite on the border pointing at the speaker's x.

import { h } from "preact"
import htm from "htm"
import { useContext, useEffect, useMemo, useState, useRef } from "preact/hooks"
import { Scale, canvasImage, c64Colors, frameFromText } from "../habirender/render.js"
import { charset, until } from "../habirender/data.js"
import { makeCanvas } from "../habirender/shim.js"
import {
  QUIP_PANEL_OVERLAP_PX,
  quipSpriteLeftPx,
  renderQuipCanvas,
} from "./quip-sprite.mjs"
import {
  BALLOON_CHAR,
  LINE_WIDTH,
  C64_MAX_BALLOON_LINES,
  formatBalloonText,
  balloonLineSpan,
  assignTalkerSlot,
  freeTalkerSlot,
  vicColorForSpeaker,
  speakerQuipX,
  speakerAnchorPx,
} from "./balloons-layout.mjs"

const html = htm.bind(h)

export {
  LINE_WIDTH,
  INNER_WIDTH,
  C64_MAX_BALLOON_LINES,
  C64_MAX_DISPLAY_LINES,
  BALLOON_CHAR,
  COLORS_8,
  formatBalloonText,
  balloonLineSpan,
  assignTalkerSlot,
  freeTalkerSlot,
  vicColorForSpeaker,
  clampQuipX,
} from "./balloons-layout.mjs"

const ESP_HEADER_RE = /^ESP from (.+): $/
const ESP_TTL_MS = 5000
const QUIP_DURATION_MS = 2000

const LAYOUT_PANEL_PX_W = LINE_WIDTH * 8
const LINE_PX_H = 8
// Full 8px charset glyphs, scaled down to layout width in the browser (see text-input.js).
const NATIVE_FONT_SCALE = 2
const NATIVE_CHAR_PX = 8 * NATIVE_FONT_SCALE
const TXTCMD_HALF_SIZE = 128 + 5
// frameFromText starts inverse:true (Rant/newspaper text); C64 text window is normal video.
const TXTCMD_INVERSE = 128 + 12

// balloons.m: one color RAM value per cell — border glyphs, text, and interior blanks/spaces
// share the speaker color; only unset cells outside the balloon stay black.
function balloonTextColors(vicColor) {
  const vic = vicColor & 15
  return { pattern: 15, wildcard: vic, skin: vic }
}

function vicFillStyle(vicColor) {
  const rgb = c64Colors[vicColor & 15]
  return `#${rgb.toString(16).padStart(6, "0")}`
}

function fillInteriorCells(ctx, bytes, vicColor) {
  ctx.fillStyle = vicFillStyle(vicColor)
  for (let col = 1; col < bytes.length - 1; col++) {
    const b = bytes[col]
    if (b === BALLOON_CHAR.BLANK || b === 32) {
      ctx.fillRect(col * NATIVE_CHAR_PX, 0, NATIVE_CHAR_PX, LINE_PX_H)
    }
  }
}

function renderLineCanvas(bytes, vicColor, charsetData) {
  const { start, width } = balloonLineSpan(bytes)
  if (width <= 0) return null
  const slice = bytes.slice(start, start + width)
  const nativeLineW = width * NATIVE_CHAR_PX
  const canvas = makeCanvas(nativeLineW, LINE_PX_H)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, nativeLineW, LINE_PX_H)
  fillInteriorCells(ctx, slice, vicColor)
  const frame = frameFromText(
    0, 8, [TXTCMD_HALF_SIZE, TXTCMD_INVERSE, ...slice], charsetData, 0xff, 0, balloonTextColors(vicColor),
  )
  if (frame?.canvas) ctx.drawImage(frame.canvas, 0, 0)
  return { canvas, x: start * NATIVE_CHAR_PX }
}

export function balloonPanelHeightPx(maxDisplayLines) {
  return maxDisplayLines * LINE_PX_H
}

function composePanel(lines, charsetData, maxDisplayLines, scrollOffset = 0) {
  if (!lines.length || !charsetData) return null
  // Show a window of maxDisplayLines, scrolled up from the bottom by scrollOffset lines
  // (0 = newest at the bottom). The history can be much longer (maxHistoryLines).
  const maxOffset = Math.max(0, lines.length - maxDisplayLines)
  const off = Math.max(0, Math.min(scrollOffset, maxOffset))
  const end = lines.length - off
  const start = Math.max(0, end - maxDisplayLines)
  const visible = lines.slice(start, end)
  const rendered = visible.map((row) => renderLineCanvas(row.bytes, row.vicColor, charsetData)).filter(Boolean)
  if (!rendered.length) return null
  const panelH = balloonPanelHeightPx(maxDisplayLines)
  const nativePanelW = LAYOUT_PANEL_PX_W * NATIVE_FONT_SCALE
  const canvas = document.createElement("canvas")
  canvas.width = nativePanelW
  canvas.height = panelH
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, nativePanelW, panelH)
  let y = panelH - rendered.length * LINE_PX_H
  for (const row of rendered) {
    if (row.canvas) ctx.drawImage(row.canvas, row.x, y)
    y += LINE_PX_H
  }
  return canvas
}

export function createBalloonState({
  maxDisplayLines = 10,
  maxBalloonLines = C64_MAX_BALLOON_LINES,
  maxHistoryLines = 100,
  // Renderer hook: a speaker noid → its x in the 0..320 panel/screen space (where the quip tail
  // points). Defaults to the 2D placement (speakerXposFromMod via speakerQuipX); the 3D client
  // supplies a camera projection of the speaker's billboard. Only balloon horizontal positioning
  // uses it — the panel is a fixed top band, so there is no vertical/head projection.
  speakerScreenX = null,
} = {}) {
  return {
    maxDisplayLines,
    maxBalloonLines,
    maxHistoryLines,
    speakerScreenX,
    lines: [],
    scrollOffset: 0, // lines scrolled up from the bottom (0 = newest visible)
    talkerSlots: [0, 0, 0, 0, 0, 0],
    quip: null,
    espPending: null,
    espAt: 0,
    revision: 0,
  }
}

export function clearBalloonState(state) {
  state.lines = []
  state.scrollOffset = 0
  state.quip = null
  state.espPending = null
  state.espAt = 0
  state.revision++
}

// Scroll the balloon scrollback by `delta` lines (positive = toward older / up). Clamped to
// [0, history-window]. Returns true if the offset changed.
export function scrollBalloons(state, delta) {
  const maxOffset = Math.max(0, state.lines.length - state.maxDisplayLines)
  const next = Math.max(0, Math.min(state.scrollOffset + delta, maxOffset))
  if (next === state.scrollOffset) return false
  state.scrollOffset = next
  state.revision++
  return true
}

// Set the scroll offset directly (for the scrollbar thumb). Clamped.
export function setBalloonScroll(state, offset) {
  const maxOffset = Math.max(0, state.lines.length - state.maxDisplayLines)
  const next = Math.max(0, Math.min(Math.round(offset), maxOffset))
  if (next === state.scrollOffset) return false
  state.scrollOffset = next
  state.revision++
  return true
}

export function pushBalloon(state, world, text, meta = {}) {
  if (text == null || text === "") return false
  const meNoid = world?.me?.noid ?? null
  let body = String(text)
  let speaker = meta.speaker ?? meta.speakerNoid ?? null
  let showQuip = meta.showQuip !== false
  const op = meta.op ?? ""

  if (op === "OBJECTSPEAK_$" || body.startsWith("ESP from ")) {
    const header = body.match(ESP_HEADER_RE)
    if (header) {
      // ESP attribution header ("ESP from X: "). The C64 draws this as its own balloon
      // line; previously we returned false here and dropped it, so the recipient saw the
      // body with no idea who sent it. Show it — and arm espPending so the body message
      // that follows is recognized as the ESP it completes. Render over the RECIPIENT
      // (ESP is telepathic — it appears over you, not the sender, who may not even be in
      // the region), with no quip tail.
      state.espPending = header[1]
      state.espAt = Date.now()
      speaker = meNoid
      showQuip = false
    } else if (state.espPending && Date.now() - state.espAt < ESP_TTL_MS) {
      speaker = speaker ?? meNoid
      showQuip = false
      state.espPending = null
    } else {
      state.espPending = null
      if (op === "OBJECTSPEAK_$" && !speaker) showQuip = false
    }
  }

  if (meta.noQuip) showQuip = false

  const vicColor = meta.vicColor ?? vicColorForSpeaker({
    talkerSlots: state.talkerSlots,
    meNoid,
    speakerNoid: speaker,
  })
  const projectSpeakerX = state.speakerScreenX ?? speakerQuipX
  const speakerX = projectSpeakerX(world, speaker)
  const centerX = speakerX > 0 ? speakerX : 80
  const quipX = showQuip ? speakerX : 0
  const formatted = formatBalloonText(body, state.maxBalloonLines, { centerX })

  for (const bytes of formatted) {
    state.lines.push({ bytes, vicColor })
  }
  // Webclient-only bounded scrollback. The C64's slow modem made bursts (e.g. the god-tool
  // `d`ump's noid list) readable as they arrived; instant web comms scroll them off in <1s,
  // so we retain up to maxHistoryLines and let the user scroll back. Snap to newest on push.
  while (state.lines.length > state.maxHistoryLines) state.lines.shift()
  state.scrollOffset = 0

  // The quip-tail pixel anchor derives from the same speaker-x (speakerAnchorPx(speakerX) equals
  // the old speakerAnchorForRecord for the 2D default, and points at the projected x for 3D).
  const anchorPx = speakerX > 0 ? speakerAnchorPx(speakerX) : 0
  if (showQuip && quipX > 0 && anchorPx > 0) {
    state.quip = { anchorPx, vicColor, until: Date.now() + QUIP_DURATION_MS }
  } else {
    state.quip = null
  }
  state.revision++
  return true
}

export function trackAvatarsForBalloons(state, world) {
  const onAdded = (rec) => {
    if (rec?.type === "Avatar") assignTalkerSlot(state.talkerSlots, rec.noid)
  }
  const onRemoved = (rec) => {
    if (rec?.type === "Avatar") freeTalkerSlot(state.talkerSlots, rec.noid)
  }
  world.on("added", onAdded)
  world.on("removed", onRemoved)
  for (const rec of world.objects?.values?.() ?? []) onAdded(rec)
  return () => {
    world.off("added", onAdded)
    world.off("removed", onRemoved)
  }
}

function QuipSprite({ quip }) {
  const scale = useContext(Scale)
  const canvas = useMemo(
    () => (quip ? renderQuipCanvas(quip.vicColor) : null),
    [quip?.vicColor],
  )
  if (!quip || quip.anchorPx <= 0 || Date.now() > quip.until || !canvas) return null
  const left = quipSpriteLeftPx(quip.anchorPx) * scale
  // Drop the quip one charset line below where the raw C64 overlap (QUIP_PANEL_OVERLAP_PX = 8 =
  // one line) would put it. That overlap poked the tail up into the newest balloon's bottom line
  // — the balloon read as one line too high. With +LINE_PX_H it nets to the panel/band seam, so
  // the tail sits just under the balloon's bottom border instead of covering it.
  const top = (-QUIP_PANEL_OVERLAP_PX + LINE_PX_H) * scale
  return html`
    <div class="balloon-quip" style="left: ${left}px; top: ${top}px; background: transparent;">
      <${canvasImage} canvas=${canvas} />
    </div>`
}

function useBalloonCharset() {
  const [charsetData, setCharsetData] = useState(null)
  useEffect(() => {
    let alive = true
    until(charset).then((cs) => { if (alive) setCharsetData(cs) })
    return () => { alive = false }
  }, [])
  return charsetData
}

function useQuipExpiry(stateSignal, state) {
  useEffect(() => {
    if (!state?.quip) return undefined
    const left = state.quip.until - Date.now()
    if (left <= 0) {
      state.quip = null
      state.revision++
      stateSignal.value = { ...state }
      return undefined
    }
    const t = setTimeout(() => {
      state.quip = null
      state.revision++
      stateSignal.value = { ...state }
    }, left)
    return () => clearTimeout(t)
  }, [state?.quip?.until, state?.revision])
}

// C64 VIC palette → CSS hex (c64Colors entries are 0xRRGGBB integers).
const c64css = (idx) => `#${c64Colors[idx].toString(16).padStart(6, "0")}`
const SCROLLBAR_W = 16 // px, sits over the right edge / right chevron

export function BalloonStage({ stateSignal, children, textInput = null }) {
  const scale = useContext(Scale)
  const state = stateSignal.value
  const charsetData = useBalloonCharset()
  useQuipExpiry(stateSignal, state)

  const panelCanvas = useMemo(
    () => (charsetData && state.lines.length
      ? composePanel(state.lines, charsetData, state.maxDisplayLines, state.scrollOffset)
      : null),
    [charsetData, state.revision, state.lines.length, state.maxDisplayLines, state.scrollOffset],
  )
  const panelW = LAYOUT_PANEL_PX_W * scale
  const panelH = balloonPanelHeightPx(state.maxDisplayLines) * scale
  const TextInputLine = textInput?.Line
  const [pointerInGraphics, setPointerInGraphics] = useState(false)
  const dragRef = useRef(null)

  // Scrollback metrics. Offset 0 = newest at the bottom; maxOffset = oldest line at the top.
  const total = state.lines.length
  const maxOffset = Math.max(0, total - state.maxDisplayLines)
  const hasScroll = maxOffset > 0
  const off = Math.max(0, Math.min(state.scrollOffset, maxOffset))
  const thumbH = hasScroll ? Math.max(18, panelH * (state.maxDisplayLines / total)) : 0
  const thumbTop = (1 - (maxOffset > 0 ? off / maxOffset : 0)) * (panelH - thumbH)
  const dragging = !!dragRef.current

  const onWheel = (e) => {
    if (!hasScroll) return
    e.preventDefault()
    if (scrollBalloons(state, e.deltaY < 0 ? 3 : -3)) stateSignal.value = { ...state }
  }
  const onThumbDown = (e) => {
    e.preventDefault(); e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { startY: e.clientY, startOff: off }
    stateSignal.value = { ...state }
  }
  const onThumbMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const span = panelH - thumbH
    if (span <= 0) return
    // Drag the thumb DOWN (dy>0) → toward the newest line → smaller offset.
    const newOff = d.startOff - ((e.clientY - d.startY) / span) * maxOffset
    if (setBalloonScroll(state, newOff)) stateSignal.value = { ...state }
  }
  const onThumbUp = (e) => {
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    stateSignal.value = { ...state }
  }

  return html`
    <div class="balloon-stage" style="width: ${panelW}px;">
      ${panelCanvas
        ? html`<div class="balloon-panel" style="width: ${panelW}px; height: ${panelH}px; overflow: hidden;" onWheel=${onWheel}>
            <img
              class="balloon-panel-canvas"
              style=${`width: ${panelW}px; height: ${panelH}px;`}
              src=${panelCanvas.toDataURL()}
              alt="" />
          </div>`
        : null}
      ${hasScroll
        ? html`<div class="balloon-scrollbar"
            style=${`width:${SCROLLBAR_W}px; height:${panelH}px; left:${panelW}px; background:${c64css(11)};`}
            title="Scroll word-balloon history">
            <div class="balloon-scrollbar-thumb"
              style=${`height:${thumbH}px; top:${thumbTop}px; background:${dragging ? c64css(1) : c64css(15)};`}
              onPointerDown=${onThumbDown}
              onPointerMove=${onThumbMove}
              onPointerUp=${onThumbUp} />
          </div>`
        : null}
      <div
        class="balloon-graphics-band"
        onPointerEnter=${() => setPointerInGraphics(true)}
        onPointerLeave=${() => setPointerInGraphics(false)}>
        <${QuipSprite} quip=${state.quip} />
        ${children}
      </div>
      ${TextInputLine
        ? html`<${TextInputLine}
            stateSignal=${textInput.stateSignal}
            onSubmit=${textInput.onSubmit}
            enabled=${textInput.enabled}
            routeKeys=${pointerInGraphics} />`
        : null}
    </div>`
}