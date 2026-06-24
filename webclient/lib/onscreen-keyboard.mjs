// Optional pointer-driven C64-style keyboard for touch / kiosk clients. Mobile browsers only
// raise the native soft keyboard for a focused editable element, and the text line is a canvas —
// so rather than fight the native keyboard (viewport resize, Android keydown quirks, off-look)
// we render our own and SYNTHESIZE keydown events. Acting as a virtual physical keyboard means
// every existing handler works unchanged: text entry (TextInputLine handleKey), Ctrl+digit
// gestures (live.js capture handler), and the F-keys (live.js) — no per-handler wiring.
//
// CTRL and SHIFT are single-use sticky (one-shot): tap to arm, the next key consumes and releases
// it (tap again to cancel). SHIFT rewrites the key face (upper-case / shifted symbol / even F-key);
// CTRL sets ctrlKey on the synthesized event.

import { h } from "preact"
import { useState } from "preact/hooks"
import htm from "htm"

const html = htm.bind(h)

// face → { lower, upper }. Letters upper-case on shift; the number row goes to symbols; the four
// physical C64 function keys shift to their even siblings (C64: SHIFT+F1 = F2, etc.).
const NUM = "1234567890"
const NUM_SHIFT = "!@#$%^&*()"
const ROW2 = "qwertyuiop"
const ROW3 = "asdfghjkl"
const ROW4 = "zxcvbnm"
const FKEYS = [["F1", "F2"], ["F3", "F4"], ["F5", "F6"], ["F7", "F8"]]

export function OnScreenKeyboard({ onClose }) {
  const [shift, setShift] = useState(false)
  const [ctrl, setCtrl] = useState(false)

  // Synthesize a physical keydown so the live client's existing window handlers run. Dispatch on
  // the focused element (falling back to body) and mark it `synthetic` so the focus-gated
  // text-input handler accepts it even though a keyboard button — not the text line — was tapped.
  const sendKey = (key) => {
    const target = (document.activeElement && document.activeElement !== document.body)
      ? document.activeElement : document.body
    const ev = new KeyboardEvent("keydown", { key, ctrlKey: ctrl, bubbles: true, cancelable: true })
    ev.synthetic = true
    target.dispatchEvent(ev)
  }

  const tap = (key) => (e) => {
    e.preventDefault() // immediate; don't steal focus / scroll / zoom / select
    if (key === "Shift") { setShift((s) => !s); return }
    if (key === "Control") { setCtrl((c) => !c); return }
    sendKey(key)
    if (shift) setShift(false) // one-shot
    if (ctrl) setCtrl(false)   // one-shot
  }

  // A character key whose face flips with shift.
  const ck = (lower, upper) => {
    const face = shift ? upper : lower
    return html`<button class="osk-key" onPointerDown=${tap(face)}>${face}</button>`
  }
  const mod = (label, key, active) => html`
    <button class=${"osk-key osk-mod" + (active ? " osk-active" : "")} onPointerDown=${tap(key)}>${label}</button>`
  const sp = (label, key, cls = "") => html`
    <button class=${"osk-key osk-mod " + cls} onPointerDown=${tap(key)}>${label}</button>`

  return html`
    <div class="osk" onPointerDown=${(e) => e.preventDefault()}>
      <div class="osk-row osk-fkeys">
        ${FKEYS.map(([a, b]) => html`<button class="osk-key osk-fkey"
            onPointerDown=${tap(shift ? b : a)}>${shift ? b : a}</button>`)}
        ${onClose ? html`<button class="osk-key osk-mod osk-close"
            onPointerDown=${(e) => { e.preventDefault(); onClose() }}>⌨✕</button>` : null}
      </div>
      <div class="osk-row">${NUM.split("").map((c, i) => ck(c, NUM_SHIFT[i]))}</div>
      <div class="osk-row">${ROW2.split("").map((c) => ck(c, c.toUpperCase()))}</div>
      <div class="osk-row">
        ${ROW3.split("").map((c) => ck(c, c.toUpperCase()))}
        ${ck(":", ";")}
      </div>
      <div class="osk-row">
        ${mod("CTRL", "Control", ctrl)}
        ${ROW4.split("").map((c) => ck(c, c.toUpperCase()))}
        ${ck(",", "<")}
        ${ck(".", ">")}
        ${ck("?", "/")}
        ${sp("DEL", "Backspace")}
      </div>
      <div class="osk-row osk-bottom">
        ${mod("SHIFT", "Shift", shift)}
        ${sp("SPACE", " ", "osk-space")}
        ${sp("RETURN", "Enter", "osk-return")}
      </div>
      <div class="osk-row osk-arrows">
        ${sp("◀", "ArrowLeft")}
        ${sp("▲", "ArrowUp")}
        ${sp("▼", "ArrowDown")}
        ${sp("▶", "ArrowRight")}
      </div>
    </div>`
}
