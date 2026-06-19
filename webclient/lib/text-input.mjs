// C64 speak line — port of Main/keyboard.m (display_text_line, clear_text_line)
// and actions.m (get_ESP_text, ESP_talk / talk).

export const MAX_TEXT_LINE_LENGTH = 100
export const MAX_TEXT_DISPLAY_LENGTH = 40
export const BLANK_CHAR = 0
export const NO_LEFT_BOUND = 0xff

const ESP_PREFIX = "ESP:"

export function createTextInputState() {
  return {
    buffer: "",
    cursor: 0,
    leftBound: NO_LEFT_BOUND,
    espMode: false,
    awaitingPrompt: false,
    revision: 0,
  }
}

export function clearTextLine(state, { keepPrefix = false } = {}) {
  const prefix = keepPrefix && state.leftBound !== NO_LEFT_BOUND
    ? state.buffer.slice(0, state.leftBound)
    : ""
  state.buffer = prefix
  state.cursor = prefix.length
  if (!prefix) state.leftBound = NO_LEFT_BOUND
  state.revision++
  return state
}

export function enterEspMode(state) {
  state.espMode = true
  state.leftBound = ESP_PREFIX.length
  state.buffer = ESP_PREFIX
  state.cursor = ESP_PREFIX.length
  state.revision++
  return state
}

export function exitEspMode(state) {
  state.espMode = false
  state.leftBound = NO_LEFT_BOUND
  clearTextLine(state)
  return state
}

export function applyEspReply(state, espFlag) {
  const on = espFlag === 1 || espFlag === true
  if (on) enterEspMode(state)
  else if (state.espMode) exitEspMode(state)
  else clearTextLine(state)
  state.revision++
  return state
}

export function setPromptLine(state, prompt) {
  const text = String(prompt ?? "")
  state.awaitingPrompt = true
  state.leftBound = text.length
  state.buffer = text
  state.cursor = text.length
  state.revision++
  return state
}

export function endPrompt(state) {
  state.awaitingPrompt = false
  state.leftBound = NO_LEFT_BOUND
  clearTextLine(state)
  return state
}

function effectiveLeftBound(state) {
  return state.leftBound === NO_LEFT_BOUND ? 0 : state.leftBound
}

export function insertChar(state, charCode) {
  if (charCode < 32 || charCode > 126) return false
  if (state.buffer.length >= MAX_TEXT_LINE_LENGTH - 1) return false
  const left = state.buffer.slice(0, state.cursor)
  const right = state.buffer.slice(state.cursor)
  state.buffer = left + String.fromCharCode(charCode) + right
  state.cursor++
  state.revision++
  return true
}

export function deleteChar(state) {
  const bound = effectiveLeftBound(state)
  if (state.cursor <= bound) return false
  state.buffer = state.buffer.slice(0, state.cursor - 1) + state.buffer.slice(state.cursor)
  state.cursor--
  state.revision++
  return true
}

export function clearLine(state) {
  clearTextLine(state, { keepPrefix: state.espMode || state.awaitingPrompt })
  return state
}

export function displayScrollOffset(state, showCursor = true) {
  const visibleLen = state.buffer.length + (showCursor ? 1 : 0)
  if (visibleLen <= MAX_TEXT_DISPLAY_LENGTH) return 0
  return visibleLen - MAX_TEXT_DISPLAY_LENGTH
}

export function displayBytes(state, { showCursor = true, cursorChar = BLANK_CHAR } = {}) {
  const scroll = displayScrollOffset(state, showCursor)
  const bytes = []
  for (let col = 0; col < MAX_TEXT_DISPLAY_LENGTH; col++) {
    const idx = scroll + col
    const bufIdx = idx
    if (showCursor && bufIdx === state.cursor) {
      bytes.push(cursorChar)
    } else {
      let src = bufIdx
      if (showCursor && bufIdx > state.cursor) src--
      if (src >= 0 && src < state.buffer.length) bytes.push(state.buffer.charCodeAt(src) & 0xff)
      else bytes.push(32)
    }
  }
  return bytes
}

export function submitPayload(state) {
  if (state.awaitingPrompt) {
    const text = state.buffer
    if (!text || text.length <= effectiveLeftBound(state)) return null
    return { kind: "prompt", text }
  }

  const bound = effectiveLeftBound(state)
  const text = state.buffer
  if (!text || text.length <= bound) {
    if (state.espMode) return { kind: "esp-exit", text: "" }
    return null
  }

  if (state.espMode) {
    const body = text.slice(bound)
    return { kind: "esp", text: body }
  }
  return { kind: "speak", text }
}

export function handleKey(state, key, { ctrlKey = false } = {}) {
  if (key === "Enter") {
    const payload = submitPayload(state)
    return { state, action: payload ? "submit" : "noop", payload }
  }
  if (key === "Backspace") {
    deleteChar(state)
    return { state, action: "edit" }
  }
  if (key === "Escape" || (ctrlKey && (key === "c" || key === "C" || key === "u" || key === "U"))) {
    clearLine(state)
    return { state, action: "edit" }
  }
  if (key.length === 1) {
    insertChar(state, key.charCodeAt(0))
    return { state, action: "edit" }
  }
  return { state, action: "noop" }
}