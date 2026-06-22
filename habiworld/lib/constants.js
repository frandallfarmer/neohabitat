/* jshint esversion: 8 */

'use strict'

// Shared protocol constants. Sources: the C64 object layout
// (sources/c64/Main/class_equates.m in the MADE repo) and elko's
// Constants.java, which preserved the same values.

// Avatar container slot indices.
const MAIL_SLOT = 4
const HANDS = 5
const HEAD = 6

// Container noid 0 = the region itself (Main/actions.m:768).
const THE_REGION = 0

// The singleton ghost object's noid (Main/farmers_equates.m:41, Constants.GHOST_NOID).
// When you are an observer you ARE this noid — there is one Ghost per region representing
// all ghosted users. me.noid === GHOST_NOID is the "am I a ghost" test.
const GHOST_NOID = 255

// User-verb slots in every class's action table (action_head.i:178-185).
// Slots 8+ are class-specific: host-message handlers for avatar/region
// (slot number == host message number), internal chain targets elsewhere.
const ACTION_DO      = 0
const ACTION_RDO     = 1 // "reverse do" — the in-hand item's depends target
const ACTION_GO      = 2
const ACTION_STOP    = 3
const ACTION_GET     = 4
const ACTION_PUT     = 5
const ACTION_TALK    = 6
const ACTION_DESTROY = 7

// open_flags bits: Openable.java / Constants.java.
// OPEN_BIT | UNLOCKED_BIT is the "open and unlocked" state set by OPEN$/OPENCONTAINER$.
const OPEN_BIT     = 1
const UNLOCKED_BIT = 2

// Habitat world-coordinate screen width (x runs 0..159). Used to scale
// walk-animation waits in the action recipes.
const SCREEN_WIDTH = 160

// FIDDLE_$ pokes an object field by its offset in the C64 in-memory
// object struct. Offsets from Constants.java C64_*_OFFSET; the field
// names are the JSON mod fields the same data lands in at make time.
const FIDDLE_FIELDS = {
  7: 'x',           // C64_XPOS_OFFSET
  8: 'y',           // C64_YPOS_OFFSET
  9: 'orientation', // C64_ORIENT_OFFSET
  10: 'gr_state',   // C64_GR_STATE_OFFSET
  // 11 (C64_CONTAINED_OFFSET) is handled specially — container change
  // 15 (C64_TOKEN_DENOM_OFFSET) is handled specially — two-byte denom
  // 26 (C64_CUSTOMIZE_OFFSET) is handled specially — custom[] array
}
const FIDDLE_CONTAINED_OFFSET = 11
const FIDDLE_TOKEN_DENOM_OFFSET = 15
const FIDDLE_CUSTOMIZE_OFFSET = 26

module.exports = {
  MAIL_SLOT,
  HANDS,
  HEAD,
  THE_REGION,
  GHOST_NOID,
  ACTION_DO,
  ACTION_RDO,
  ACTION_GO,
  ACTION_STOP,
  ACTION_GET,
  ACTION_PUT,
  ACTION_TALK,
  ACTION_DESTROY,
  OPEN_BIT,
  UNLOCKED_BIT,
  SCREEN_WIDTH,
  FIDDLE_FIELDS,
  FIDDLE_CONTAINED_OFFSET,
  FIDDLE_TOKEN_DENOM_OFFSET,
  FIDDLE_CUSTOMIZE_OFFSET,
}
