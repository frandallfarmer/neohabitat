// Text display — port of Main/text_handler.m (read + edit). Replaces the region while
// reading a document/book or editing a sheet of paper. Rendered with the canonical Habitat
// charset (the balloon/speak-line frameFromText engine): black ink on the C64 pink page
// (color_pink = 0x0a), with the menu in the game font on a white strip. The pen cursor IS
// the pointer (OS cursor hidden), snapping to a character cell over the page or a menu zone.
//
// Reading: paging via the neohabitat READ protocol (Document.java): page 0 = next, 254 =
// back; reply { nextpage, ascii }. Editing (paper): type into the page grid; Paper_Menu
// ERASE / REPLY / MAIL IT / QUIT; WRITE saves the sheet, PSENDMAIL posts it as mail.

import { h } from "preact"
import htm from "htm"
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks"
import { frameFromText, c64Colors } from "../habirender/render.js"
import { charset, until } from "../habirender/data.js"
import { makeCanvas } from "../habirender/shim.js"

const html = htm.bind(h)

const COLS = 40
const PAGE_ROWS = 16        // Document.java LINES_PER_PAGE
// Same scale model as the word balloons (balloons.js): full glyphs are 16px wide native
// (2 cells × 8) and 8px tall, then scaled to the 8px-layout footprint. display = layout × SCALE.
const NATIVE_CW = 16
const NATIVE_RH = 8
const SCALE = 3
const CELL = 8 * SCALE       // display px per character cell
const MENU_ROW = PAGE_ROWS   // row index of the menu line (just below the page)
const TXTCMD_HALF_SIZE = 128 + 5
const BITMAP_PATTERN = 0xff
const INK = { pattern: 15, wildcard: 0, skin: 0 } // black ink on a solid field
const PINK = `#${c64Colors[0x0a].toString(16).padStart(6, "0")}` // color_pink (light_red)
const SPACE = 32

// text_handler.m menus + their cursor-zone command order (4 × 10-col quarters).
const BOOK_MENU = "NEXT      BACK      PAGE #    QUIT      "
const PAPER_MENU = "ERASE     REPLY     MAIL IT   QUIT      "
const BOOK_ZONES = ["next", "back", "page", "quit"]
const PAPER_ZONES = ["erase", "reply", "mail", "quit"]
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

const blankGrid = () => Array.from({ length: PAGE_ROWS }, () => new Array(COLS).fill(SPACE))

function gridFromReply(reply) {
  const grid = blankGrid()
  pageRows(reply).forEach((row, r) => {
    if (r < PAGE_ROWS) row.forEach((b, c) => { if (c < COLS) grid[r][c] = b })
  })
  return grid
}

// Grid → request_ascii for Paper.java WRITE: trim trailing blanks, rows joined by 10.
// Empty page → a length-16 array (the server's "clear" sentinel).
function gridToAscii(grid) {
  let lastRow = -1
  for (let r = 0; r < PAGE_ROWS; r++) if (grid[r].some((b) => b !== SPACE && b !== 0)) lastRow = r
  if (lastRow < 0) return new Array(16).fill(0)
  const out = []
  for (let r = 0; r <= lastRow; r++) {
    let lastCol = -1
    for (let c = 0; c < COLS; c++) if (grid[r][c] !== SPACE && grid[r][c] !== 0) lastCol = c
    for (let c = 0; c <= lastCol; c++) out.push(grid[r][c] || SPACE)
    if (r < lastRow) out.push(10)
  }
  if (out.length === 16) out.push(SPACE) // never collide with the clear sentinel
  return out
}

// Render one charset line (full glyphs) onto ctx at (0, y) — caller pre-fills the field.
// A blank / all-spaces line yields no glyph layers (0×0 composite), which drawImage rejects.
function drawLine(ctx, bytes, y, charsetData) {
  if (!bytes.length || !charsetData) return
  const frame = frameFromText(0, 8, [TXTCMD_HALF_SIZE, ...bytes], charsetData, BITMAP_PATTERN, 0, INK)
  if (frame?.canvas?.width > 0 && frame.canvas.height > 0) ctx.drawImage(frame.canvas, 0, y)
}

function renderPage(rows, charsetData) {
  const w = COLS * NATIVE_CW, h = PAGE_ROWS * NATIVE_RH
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = PINK
  ctx.fillRect(0, 0, w, h)
  rows.forEach((row, i) => { if (i < PAGE_ROWS) drawLine(ctx, row, i * NATIVE_RH, charsetData) })
  return canvas
}

function renderMenu(menuText, charsetData) {
  const w = COLS * NATIVE_CW, h = NATIVE_RH
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, w, h)
  drawLine(ctx, [...menuText].map((c) => c.charCodeAt(0) & 0xff), 0, charsetData)
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

