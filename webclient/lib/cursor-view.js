// Habitat cursor — port of Main/cursor.m + sprites.m overlay on the graphics band.

import { h } from "preact"
import htm from "htm"
import { useCallback, useRef, useState } from "preact/hooks"
import { useContext } from "preact/hooks"
import { Scale } from "../habirender/render.js"
import { canvasPixelToMod } from "../habirender/pick.mjs"
import {
  CURSOR_NORMAL,
  CURSOR_STOP,
  stickIndexFromDrag,
  cursorStateFromStick,
  commandFromCursorState,
  labelFromCommand,
} from "./cursor.mjs"
import { cursorSpritePair, CURSOR_SPRITE_W, CURSOR_SPRITE_H } from "./cursor-sprites.mjs"

const html = htm.bind(h)
const DRAG_THRESHOLD = 10
// After a verb, the cursor parks at the press point; small settling jitter keeps it there,
// a deliberate move past this (raw px) lets it follow the pointer again.
const UNPARK_THRESHOLD = 12
// C64 draws cursor sprite after region objects (render.m); above layout.z (0–255).
const CURSOR_Z_INDEX = 10000
// sprites.m cursor crosshair hotspot: the pointing pixel is the sprite's center, row 10
// of 21 (where the [255,0,255] horizontal bar crosses the vertical bar). The click anchor
// maps to this pixel, so the drawn sprite hangs off it.
const CURSOR_HOTSPOT_Y = 10

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
  // Set to the raw pointer position at release; while set, the cursor stays parked at the
  // press point (C64: it doesn't move to where the drag ended) until a deliberate move.
  const parkRef = useRef(null)

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
    if (parkRef.current) {
      // Parked at the press point after a verb: ignore the release-settling jitter; only a
      // deliberate move unparks and resumes following the pointer.
      if (Math.abs(p.x - parkRef.current.x) < UNPARK_THRESHOLD &&
          Math.abs(p.y - parkRef.current.y) < UNPARK_THRESHOLD) {
        e.preventDefault()
        return
      }
      parkRef.current = null
    }
    setPos(p)
    setCursorState(CURSOR_NORMAL)
  }, [enabled, scale, width, height])

  const onPointerDown = useCallback((e) => {
    if (!enabled || e.button !== 0) return
    const p = localFromEvent(e)
    parkRef.current = null
    setPos(p)
    // C64: trigger down + centered stick → stop_cursor (options: four arrows + ?).
    setCursorState(CURSOR_STOP)
    holdRef.current = { anchorX: p.x, anchorY: p.y, state: CURSOR_STOP }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [enabled, scale, width, height])

  const onPointerUp = useCallback((e) => {
    if (!enabled || !holdRef.current) return
    const { anchorX, anchorY, state } = holdRef.current
    holdRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) { /* */ }
    // Cursor returns to / stays at the press point; park it there so the settling pointer
    // move doesn't snap it to the drag-end.
    const rel = localFromEvent(e)
    parkRef.current = { x: rel.x, y: rel.y }
    setPos({ x: anchorX, y: anchorY })
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
  // sprites.m cursor hotspot — the crosshair center (the [255,0,255] bar crossing the
  // vertical bar at row 10 of 21) is the pointing pixel. The click anchor IS this point,
  // so the sprite must hang off it; anchoring near the sprite bottom drew the crosshair
  // ~21px above where the click actually lands (floor instead of the targeted object).
  const left = pos.x - sw / 2
  const top = pos.y - CURSOR_HOTSPOT_Y * scale

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