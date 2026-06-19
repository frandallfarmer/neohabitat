import assert from "node:assert/strict"
import {
  formatBalloonText,
  vicColorForSpeaker,
  assignTalkerSlot,
  balloonLineSpan,
  speakerAnchorPx,
  speakerXposFromMod,
  BALLOON_CHAR,
  LINE_WIDTH,
} from "./lib/balloons-layout.mjs"

const lines = formatBalloonText("Hello, neighbor!", 3, { centerX: 80 })
assert.equal(lines.length, 1)
const span = balloonLineSpan(lines[0])
assert.ok(span.width > 0)
assert.ok(span.width < LINE_WIDTH, "single-line balloon should be compact")
assert.equal(lines[0][span.start], BALLOON_CHAR.LEFT_CAP)
assert.equal(lines[0][span.start + span.width - 1], BALLOON_CHAR.RIGHT_CAP)
const lineText = lines[0].map((b) => (b >= 32 ? String.fromCharCode(b) : "")).join("")
assert.ok(lineText.includes("Hello"))

const left = formatBalloonText("Hi", 3, { centerX: 32 })
const right = formatBalloonText("Hi", 3, { centerX: 128 })
assert.ok(balloonLineSpan(left[0]).start < balloonLineSpan(right[0]).start)

assert.equal(speakerXposFromMod(80), 88)
assert.equal(speakerAnchorPx(88), 168)

const wrapped = formatBalloonText(
  "This is a longer message that should wrap across multiple balloon lines in the C64 style.",
  3,
)
assert.ok(wrapped.length >= 2)
assert.equal(wrapped[0][0], BALLOON_CHAR.LEFT_UP)
assert.equal(wrapped[wrapped.length - 1][0], BALLOON_CHAR.LEFT_DOWN)
assert.equal(balloonLineSpan(wrapped[0]).width, LINE_WIDTH, "wrapped lines span the text window")

const slots = [0, 0, 0, 0, 0, 0]
assignTalkerSlot(slots, 21)
assignTalkerSlot(slots, 29)
assert.equal(vicColorForSpeaker({ talkerSlots: slots, meNoid: 1, speakerNoid: 1 }), 1)
assert.notEqual(vicColorForSpeaker({ talkerSlots: slots, meNoid: 1, speakerNoid: 21 }), 1)

console.log("balloon layout tests ok")