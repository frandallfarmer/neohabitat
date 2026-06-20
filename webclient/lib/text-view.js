// Text display — port of Main/text_handler.m read flow (RECEIVE_PAGE + display_menu).
// Replaces the region while reading a document/paper/book. Rendered with the canonical
// Habitat charset (same renderer as the word balloons / speak line): black ink on the
// C64 pink page (color_pink = 0x0a), with the Book_Menu prompt — NEXT BACK PAGE # QUIT —
// in the game font on a white strip at the bottom (display_menu).
//
// Paging follows the neohabitat READ protocol (Document.java): page 0 = next, 254 = back;
// the reply carries `nextpage` and `ascii` (up to 16×40 bytes, trimmed at the first 0).
// Read-only for now; editing paper + send-as-mail (TRANSMIT_PAGE / TEXT_MAIL_BIT) is next.

import { h } from "preact"
import htm from "htm"
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks"
import { frameFromText, c64Colors } from "../habirender/render.js"
import { charset, until } from "../habirender/data.js"
import { makeCanvas } from "../habirender/shim.js"

const html = htm.bind(h)

const COLS = 40
const PAGE_ROWS = 16        // Document.java LINES_PER_PAGE
// Same scale model as the word balloons (balloons.js): frameFromText full-size glyphs are
// 16px wide native (2 cells × 8) and 8px tall, then the browser scales the bitmap to the
// 8px-layout footprint. Native canvas = COLS×16 × ROWS×8; display = layout(8px) × SCALE.
const NATIVE_CW = 16
const NATIVE_RH = 8
const SCALE = 3            // display scale (matches the region stage)
const TXTCMD_HALF_SIZE = 128 + 5 // full glyphs (speak-line / balloon recipe)
const BITMAP_PATTERN = 0xff
const INK = { pattern: 15, wildcard: 0, skin: 0 } // black ink on a solid field
const PINK = `#${c64Colors[0x0a].toString(16).padStart(6, "0")}` // color_pink (light_red)

// text_handler.m Book_Menu (the read menu): four 10-col zones.
const MENU_TEXT = "NEXT      BACK      PAGE #    QUIT      "
const READ_NEXT = 0
const READ_BACK = 254

// Reply → rows of charset bytes (split on 10, wrap at 40 cols, stop at 0 / 16 rows).
function pageRows(reply) {
  let bytes = Array.isArray(reply?.ascii) ? reply.ascii : null
  if (!bytes && reply?.text != null) bytes = [...String(reply.text)].map((c) => c.charCodeAt(0) & 0xff)
  bytes = bytes || []
  const rows = []
  let row = []
  for (const b of bytes) {
    if (b === 0) break
    if (b === 10) { rows.push(row); row = [] }
    else { row.push(b & 0xff); if (row.length === COLS) { rows.push(row); row = [] } }
    if (rows.length >= PAGE_ROWS) break
  }
  if (row.length && rows.length < PAGE_ROWS) rows.push(row)
  return rows.slice(0, PAGE_ROWS)
}

// Render one charset line (full glyphs) onto ctx at (0, y) — caller pre-fills the field.
// A blank / all-spaces line yields no glyph layers (0×0 composite), which drawImage
// rejects — skip those.
function drawLine(ctx, bytes, y, charsetData) {
  if (!bytes.length || !charsetData) return
  const frame = frameFromText(0, 8, [TXTCMD_HALF_SIZE, ...bytes], charsetData, BITMAP_PATTERN, 0, INK)
  if (frame?.canvas?.width > 0 && frame.canvas.height > 0) ctx.drawImage(frame.canvas, 0, y)
}

function renderPage(reply, charsetData) {
  const w = COLS * NATIVE_CW, h = PAGE_ROWS * NATIVE_RH
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = PINK
  ctx.fillRect(0, 0, w, h)
  pageRows(reply).forEach((row, i) => drawLine(ctx, row, i * NATIVE_RH, charsetData))
  return canvas
}

function renderMenu(charsetData) {
  const w = COLS * NATIVE_CW, h = NATIVE_RH
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, w, h)
  drawLine(ctx, [...MENU_TEXT].map((c) => c.charCodeAt(0) & 0xff), 0, charsetData)
  return canvas
}

const useCharset = () => {
  const [cs, setCs] = useState(null)
  useEffect(() => {
    let alive = true
    until(charset).then((c) => { if (alive) setCs(c) })
    return () => { alive = false }
  }, [])
  return cs
}

const CELL = 8 * SCALE       // display px per character cell
const MENU_ROW = PAGE_ROWS   // row index of the menu line (just below the page)
const MENU_ZONES = ["next", "back", "page", "quit"] // Book_Menu_List quarters

