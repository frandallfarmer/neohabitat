// C64 word balloons — port of Main/balloons.m + balloonMessage (actions.m).
// Renders in the inspector charset above the graphics band, with a brief quip
// sprite on the border pointing at the speaker's x.

import { h } from "preact"
import htm from "htm"
import { useContext, useEffect, useMemo, useState } from "preact/hooks"
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
  speakerAnchorForRecord,
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

const PANEL_PX_W = LINE_WIDTH * 8
const LINE_PX_H = 8
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
    if (b === BALLOON_CHAR.BLANK || b === 32) ctx.fillRect(col * 8, 0, 8, LINE_PX_H)
  }
}

function renderLineCanvas(bytes, vicColor, charsetData) {
  const { start, width } = balloonLineSpan(bytes)
  if (width <= 0) return null
  const slice = bytes.slice(start, start + width)
  const linePxW = width * 8
  const canvas = makeCanvas(linePxW, LINE_PX_H)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, linePxW, LINE_PX_H)
  fillInteriorCells(ctx, slice, vicColor)
  const frame = frameFromText(0, 8, [TXTCMD_INVERSE, ...slice], charsetData, 0xff, 0, balloonTextColors(vicColor))
  if (frame?.canvas) ctx.drawImage(frame.canvas, 0, 0)
  return { canvas, x: start * 8 }
}

export function balloonPanelHeightPx(maxDisplayLines) {
  return maxDisplayLines * LINE_PX_H
}

function composePanel(lines, charsetData, maxDisplayLines) {
  if (!lines.length || !charsetData) return null
  const rendered = lines.map((row) => renderLineCanvas(row.bytes, row.vicColor, charsetData)).filter(Boolean)
  if (!rendered.length) return null
  const panelH = balloonPanelHeightPx(maxDisplayLines)
  const canvas = document.createElement("canvas")
  canvas.width = PANEL_PX_W
  canvas.height = panelH
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, PANEL_PX_W, panelH)
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
} = {}) {
  return {
    maxDisplayLines,
    maxBalloonLines,
    lines: [],
    talkerSlots: [0, 0, 0, 0, 0, 0],
    quip: null,
    espPending: null,
    espAt: 0,
    revision: 0,
  }
}

export function clearBalloonState(state) {
  state.lines = []
  state.quip = null
  state.espPending = null
  state.espAt = 0
  state.revision++
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
      state.espPending = header[1]
      state.espAt = Date.now()
      return false
    }
    if (state.espPending && Date.now() - state.espAt < ESP_TTL_MS) {
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
  const speakerX = speakerQuipX(world, speaker)
  const centerX = speakerX > 0 ? speakerX : 80
  const quipX = showQuip ? speakerX : 0
  const formatted = formatBalloonText(body, state.maxBalloonLines, { centerX })

  for (const bytes of formatted) {
    state.lines.push({ bytes, vicColor })
  }
  while (state.lines.length > state.maxDisplayLines) state.lines.shift()

  const anchorPx = speakerX > 0 ? speakerAnchorForRecord(world?.get?.(speaker)) : 0
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
  const top = -QUIP_PANEL_OVERLAP_PX * scale
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

export function BalloonStage({ stateSignal, children }) {
  const scale = useContext(Scale)
  const state = stateSignal.value
  const charsetData = useBalloonCharset()
  useQuipExpiry(stateSignal, state)

  const panelCanvas = useMemo(
    () => (charsetData && state.lines.length
      ? composePanel(state.lines, charsetData, state.maxDisplayLines)
      : null),
    [charsetData, state.revision, state.lines.length, state.maxDisplayLines],
  )
  const panelH = balloonPanelHeightPx(state.maxDisplayLines) * scale

  return html`
    <div class="balloon-stage" style="width: ${320 * scale}px;">
      ${panelCanvas
        ? html`<div class="balloon-panel" style="height: ${panelH}px; overflow: hidden;">
            <${canvasImage} canvas=${panelCanvas} />
          </div>`
        : null}
      <div class="balloon-graphics-band">
        <${QuipSprite} quip=${state.quip} />
        ${children}
      </div>
    </div>`
}