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
// After a verb, the cursor freezes at the press point — where the next click must originate
// (the mouse "returns" to it); settling jitter keeps it there, a deliberate move past this
// (raw px, measured against the physical release point) lets it follow the pointer again.
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
  onMove,
  enabled = true,
}) {
  const scale = useContext(Scale)
  const [pos, setPos] = useState({ x: width / 2, y: height / 2 })
  const [cursorState, setCursorState] = useState(CURSOR_NORMAL)
  const holdRef = useRef(null)
  // While set after a verb, the cursor stays frozen at the press point (C64: it doesn't move
  // to where the drag ended) and the next click anchors there. Holds { freezeX, freezeY }
  // (the frozen display / next-press point) and { physX, physY } (the physical release point,
  // used only to distinguish settling jitter from a deliberate move). Cleared on a deliberate
  // move or the next press.
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
      // Frozen at the press point after a verb. Compare the PHYSICAL pointer to the physical
      // release point: settling jitter near it keeps the cursor frozen at the freeze point;
      // a deliberate move past the threshold unfreezes and resumes following the pointer.
      if (Math.abs(p.x - parkRef.current.physX) < UNPARK_THRESHOLD &&
          Math.abs(p.y - parkRef.current.physY) < UNPARK_THRESHOLD) {
        e.preventDefault()
        return
      }
      parkRef.current = null
    }
    setPos(p)
    setCursorState(CURSOR_NORMAL)
    // Report the live cursor position so keyboard-driven commands (F-keys) can pick
    // whatever the cursor is over — the C64 fires F-keys at the current pointer (que_gesture
    // → update_cursor → pointed_noid).
    if (onMove) {
      const { x: habitatX } = canvasPixelToMod(p.x / scale, p.y / scale)
      onMove({ canvasX: p.x, canvasY: p.y, scale, habitatX })
    }
  }, [enabled, scale, width, height, onMove])

  const onPointerDown = useCallback((e) => {
    if (!enabled || e.button !== 0) return
    const phys = localFromEvent(e)
    // While frozen after a verb, a click without a deliberate move begins at the FREEZE point
    // (the press point of the last command) — the mouse "returns" there — instead of warping
    // to wherever the OS pointer physically sits (the drag-end of that command).
    const p = parkRef.current ? { x: parkRef.current.freezeX, y: parkRef.current.freezeY } : phys
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
    // The verb runs at the press point (anchorX/anchorY below) and the cursor stays FROZEN
    // there — that freeze point is where the next click must originate (the mouse "returns"
    // to it). We can't move the OS pointer, so remember both the freeze point (where the
    // cursor is drawn / where the next press anchors) and the physical release point (used
    // only to tell settling jitter from a deliberate move).
    const rel = localFromEvent(e)
    parkRef.current = { freezeX: anchorX, freezeY: anchorY, physX: rel.x, physY: rel.y }
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