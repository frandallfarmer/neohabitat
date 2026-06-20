// Port of Main/cursor.m — modal cursor verb selection (not a wedge menu).
//
// Hold trigger + stick direction → cursor_state icon (cursor frozen).
// Release with stick centered → state_to_command → execute_command.
// Quick tap (no drag) stays normal_cursor → STOP (face cursor).
//
// Joystick nibble (keys.m): bit0=up, bit1=down, bit2=left, bit3=right; 0=pressed.

export const CURSOR_NORMAL = 0
export const CURSOR_DO = 1
export const CURSOR_GO = 2
export const CURSOR_STOP = 3
export const CURSOR_GET = 4
export const CURSOR_PUT = 5
export const CURSOR_PEN = 6

/** command_* from farmers_equates.m — maps to habiworld ACTION_* slots. */
export const COMMAND_STOP = 3
export const COMMAND_DO = 0
export const COMMAND_GO = 2
export const COMMAND_GET = 4
export const COMMAND_PUT = 5

/** cursor.m cursor_point_table (Main/cursor.m:239) — byte-exact C64 port.
 *  Indexed by the joystick nibble (keys.m: bit0=up, bit1=down, bit2=left,
 *  bit3=right; 0=pressed). Cardinals: UP=GO, DOWN=DO, LEFT=PUT, RIGHT=GET.
 *  Diagonals resolve (any up-component→GO, any down-component→DO); the
 *  centered nibble (0xf)=STOP. */
export const CURSOR_POINT_TABLE = Int8Array.from([
  -1, -1,        -1,        -1,
  -1, CURSOR_DO, CURSOR_GO, CURSOR_GET,
  -1, CURSOR_DO, CURSOR_GO, CURSOR_PUT,
  -1, CURSOR_DO, CURSOR_GO, CURSOR_STOP,
])

/** cursor.m state_to_command — indexed by cursor_state. */
export const STATE_TO_COMMAND = Uint8Array.from([
  COMMAND_STOP, COMMAND_DO, COMMAND_GO, COMMAND_STOP,
  COMMAND_GET, COMMAND_PUT,
])

export const COMMAND_TO_ACTION = {
  [COMMAND_DO]: 0,
  [COMMAND_GO]: 2,
  [COMMAND_STOP]: 3,
  [COMMAND_GET]: 4,
  [COMMAND_PUT]: 5,
}

const COMMAND_LABEL = {
  [COMMAND_DO]: "DO",
  [COMMAND_GO]: "GO",
  [COMMAND_STOP]: "STOP",
  [COMMAND_GET]: "GET",
  [COMMAND_PUT]: "PUT",
}

/** C64 read_joystick nibble from drag delta (screen pixels, scaled). */
export function stickIndexFromDrag(dx, dy, threshold = 10) {
  let bits = 0b1111
  if (dy < -threshold) bits &= ~0b0001
  if (dy > threshold) bits &= ~0b0010
  if (dx < -threshold) bits &= ~0b0100
  if (dx > threshold) bits &= ~0b1000
  return bits
}

export function cursorStateFromStick(stickIndex) {
  const next = CURSOR_POINT_TABLE[stickIndex & 0xf]
  // Centered stick (1111 → stop_cursor) is the ? menu, not a direction pick.
  // C64 sticky-holds the latched verb here; don't overwrite with STOP on re-center.
  if (next < 0 || next === CURSOR_STOP) return null
  return next
}

export function commandFromCursorState(cursorState) {
  if (cursorState < 0 || cursorState >= STATE_TO_COMMAND.length) return COMMAND_STOP
  return STATE_TO_COMMAND[cursorState]
}

export function actionFromCommand(command) {
  return COMMAND_TO_ACTION[command] ?? 3
}

export function labelFromCommand(command) {
  return COMMAND_LABEL[command] ?? "STOP"
}