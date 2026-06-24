// Habitat charset speak line — black on white, below the graphics band.

import { h } from "preact"
import htm from "htm"
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks"
import { Scale, frameFromText } from "../habirender/render.js"
import { charset, until } from "../habirender/data.js"
import { makeCanvas } from "../habirender/shim.js"
import {
  MAX_TEXT_DISPLAY_LENGTH,
  displayBytes,
  createTextInputState,
  handleKey,
  applyEspReply,
  clearTextLine,
  enterEspMode,
  exitEspMode,
  setPromptLine,
  endPrompt,
} from "./text-input.mjs"

const html = htm.bind(h)

export {
  MAX_TEXT_DISPLAY_LENGTH,
  createTextInputState,
  handleKey,
  applyEspReply,
  clearTextLine,
  enterEspMode,
  exitEspMode,
  setPromptLine,
  endPrompt,
} from "./text-input.mjs"

const LAYOUT_PX_W = MAX_TEXT_DISPLAY_LENGTH * 8
const LINE_PX_H = 8
// frameFromText defaults to halfSize:true (4px glyphs). C64 display_text_line uses full
// 8px charset cells; TXTCMD_HALF_SIZE toggles off halfSize. Browser CSS scales native 2:1
// back down to the 320px layout width (same footprint as halfSize, sharper edges).
const NATIVE_FONT_SCALE = 2
const TXTCMD_HALF_SIZE = 128 + 5
// Balloons: black field + TXTCMD_INVERSE (inverse off) + colored ink — see balloons.js.
// Speak line is the opposite: white field + default inverse:true (do NOT send TXTCMD_INVERSE)
// or you get inverse-video cells (white on black). pattern 15 + 0xff bitmap fill = black ink.
const BITMAP_PATTERN = 0xff
const TEXT_COLORS = { pattern: 15, wildcard: 0, skin: 0 }

function hasVisibleGlyphs(bytes) {
  return bytes.some((b) => b !== 32)
}

function renderLineCanvas(bytes, charsetData, cursorVisible) {
  const nativeW = LAYOUT_PX_W * NATIVE_FONT_SCALE
  const drawBytes = cursorVisible ? bytes : bytes.map((b) => (b === 0 ? 32 : b))
  const canvas = makeCanvas(nativeW, LINE_PX_H)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, nativeW, LINE_PX_H)
  if (!hasVisibleGlyphs(drawBytes)) return canvas
  const frame = frameFromText(
    0, 8, [TXTCMD_HALF_SIZE, ...drawBytes], charsetData, BITMAP_PATTERN, 0, TEXT_COLORS,
  )
  if (frame?.canvas) ctx.drawImage(frame.canvas, 0, 0)
  return canvas
}

function useCharset() {
  const [charsetData, setCharsetData] = useState(null)
  useEffect(() => {
    let alive = true
    until(charset).then((cs) => { if (alive) setCharsetData(cs) })
    return () => { alive = false }
  }, [])
  return charsetData
}

export function TextInputLine({ stateSignal, onSubmit, enabled = true, routeKeys = false }) {
  const scale = useContext(Scale)
  const charsetData = useCharset()
  const rootRef = useRef(null)
  const state = stateSignal.value
  const [cursorOn, setCursorOn] = useState(true)

  useEffect(() => {
    const t = setInterval(() => setCursorOn((v) => !v), 530)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (enabled) rootRef.current?.focus()
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined
    const onKey = (e) => {
      const root = rootRef.current
      const focused = root
        && (document.activeElement === root || root.contains(document.activeElement))
      // `e.synthetic` = a key from the on-screen keyboard (onscreen-keyboard.mjs). It's dispatched
      // while a keyboard BUTTON — not the text line — is the focus target, so accept it past the
      // focus gate (the keyboard is a deliberate input source, same as a physical key).
      if (!routeKeys && !focused && !e.synthetic) return
      if (!routeKeys && !e.synthetic && e.target.closest?.("input, textarea, select")) return
      const st = stateSignal.value
      const result = handleKey(st, e.key, { ctrlKey: e.ctrlKey })
      if (result.action === "noop") return
      e.preventDefault()
      e.stopPropagation()
      stateSignal.value = { ...st }
      if (result.action === "submit" && result.payload && onSubmit) {
        onSubmit(result.payload)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled, routeKeys, state.revision, onSubmit, stateSignal])

  const bytes = useMemo(
    () => displayBytes(state, { showCursor: cursorOn }),
    [state.revision, cursorOn],
  )

  const canvas = useMemo(
    () => (charsetData ? renderLineCanvas(bytes, charsetData, cursorOn) : null),
    [charsetData, bytes, cursorOn],
  )

  const layoutW = LAYOUT_PX_W * scale
  const layoutH = LINE_PX_H * scale

  return html`
    <div
      ref=${rootRef}
      class="text-input-line"
      tabindex=${enabled ? 0 : -1}
      style="width: ${layoutW}px; height: ${layoutH}px;"
      onClick=${() => enabled && rootRef.current?.focus()}
    >
      ${canvas
        ? html`<img
            class="text-input-canvas"
            style=${`width: ${layoutW}px; height: ${layoutH}px;`}
            src=${canvas.toDataURL()}
            alt="" />`
        : html`<div class="text-input-fallback" />`}
    </div>`
}