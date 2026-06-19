import assert from "node:assert/strict"
import {
  createTextInputState,
  handleKey,
  enterEspMode,
  exitEspMode,
  applyEspReply,
  displayBytes,
  displayScrollOffset,
  submitPayload,
  clearTextLine,
  MAX_TEXT_DISPLAY_LENGTH,
} from "./lib/text-input.mjs"

const st = createTextInputState()
handleKey(st, "H")
handleKey(st, "i")
assert.equal(st.buffer, "Hi")
assert.equal(st.cursor, 2)

handleKey(st, "Backspace")
assert.equal(st.buffer, "H")

handleKey(st, "!")
handleKey(st, "Enter")
const speak = submitPayload(st)
assert.equal(speak.kind, "speak")
assert.equal(speak.text, "H!")

clearTextLine(st)
enterEspMode(st)
assert.equal(st.buffer, "ESP:")
assert.equal(st.leftBound, 4)
handleKey(st, "Backspace")
assert.equal(st.buffer, "ESP:")
handleKey(st, "p")
handleKey(st, "s")
handleKey(st, "t")
const esp = submitPayload(st)
assert.equal(esp.kind, "esp")
assert.equal(esp.text, "pst")

enterEspMode(st)
handleKey(st, "Enter")
const exit = submitPayload(st)
assert.equal(exit.kind, "esp-exit")

applyEspReply(st, 1)
assert.equal(st.espMode, true)
assert.equal(st.buffer, "ESP:")
applyEspReply(st, 0)
assert.equal(st.espMode, false)
assert.equal(st.buffer, "")

const long = createTextInputState()
for (let i = 0; i < 45; i++) handleKey(long, "a")
assert.ok(displayScrollOffset(long) > 0)
const win = displayBytes(long)
assert.equal(win.length, MAX_TEXT_DISPLAY_LENGTH)
assert.equal(win[MAX_TEXT_DISPLAY_LENGTH - 1], 0)
assert.equal(win[MAX_TEXT_DISPLAY_LENGTH - 2], "a".charCodeAt(0))

console.log("text-input tests ok")