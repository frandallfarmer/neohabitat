// Habitat cursor — port of Main/cursor.m + sprites.m overlay on the graphics band.

import { h } from "preact"
import htm from "htm"
import { useCallback, useRef, useState, useEffect } from "preact/hooks"
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
import { cursorSpritePair, cursorSpriteBlinkPair, CURSOR_SPRITE_W, CURSOR_SPRITE_H } from "./cursor-sprites.mjs"
import { BLINK_MS } from "./busy.mjs"

const html = htm.bind(h)
const DRAG_THRESHOLD = 10
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
  busy = null,
  busyIcon = null,
  cursorWarp = null,
  onBounds,
}) {
  const scale = useContext(Scale)
  const [pos, setPos] = useState({ x: width / 2, y: height / 2 })
  const [cursorState, setCursorState] = useState(CURSOR_NORMAL)
  const holdRef = useRef(null)
  // While a command is in flight the cursor FREEZES and the selected icon BLINKS to black
  // (Main/cursor.m command_selected / maintain_flashing). `busy`/`busyIcon` are live.js
  // signals; reading .value here subscribes this component so it re-renders when they change.
  // busyIcon is the command being run (GO for an edge walk, the picked verb for a pie command),
  // set by live.js withBusy — so the blink shows the right icon even for keyboard/edge commands.
  const isBusy = !!(busy && busy.value)
  const blinkState = (busyIcon && busyIcon.value != null) ? busyIcon.value : CURSOR_STOP
  const [blinkOn, setBlinkOn] = useState(true)
  // While holding, the live pointer position in scaled canvas px — drives the visible rubber-band
  // from the frozen origin (the press point) to where the pointer now is, so center and the current
  // offset/direction are always on screen. null when not mid-gesture.
  const [drag, setDrag] = useState(null)
  // Live pointer position (scaled canvas px), tracked even while a verb is busy, so a mouse can
  // float the cursor back to it once the verb finishes. pendingFloat is armed only by a mouse
  // release (touch/pen have no hover — they rest on the target they acted on).
  const ptrRef = useRef(null)
  const pendingFloat = useRef(false)

  // Drive the blink while busy (flash_rate); when busy clears, stop and leave the icon solid.
  useEffect(() => {
    if (!isBusy) { setBlinkOn(true); return }
    const id = setInterval(() => setBlinkOn((on) => !on), BLINK_MS)
    return () => clearInterval(id)
  }, [isBusy])

  // Flash-then-float: on release the cursor freezes and flashes the verb ON the target (the
  // press-point origin, set in onPointerUp). It never warps away mid-verb. Only AFTER the verb
  // finishes (busy → not busy) does a mouse float the cursor back to its live pointer.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !isBusy && pendingFloat.current && ptrRef.current) {
      setPos(ptrRef.current)
      pendingFloat.current = false
    }
    wasBusy.current = isBusy
  }, [isBusy])

  // Warp to a commanded position (an edge chevron's clamped destination): snap the cursor there
  // so the GO blink marks where the walk is headed. `cursorWarp` is { x, y } in unscaled canvas px.
  const warp = cursorWarp ? cursorWarp.value : null
  useEffect(() => {
    if (warp) setPos({ x: warp.x * scale, y: warp.y * scale })
  }, [warp, scale])

  const clamp = (x, y) => ({
    x: Math.max(0, Math.min(width * scale - 1, x)),
    y: Math.max(0, Math.min(height * scale - 1, y)),
  })

  const localFromEvent = (e) => {
    // Map by rect RATIO, not raw offsets: an ancestor CSS transform (live.js fit-to-viewport)
    // scales the on-screen rect, so screen-px offsets must be converted back to layout px.
    const rect = e.currentTarget.getBoundingClientRect()
    const rx = rect.width ? (width * scale) / rect.width : 1
    const ry = rect.height ? (height * scale) / rect.height : 1
    return clamp((e.clientX - rect.left) * rx, (e.clientY - rect.top) * ry)
  }

  const onPointerMove = useCallback((e) => {
    if (!enabled) return
    const p = localFromEvent(e)
    ptrRef.current = p // track the live pointer even while a verb is busy, so a mouse can float
                       // back to it once the verb finishes (see the busy-clear effect)
    if (busy && busy.value) return // frozen ON the target while a command is in flight
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
      setDrag(p) // live pointer → rubber-band endpoint
      e.preventDefault()
      return
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
  }, [enabled, scale, width, height, onMove, busy])

  const onPointerDown = useCallback((e) => {
    if (!enabled || e.button !== 0 || (busy && busy.value)) return // locked while busy
    // Absolute anchoring for every pointer type: press anchors the origin wherever the pointer
    // physically is. Pen/touch always did this; a mouse used to "return" to the last command's
    // press point (the removed park), which desynced the drawn cursor from the hidden OS pointer
    // and made it appear to jump on the next move.
    const p = localFromEvent(e)
    setPos(p)
    // C64: trigger down + centered stick → stop_cursor (options: four arrows + ?).
    setCursorState(CURSOR_STOP)
    holdRef.current = { anchorX: p.x, anchorY: p.y, state: CURSOR_STOP }
    setDrag({ x: p.x, y: p.y }) // show the origin dot immediately
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [enabled, scale, width, height, busy])

  const onPointerUp = useCallback((e) => {
    if (!enabled || !holdRef.current) return
    const { anchorX, anchorY, state } = holdRef.current
    holdRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) { /* */ }
    setDrag(null) // end the rubber-band
    // Freeze the cursor ON the target (the press-point origin) so the verb flashes on the object
    // you pressed — never at the drag-end, and never mid-verb. A mouse floats back to its live
    // pointer only AFTER the verb finishes (the busy-clear effect above); touch/pen have no hover,
    // so they rest on the target they acted on.
    if (e.pointerType === "mouse") pendingFloat.current = true
    setPos({ x: anchorX, y: anchorY })
    const command = commandFromCursorState(state)
    const canvasX = anchorX / scale
    const canvasY = anchorY / scale
    const { x: habitatX } = canvasPixelToMod(canvasX, canvasY)
    onCommand?.({
      command,
      cursorState: state, // the selected icon, so live.js blinks it (do/get/put/go/stop)
      label: labelFromCommand(command),
      canvasX: anchorX,
      canvasY: anchorY,
      scale,
      habitatX,
    })
    setCursorState(CURSOR_NORMAL)
    e.preventDefault()
  }, [enabled, onCommand, scale])

  // While busy, freeze on the selected command icon and blink it to black at the flash rate
  // (maintain_flashing). Otherwise draw the live cursor state as normal.
  const displayState = isBusy ? blinkState : cursorState
  const { icon, shadow } = (isBusy && !blinkOn)
    ? cursorSpriteBlinkPair(displayState)
    : cursorSpritePair(displayState)
  const sw = CURSOR_SPRITE_W * scale
  const sh = CURSOR_SPRITE_H * scale
  // sprites.m cursor hotspot — the crosshair center (the [255,0,255] bar crossing the
  // vertical bar at row 10 of 21) is the pointing pixel. The click anchor IS this point,
  // so the sprite must hang off it; anchoring near the sprite bottom drew the crosshair
  // ~21px above where the click actually lands (floor instead of the targeted object).
  const left = pos.x - sw / 2
  const top = pos.y - CURSOR_HOTSPOT_Y * scale

  // Rubber-band guide while holding: a dashed ring showing the STOP dead zone, a line from the
  // frozen origin to the live pointer, and dots at both ends — so center and the current offset
  // are always visible (the origin sprite already shows the active verb). Active = a verb will
  // fire on release (not centered/STOP). Dark casing keeps it legible over any region art.
  const hold = holdRef.current
  const guide = !isBusy && hold && drag
    ? { ax: hold.anchorX, ay: hold.anchorY, bx: drag.x, by: drag.y,
        dead: DRAG_THRESHOLD * scale, active: cursorState !== CURSOR_STOP }
    : null

  return html`
    <div
      style="position: absolute; inset: 0; z-index: ${CURSOR_Z_INDEX}; touch-action: none; cursor: none;"
      onPointerMove=${onPointerMove}
      onPointerDown=${onPointerDown}
      onPointerUp=${onPointerUp}
      onPointerCancel=${onPointerUp}
      onPointerLeave=${() => onBounds?.(false)}
      onContextMenu=${(e) => e.preventDefault()}>
      <img
        src=${shadow.toDataURL()}
        alt=""
        style="position: absolute; left: ${left + scale}px; top: ${top + scale}px; width: ${sw}px; height: ${sh}px; image-rendering: pixelated; pointer-events: none;" />
      <img
        src=${icon.toDataURL()}
        alt=""
        style="position: absolute; left: ${left}px; top: ${top}px; width: ${sw}px; height: ${sh}px; image-rendering: pixelated; pointer-events: none;" />
      ${guide ? html`
      <svg width=${width * scale} height=${height * scale}
           style="position: absolute; left: 0; top: 0; pointer-events: none; opacity: 0.5;">
        <circle cx=${guide.ax} cy=${guide.ay} r=${guide.dead} fill="none"
                stroke="#000000" stroke-opacity="0.4" stroke-width=${scale}
                stroke-dasharray="${2 * scale} ${2 * scale}" />
        <line x1=${guide.ax} y1=${guide.ay} x2=${guide.bx} y2=${guide.by}
              stroke="#000000" stroke-opacity="0.55" stroke-width=${3 * scale} stroke-linecap="round" />
        <line x1=${guide.ax} y1=${guide.ay} x2=${guide.bx} y2=${guide.by}
              stroke="#ffffff" stroke-opacity=${guide.active ? 0.95 : 0.5} stroke-width=${1.5 * scale} stroke-linecap="round" />
        <circle cx=${guide.ax} cy=${guide.ay} r=${1.75 * scale}
                fill="#ffffff" stroke="#000000" stroke-opacity="0.6" stroke-width=${scale} />
        <circle cx=${guide.bx} cy=${guide.by} r=${1.5 * scale}
                fill="#ffffff" fill-opacity=${guide.active ? 0.95 : 0.5} />
      </svg>` : null}
    </div>`
}