export const TextView = ({ text, onExit }) => {
  const editable = !!text.editable
  const menuText = editable ? PAPER_MENU : BOOK_MENU
  const zones = editable ? PAPER_ZONES : BOOK_ZONES

  const charsetData = useCharset()
  const [reply, setReply] = useState(null)
  const [loading, setLoading] = useState(true)
  const [grid, setGrid] = useState(blankGrid)        // editable page buffer
  // The pen cursor IS the pointer (OS cursor hidden): a typewriter tip snapping to a cell.
  const [pen, setPenState] = useState({ col: 0, row: 0 })
  const penRef = useRef(pen)
  const setPen = (p) => { penRef.current = p; setPenState(p) }

  const read = useCallback(async (page) => {
    setLoading(true)
    setPen({ col: 0, row: 0 })
    try {
      const r = (await text.readPage(page)) ?? null
      setReply(r)
      if (editable) setGrid(gridFromReply(r))
    } finally { setLoading(false) }
  }, [text, editable])

  useEffect(() => { read(READ_NEXT) }, [read]) // text_handler.m ENTER → first RECEIVE_PAGE

  const onMenu = (id) => {
    if (id === "next") read(READ_NEXT)
    else if (id === "back") read(READ_BACK)
    else if (id === "page") {
      const n = parseInt(globalThis.prompt?.("Page number?") ?? "", 10)
      if (Number.isFinite(n) && n >= 1) read(n)
    } else if (id === "erase") { setGrid(blankGrid()); setPen({ col: 0, row: 0 }) }
    else if (id === "reply") {
      setGrid((g) => { const ng = g.map((r) => r.slice()); "To: ".split("").forEach((ch, c) => { ng[0][c] = ch.charCodeAt(0) }); return ng })
      setPen({ col: 4, row: 0 })
    } else if (id === "mail") {
      // Save the sheet, then post it to the addressee written on it ("To: name").
      Promise.resolve(text.writePage?.(gridToAscii(grid)))
        .then(() => text.sendMail?.()).finally(onExit)
    } else if (id === "quit") {
      if (editable && text.writePage) Promise.resolve(text.writePage(gridToAscii(grid))).finally(onExit)
      else onExit()
    }
  }
  const triggerMenu = (col) => onMenu(zones[Math.min(3, Math.floor(col / 10))])
  // Latest actions for the keyboard listener (registered once on mount).
  const act = useRef({})
  act.current = { triggerMenu, onExit, editable }

  // Pen follows the mouse, snapping to the cell under it (page rows 0..15, menu = 16).
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
    if (row >= MENU_ROW) triggerMenu(col)
  }

  // Keyboard: arrows move the pen; Enter on the menu triggers; a char/space advances it
  // (and, editing, writes it into the page grid); backspace clears back; Escape closes.
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key
      if (k === "Escape") { e.preventDefault(); act.current.onExit(); return }
      const isMove = k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" ||
        k === "ArrowDown" || k === "Enter" || k === "Backspace"
      const isType = k.length === 1 && k >= " "
      if (!isMove && !isType) return
      e.preventDefault()
      let { col, row } = penRef.current
      if (k === "ArrowLeft") col = Math.max(0, col - 1)
      else if (k === "ArrowRight") col = Math.min(COLS - 1, col + 1)
      else if (k === "ArrowUp") row = Math.max(0, row - 1)
      else if (k === "ArrowDown") row = Math.min(MENU_ROW, row + 1)
      else if (k === "Enter") {
        if (row >= MENU_ROW) { act.current.triggerMenu(col); return }
        row = Math.min(PAGE_ROWS - 1, row + 1); col = 0
      } else if (k === "Backspace") {
        col = Math.max(0, col - 1)
        if (act.current.editable && row < PAGE_ROWS) {
          const wc = col
          setGrid((g) => { const ng = g.map((r) => r.slice()); ng[row][wc] = SPACE; return ng })
        }
      } else { // character / space
        if (act.current.editable && row < PAGE_ROWS) {
          const wc = col, wr = row, code = k.charCodeAt(0) & 0xff
          setGrid((g) => { const ng = g.map((r) => r.slice()); ng[wr][wc] = code; return ng })
        }
        col += 1
        if (col >= COLS) { col = 0; row = Math.min(PAGE_ROWS - 1, row + 1) }
      }
      setPen({ col, row })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const rows = editable ? grid : pageRows(reply)
  const pageImg = useMemo(
    () => (charsetData ? renderPage(rows, charsetData).toDataURL() : null),
    [editable ? grid : reply, charsetData],
  )
  const menuImg = useMemo(
    () => (charsetData ? renderMenu(menuText, charsetData).toDataURL() : null),
    [menuText, charsetData],
  )
  const curPage = reply?.nextpage != null ? Math.max(1, reply.nextpage - 1) : 1
  const px = (cells) => `${cells * CELL}px`
  const caretLeft = pen.col * CELL + CELL / 2 - 8
  const caretTop = (pen.row + 1) * CELL - 16 // 2px lower than flush-to-cell-bottom

  return html`
    <div class="text-stage" onContextMenu=${(e) => e.preventDefault()}>
      <div class="text-title">
        ${text.title ?? "Document"}${editable ? " — editing" : ` — page ${curPage}`}${loading ? " …" : ""}
      </div>
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