export const TextView = ({ text, onExit }) => {
  const charsetData = useCharset()
  const [reply, setReply] = useState(null)
  const [loading, setLoading] = useState(true)
  // The pen cursor IS the pointer in text mode (the OS cursor is hidden): a typewriter-tip
  // that snaps to a character cell over the page, or to a menu zone to pick a command.
  const [pen, setPenState] = useState({ col: 0, row: 0 })
  const penRef = useRef(pen)
  const setPen = (p) => { penRef.current = p; setPenState(p) }

  const read = useCallback(async (page) => {
    setLoading(true)
    setPen({ col: 0, row: 0 }) // home the pen on each new page (clear_sheet)
    try { setReply((await text.readPage(page)) ?? null) }
    finally { setLoading(false) }
  }, [text])

  useEffect(() => { read(READ_NEXT) }, [read]) // text_handler.m ENTER → first RECEIVE_PAGE

  const onMenu = (id) => {
    if (id === "next") read(READ_NEXT)
    else if (id === "back") read(READ_BACK)
    else if (id === "page") {
      const n = parseInt(globalThis.prompt?.("Page number?") ?? "", 10)
      if (Number.isFinite(n) && n >= 1) read(n)
    } else if (id === "quit") onExit()
  }
  const triggerMenu = (col) => onMenu(MENU_ZONES[Math.min(3, Math.floor(col / 10))])
  // Latest actions for the keyboard listener (registered once on mount).
  const act = useRef({})
  act.current = { triggerMenu, onExit }

  // The pen follows the mouse, snapping to the cell under it (page rows 0..15, menu = 16).
  const cellFromEvent = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      col: Math.max(0, Math.min(COLS - 1, Math.floor((e.clientX - r.left) / CELL))),
      row: Math.max(0, Math.min(MENU_ROW, Math.floor((e.clientY - r.top) / CELL))),
    }
  }
  const onFieldMove = (e) => setPen(cellFromEvent(e))
  const onFieldClick = (e) => {
    const { col, row } = cellFromEvent(e)
    setPen({ col, row })
    if (row >= MENU_ROW) triggerMenu(col) // trigger the menu command under the pen
  }

  // Keyboard alternative: arrows move the pen; Enter on the menu triggers; a char/space
  // advances it (the typewriter caret); Escape closes.
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key
      if (k === "Escape") { e.preventDefault(); act.current.onExit(); return }
      const isMove = k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" ||
        k === "ArrowDown" || k === "Enter" || k === "Backspace"
      if (!isMove && !(k.length === 1 && k >= " ")) return
      e.preventDefault()
      let { col, row } = penRef.current
      if (k === "ArrowLeft") col = Math.max(0, col - 1)
      else if (k === "ArrowRight") col = Math.min(COLS - 1, col + 1)
      else if (k === "ArrowUp") row = Math.max(0, row - 1)
      else if (k === "ArrowDown") row = Math.min(MENU_ROW, row + 1)
      else if (k === "Enter") {
        if (row >= MENU_ROW) { act.current.triggerMenu(col); return }
        row = Math.min(PAGE_ROWS - 1, row + 1); col = 0
      } else if (k === "Backspace") col = Math.max(0, col - 1)
      else { col += 1; if (col >= COLS) { col = 0; row = Math.min(PAGE_ROWS - 1, row + 1) } }
      setPen({ col, row })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const pageImg = useMemo(() => (charsetData ? renderPage(reply, charsetData).toDataURL() : null), [reply, charsetData])
  const menuImg = useMemo(() => (charsetData ? renderMenu(charsetData).toDataURL() : null), [charsetData])
  const curPage = reply?.nextpage != null ? Math.max(1, reply.nextpage - 1) : 1
  const px = (cells) => `${cells * CELL}px`
  // pen tip: bottom-center of the cell, pointing up (2× the C64 pen_icon footprint).
  const caretLeft = pen.col * CELL + CELL / 2 - 8
  const caretTop = (pen.row + 1) * CELL - 16 // 2px lower than flush-to-cell-bottom

  return html`
    <div class="text-stage" onContextMenu=${(e) => e.preventDefault()}>
      <div class="text-title">${text.title ?? "Document"} — page ${curPage}${loading ? " …" : ""}</div>
      <div
        class="text-field"
        style=${`width:${px(COLS)}; cursor:none`}
        onPointerMove=${onFieldMove}
        onClick=${onFieldClick}>
        <div class="text-page" style=${`width:${px(COLS)}; height:${px(PAGE_ROWS)}; background:${PINK}`}>
          ${pageImg ? html`<img class="text-canvas" src=${pageImg} style=${`width:${px(COLS)}; height:${px(PAGE_ROWS)}`} />` : null}
        </div>
        <div class="text-menu" style=${`width:${px(COLS)}; height:${px(1)}`}>
          ${menuImg ? html`<img class="text-canvas" src=${menuImg} style=${`width:${px(COLS)}; height:${px(1)}`} />` : null}
        </div>
        <div class="text-caret" style=${`left:${caretLeft}px; top:${caretTop}px`}></div>
      </div>
    </div>`
}
