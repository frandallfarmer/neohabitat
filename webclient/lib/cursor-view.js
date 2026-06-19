// Habitat cursor — port of Main/cursor.m + sprites.m overlay on the graphics band.

import { h } from "preact"
import htm from "htm"
import { useCallback, useRef, useState } from "preact/hooks"
import { useContext } from "preact/hooks"
import { Scale } from "../habirender/render.js"
import { canvasPixelToMod } from "../habirender/pick.mjs"
import {
  CURSOR_NORMAL,
  stickIndexFromDrag,
  cursorStateFromStick,
  commandFromCursorState,
  labelFromCommand,
} from "./cursor.mjs"
import { cursorSpritePair, CURSOR_SPRITE_W, CURSOR_SPRITE_H } from "./cursor-sprites.mjs"

const html = htm.bind(h)
const DRAG_THRESHOLD = 10
// C64 draws cursor sprite after region objects (render.m); above layout.z (0–255).
const CURSOR_Z_INDEX = 10000

export function RegionCursor({
  width = 320,
  height = 128,
  onCommand,
  enabled = true,
}) {
  const scale = useContext(Scale)
  const [pos, setPos] = useState({ x: width / 2, y: height / 2 })
  const [cursorState, setCursorState] = useState(CURSOR_NORMAL)
  const holdRef = useRef(null)

  const clamp = (x, y) => ({
    x: Math.max(0, Math.min(width * scale - 1, x)),
    y: Math.max(0, Math.min(height * scale - 1, y)),
  })

  const localFromEvent = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return clamp(e.clientX - rect.left, e.clientY - rect.top)
  }

  const onPointerMove = useCallback((e) => {
    if (!enabled) return
    const p = localFromEvent(e)
    if (holdRef.current) {
      const { anchorX, anchorY, state } = holdRef.current
      const dx = p.x - anchorX
      const dy = p.y - anchorY
      const stick = stickIndexFromDrag(dx, dy, DRAG_THRESHOLD * scale)
      const next = cursorStateFromStick(stick)
      if (next != null && next !== state) {
        holdRef.current.state = next
        setCursorState(next)
      }
      e.preventDefault()
      return
    }
    setPos(p)
    setCursorState(CURSOR_NORMAL)
  }, [enabled, scale, width, height])

  const onPointerDown = useCallback((e) => {
    if (!enabled || e.button !== 0) return
    const p = localFromEvent(e)
    setPos(p)
    setCursorState(CURSOR_NORMAL)
    holdRef.current = { anchorX: p.x, anchorY: p.y, state: CURSOR_NORMAL }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [enabled, scale, width, height])

  const onPointerUp = useCallback((e) => {
    if (!enabled || !holdRef.current) return
    const { anchorX, anchorY, state } = holdRef.current
    holdRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) { /* */ }
    const command = commandFromCursorState(state)
    const canvasX = anchorX / scale
    const canvasY = anchorY / scale
    const { x: habitatX } = canvasPixelToMod(canvasX, canvasY)
    onCommand?.({
      command,
      label: labelFromCommand(command),
      canvasX: anchorX,
      canvasY: anchorY,
      scale,
      habitatX,
    })
    setCursorState(CURSOR_NORMAL)
    e.preventDefault()
  }, [enabled, onCommand, scale])

  const { icon, shadow } = cursorSpritePair(cursorState)
  const sw = CURSOR_SPRITE_W * scale
  const sh = CURSOR_SPRITE_H * scale
  const left = pos.x - sw / 2
  const top = pos.y - sh + 4 * scale

  return html`
    <div
      style="position: absolute; inset: 0; z-index: ${CURSOR_Z_INDEX}; touch-action: none; cursor: none;"
      onPointerMove=${onPointerMove}
      onPointerDown=${onPointerDown}
      onPointerUp=${onPointerUp}
      onPointerCancel=${onPointerUp}
      onContextMenu=${(e) => e.preventDefault()}>
      <img
        src=${shadow.toDataURL()}
        alt=""
        style="position: absolute; left: ${left + scale}px; top: ${top + scale}px; width: ${sw}px; height: ${sh}px; image-rendering: pixelated; pointer-events: none;" />
      <img
        src=${icon.toDataURL()}
        alt=""
        style="position: absolute; left: ${left}px; top: ${top}px; width: ${sw}px; height: ${sh}px; image-rendering: pixelated; pointer-events: none;" />
    </div>`
}