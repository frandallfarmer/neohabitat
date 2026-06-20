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

assert(cursorStateFromStick(0b1110) === CURSOR_GET, "up → GET")
assert(cursorStateFromStick(0b0111) === CURSOR_GO, "right → GO")
assert(cursorStateFromStick(0b1011) === CURSOR_DO, "left → DO")
assert(cursorStateFromStick(0b1101) === CURSOR_PUT, "down → PUT")

assert(commandFromCursorState(0) === COMMAND_STOP, "normal → STOP")
assert(commandFromCursorState(CURSOR_GO) === COMMAND_GO, "go cursor → GO cmd")
assert(actionFromCommand(COMMAND_PUT) === 5, "PUT → ACTION_PUT")

assert(cursorStateFromStick(0b1111) === null, "centered stick must not latch STOP")

console.log("test-cursor: ok")