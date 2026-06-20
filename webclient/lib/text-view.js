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
import { useState, useEffect, useCallback, useMemo } from "preact/hooks"
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

export const TextView = ({ text, onExit }) => {
  const charsetData = useCharset()
  const [reply, setReply] = useState(null)
  const [loading, setLoading] = useState(true)
  // text_handler.m pen cursor: a typewriter-tip caret that snaps to a character cell.
  const [caret, setCaret] = useState({ row: 0, col: 0 })

  const read = useCallback(async (page) => {
    setLoading(true)
    setCaret({ row: 0, col: 0 }) // home the caret on each new page (clear_sheet)
    try { setReply((await text.readPage(page)) ?? null) }
    finally { setLoading(false) }
  }, [text])

  useEffect(() => { read(READ_NEXT) }, [read]) // text_handler.m ENTER → first RECEIVE_PAGE

  // Move the pen cursor: arrows step a cell; a character or space advances (and wraps);
  // return drops a line; backspace steps back. It always snaps to a character position.
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key
      const isMove = k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" ||
        k === "ArrowDown" || k === "Enter" || k === "Backspace"
      const isType = k.length === 1 && k >= " "
      if (!isMove && !isType) return
      e.preventDefault()
      setCaret(({ row, col }) => {
        if (k === "ArrowLeft") col = Math.max(0, col - 1)
        else if (k === "ArrowRight") col = Math.min(COLS - 1, col + 1)
        else if (k === "ArrowUp") row = Math.max(0, row - 1)
        else if (k === "ArrowDown") row = Math.min(PAGE_ROWS - 1, row + 1)
        else if (k === "Enter") { row = Math.min(PAGE_ROWS - 1, row + 1); col = 0 }
        else if (k === "Backspace") col = Math.max(0, col - 1)
        else { // character / space: advance one cell, wrapping at end of line
          col += 1
          if (col >= COLS) { col = 0; row = Math.min(PAGE_ROWS - 1, row + 1) }
        }
        return { row, col }
      })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const pageImg = useMemo(
    () => (charsetData ? renderPage(reply, charsetData).toDataURL() : null),
    [reply, charsetData],
  )
  const menuImg = useMemo(
    () => (charsetData ? renderMenu(charsetData).toDataURL() : null),
    [charsetData],
  )
  const curPage = reply?.nextpage != null ? Math.max(1, reply.nextpage - 1) : 1

  const onMenu = (id) => {
    if (loading) return
    if (id === "next") read(READ_NEXT)
    else if (id === "back") read(READ_BACK)
    else if (id === "page") {
      const n = parseInt(globalThis.prompt?.("Page number?") ?? "", 10)
      if (Number.isFinite(n) && n >= 1) read(n)
    } else if (id === "quit") onExit()
  }

  const px = (cells) => `${cells * 8 * SCALE}px` // display footprint: 8px layout cell × SCALE
  return html`
    <div class="text-stage" onContextMenu=${(e) => e.preventDefault()}>
      <div class="text-title">${text.title ?? "Document"} — page ${curPage}</div>
      <div class="text-page" style=${`width:${px(COLS)}; height:${px(PAGE_ROWS)}; background:${PINK}`}>
        ${pageImg
          ? html`<img class="text-canvas" src=${pageImg} style=${`width:${px(COLS)}; height:${px(PAGE_ROWS)}`} />`
          : null}
        <div
          class="text-caret"
          style=${`left:${caret.col * 8 * SCALE + 4 * SCALE - 7}px; top:${(caret.row + 1) * 8 * SCALE - 10}px`}></div>
      </div>
      <div class="text-menu" style=${`width:${px(COLS)}; height:${px(1)}`}>
        ${menuImg ? html`<img class="text-canvas" src=${menuImg} style=${`width:${px(COLS)}; height:${px(1)}`} />` : null}
        <div class="text-menu-zones">
          <button onClick=${() => onMenu("next")} title="Next page"></button>
          <button onClick=${() => onMenu("back")} title="Back a page"></button>
          <button onClick=${() => onMenu("page")} title="Go to page #"></button>
          <button onClick=${() => onMenu("quit")} title="Close"></button>
        </div>
      </div>
    </div>`
}
