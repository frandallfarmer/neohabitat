// Pure balloon layout + color logic (Main/balloons.m, actions.m) — no DOM/canvas.
// TODO: wrapped lines should not pad to full width.

export const LINE_WIDTH = 40
export const INNER_WIDTH = LINE_WIDTH - 2
export const C64_MAX_BALLOON_LINES = 3
export const C64_MAX_DISPLAY_LINES = 7

export const BALLOON_CHAR = {
  LEFT_UP: 1,
  LEFT_SIDE: 2,
  LEFT_DOWN: 3,
  RIGHT_UP: 4,
  RIGHT_SIDE: 5,
  RIGHT_DOWN: 6,
  LEFT_CAP: 7,
  RIGHT_CAP: 8,
  BLANK: 0,
}

export const COLORS_8 = [3, 13, 7, 8, 12, 4, 10, 14]

const QUIP_MIN_X = 16
const QUIP_MAX_X = 157
// justify_balloon + renderer alignment: one 8px column left of naive (mod.x+8)*2.
const BALLOON_ANCHOR_CORRECTION_PX = 8

export function signedHabitatX(modX) {
  return modX > 208 ? modX - 256 : modX
}

/** Screen-pixel anchor: balloon center and quip tip after justify_balloon (no trailing inc). */
export function speakerAnchorPx(xpos) {
  return xpos * 2 - BALLOON_ANCHOR_CORRECTION_PX
}

export function clampQuipX(x) {
  if (x <= 0) return 0
  if (x < QUIP_MIN_X) return QUIP_MIN_X
  if (x > QUIP_MAX_X) return QUIP_MAX_X
  return x
}

export function assignTalkerSlot(slots, noid) {
  if (noid == null) return
  if (slots.indexOf(noid) >= 0) return
  const free = slots.indexOf(0)
  if (free >= 0) slots[free] = noid
}

export function freeTalkerSlot(slots, noid) {
  if (noid == null) return
  const idx = slots.indexOf(noid)
  if (idx >= 0) slots[idx] = 0
}

export function vicColorForSpeaker({ talkerSlots, meNoid, speakerNoid }) {
  if (speakerNoid == null) return 1
  if (meNoid != null && speakerNoid === meNoid) return 1
  const slot = talkerSlots.indexOf(speakerNoid)
  if (slot >= 0) return COLORS_8[(slot + 1) % COLORS_8.length]
  return COLORS_8[speakerNoid & 7]
}

// Port of justify_balloon in Main/balloons.m — compact [left][text][right] centered on xpos.
function justifyLine(line, centerX = 80) {
  let end = 0
  for (let col = 1; col < LINE_WIDTH - 1; col++) {
    if (line[col] !== BALLOON_CHAR.BLANK) end = col
  }
  if (end >= INNER_WIDTH) {
    line[0] = BALLOON_CHAR.LEFT_CAP
    line[LINE_WIDTH - 1] = BALLOON_CHAR.RIGHT_CAP
    return
  }
  const lineLength = end + 2
  const compact = new Array(lineLength)
  compact[0] = BALLOON_CHAR.LEFT_CAP
  for (let i = 1; i <= end; i++) compact[i] = line[i]
  compact[end + 1] = BALLOON_CHAR.RIGHT_CAP

  // 6502 justify_balloon: xpos/4 − hold − 1 (carry clear), no trailing inc.
  let startPos = Math.floor(centerX / 4) - Math.floor(lineLength / 2) - 1
  if (startPos < 0) startPos = 0
  while (startPos > 0 && startPos + lineLength > LINE_WIDTH) startPos--

  line.fill(BALLOON_CHAR.BLANK)
  for (let i = 0; i < lineLength; i++) line[startPos + i] = compact[i]
}

export function balloonLineSpan(bytes) {
  let left = LINE_WIDTH
  let right = -1
  for (let col = 0; col < LINE_WIDTH; col++) {
    const b = bytes[col]
    if (b === BALLOON_CHAR.BLANK) continue
    left = Math.min(left, col)
    right = Math.max(right, col)
  }
  if (right < left) return { start: 0, width: 0 }
  return { start: left, width: right - left + 1 }
}

function addBalloonCorners(lines) {
  if (lines.length <= 1) return
  const top = lines[0]
  const bottom = lines[lines.length - 1]
  top[0] = BALLOON_CHAR.LEFT_UP
  top[LINE_WIDTH - 1] = BALLOON_CHAR.RIGHT_UP
  bottom[0] = BALLOON_CHAR.LEFT_DOWN
  bottom[LINE_WIDTH - 1] = BALLOON_CHAR.RIGHT_DOWN
}

export function formatBalloonText(text, maxLines = C64_MAX_BALLOON_LINES, { centerX = 80, wordWrap = true } = {}) {
  const src = String(text).replace(/\r?\n/g, " ").trim()
  const lines = []
  let pos = 0

  const blankLine = () => {
    const line = new Array(LINE_WIDTH).fill(BALLOON_CHAR.BLANK)
    line[0] = BALLOON_CHAR.LEFT_SIDE
    line[LINE_WIDTH - 1] = BALLOON_CHAR.RIGHT_SIDE
    return line
  }

  while (pos < src.length && lines.length < maxLines) {
    const line = blankLine()
    let col = 1
    let lastSpace = INNER_WIDTH
    while (col <= INNER_WIDTH && pos < src.length) {
      const ch = src.charCodeAt(pos)
      if (ch < 32) {
        pos++
        continue
      }
      if (ch === 32) lastSpace = col
      line[col] = ch
      col++
      pos++
      if (col > INNER_WIDTH) {
        if (wordWrap && lastSpace > 1 && lastSpace < INNER_WIDTH) {
          col = lastSpace
          pos -= (INNER_WIDTH - lastSpace + 1)
          for (let i = lastSpace; i <= INNER_WIDTH; i++) line[i] = BALLOON_CHAR.BLANK
        }
        break
      }
    }
    if (pos < src.length && src.charCodeAt(pos) === 32) pos++
    lines.push(line)
    if (pos >= src.length) break
  }

  if (lines.length === 1) justifyLine(lines[0], centerX)
  else addBalloonCorners(lines)
  return lines
}

export function speakerXposFromMod(modX, { couch = false } = {}) {
  let x = signedHabitatX(modX) + 8
  if (couch) x += 8
  return clampQuipX(x)
}

export function speakerQuipX(world, speakerNoid) {
  if (speakerNoid == null || !world) return 0
  const rec = world.get(speakerNoid)
  if (!rec?.mod || rec.mod.x == null) return 0
  const couch = rec.type === "Couch" || rec.type === "Bed"
  return speakerXposFromMod(rec.mod.x, { couch })
}

export function speakerAnchorForRecord(rec) {
  if (!rec?.mod || rec.mod.x == null) return 0
  const couch = rec.type === "Couch" || rec.type === "Bed"
  const xpos = speakerXposFromMod(rec.mod.x, { couch })
  if (xpos <= 0) return 0
  return speakerAnchorPx(xpos)
}