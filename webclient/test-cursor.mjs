// Node tests: cursor.m stick table (Main/cursor.m).
import {
  stickIndexFromDrag,
  cursorStateFromStick,
  commandFromCursorState,
  actionFromCommand,
  CURSOR_GO,
  CURSOR_PUT,
  CURSOR_GET,
  CURSOR_DO,
  CURSOR_STOP,
  COMMAND_STOP,
  COMMAND_GO,
  COMMAND_PUT,
} from "./lib/cursor.mjs"

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

assert(stickIndexFromDrag(0, 0) === 0b1111, "centered stick")
assert(stickIndexFromDrag(0, -20) === 0b1110, "up → bit0 clear")
assert(stickIndexFromDrag(20, 0) === 0b0111, "right")
assert(stickIndexFromDrag(-20, 0) === 0b1011, "left")
assert(stickIndexFromDrag(0, 20) === 0b1101, "down")
assert(stickIndexFromDrag(20, 20) === 0b0101, "down+right")

// cursor.m cursor_point_table: UP=GO, DOWN=DO, LEFT=PUT, RIGHT=GET.
assert(cursorStateFromStick(0b1110) === CURSOR_GO, "up → GO")
assert(cursorStateFromStick(0b0111) === CURSOR_GET, "right → GET")
assert(cursorStateFromStick(0b1011) === CURSOR_PUT, "left → PUT")
assert(cursorStateFromStick(0b1101) === CURSOR_DO, "down → DO")
assert(cursorStateFromStick(0b0101) === CURSOR_DO, "down+right diagonal → DO")

assert(commandFromCursorState(0) === COMMAND_STOP, "normal → STOP")
assert(commandFromCursorState(CURSOR_GO) === COMMAND_GO, "go cursor → GO cmd")
assert(actionFromCommand(COMMAND_PUT) === 5, "PUT → ACTION_PUT")

// Virtual joystick: center resolves to STOP (back-out), not a latch.
assert(cursorStateFromStick(0b1111) === CURSOR_STOP, "centered stick returns STOP (back-out)")
assert(cursorStateFromStick(0b1110) === CURSOR_GO, "up still GO after re-center support")

console.log("test-cursor: ok")