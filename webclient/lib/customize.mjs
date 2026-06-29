// Port of Main/custom.m — the new-Avatar "Hatchery" customization mode.
//
// A self-contained pre-game mode (like the title screen), NOT a world behavior.
// The host (bridge hatchery.go, itself a port of stratus/Processes/hatchery.pl1)
// drops a new user into a fake region whose object #1 is the Avatar and whose
// objects #4..#11 are the eight selectable heads, then waits for MESSAGE_customize
// (=4) carrying five appearance bytes. This module is the byte-faithful port of
// what the C64 client does between those two events.
//
// THE GAME CURSOR IS DEAD IN THIS MODE. custom.m parks it (cursor_x←200) and sets
// detach_from_stick←0xFF every frame (cursor.m freezes: no joystick move, no
// trigger) and custom_running←nonzero (keyboard.m skips the normal command path).
// All interaction is the keyboard: F1–F8 alter appearance, Space advances the
// instruction panels, Y/N confirm on the last panel, R randomizes. The view layer
// reproduces the freeze by suppressing pointer/pie-menu input while this mode runs.
//
// Field semantics (Main/dataequates.m, Main/custom.m):
//   avatar.orientation   bit 0x80 = sex (set = female), bits 0x38 = height
//   avatar.customize[0]  high nibble = leg color (F6), low nibble = torso color (F7)
//   avatar.customize[1]  high nibble = arm/sleeve color (F8)
//   head.orientation     = hair pattern (F5), written into the worn head
//   head.style           = the head style number sent to the host (set_hair)

// ── constants (custom.m / Main/dataequates.m) ──────────────────────────────
export const SEX_BIT = 0x80 // set = female (init_cust: head_number>=5 → ora 0x80)
export const HEIGHT_MASK = 0x38 // orientation bits that hold height
export const HEIGHT_STEP = 0x10 // F3 adds 16, masked into HEIGHT_MASK
export const HEIGHT_KEEP = 0x87 // bits preserved across a height change (sex + low 3)
export const FIRST_HEAD = 4 // heads are objects #4..#11 (av, wall, floor, head0)
export const NUM_HEADS = 8
export const FEMALE_HEAD_START = 5 // heads 0–4 male, 5–7 female

export const HAIR_STEP = 8
export const HAIR_MASK = 0x78
export const HAIR_WILD = 0x78 // skip the "wild card" value

export const COLOR_STEP = 16
export const NIBBLE_HI_WILD = 0xf0 // leg/sleeve: skip a 0xF_ high nibble
export const NIBBLE_LO_WILD = 0x0f // torso: skip a _0xF low nibble

// show_off walk-around demo targets (custom.m dest_x / dest_y).
export const DEST_X = [0x5a, 0x35, 0x7e, 0x11, 0x8f, 0x18, 0x92, 0x40]
export const DEST_Y = [0x8b, 0x84, 0x9b, 0x8c, 0x89, 0x81, 0x99, 0x86]

const LAST_PANEL = 6 // panel 6 → customize_done (display_a_panel)
const CONFIRM_PANEL = 4 // the "...the way you want me to be? (Y or N)" panel

const u8 = (n) => n & 0xff

// ── state ──────────────────────────────────────────────────────────────────
// `heads` is the eight head records from the make-storm ({ style, orientation }).
// We own a working copy of the mutable appearance; the view syncs it onto the
// live world records each render (avatar.mod.orientation/customize, worn head).
export function newCustomizeState({ heads = [], headNumber = 0 } = {}) {
  return {
    avatar: { orientation: 0, customize: [0, 0], headSlot: FIRST_HEAD + headNumber },
    heads: heads.map((h) => ({ style: u8(h.style || 0), orientation: u8(h.orientation || 0) })),
    headNumber,
    hairPattern: 0, // custom.m's persistent hair_pattern (host byte #2)
    walkAround: false,
    panel: 0,
    done: false,
  }
}

// set_hair (custom.m:213): write the persistent hair_pattern into the worn head
// and recover head_style from it. In our model the head record already carries
// its style number, so the C64 style_pointer→head_style_list lookup is a no-op.
function setHair(s) {
  const head = s.heads[s.headNumber]
  if (head) head.orientation = u8(s.hairPattern)
}

// ── F1–F8 + R (change_characteristics) ─────────────────────────────────────
export function changeSex(s) {
  s.avatar.orientation = u8(s.avatar.orientation ^ SEX_BIT)
  return s
}

export function selectHead(s) {
  s.headNumber = (s.headNumber + 1) & (NUM_HEADS - 1) // inc, and #7
  s.avatar.headSlot = FIRST_HEAD + s.headNumber
  setHair(s) // F2 falls into set_hair (new head takes the current hair pattern)
  return s
}

export function changeHeight(s) {
  const keep = s.avatar.orientation & HEIGHT_KEEP
  const stepped = u8(s.avatar.orientation + HEIGHT_STEP) & HEIGHT_MASK
  s.avatar.orientation = keep | stepped
  return s
}

export function toggleWalk(s) {
  s.walkAround = !s.walkAround
  return s
}

export function changeHair(s) {
  let h = s.hairPattern
  do { h = u8(h + HAIR_STEP) & HAIR_MASK } while (h === HAIR_WILD) // skip wild card
  s.hairPattern = h
  setHair(s)
  return s
}

export function changeLegs(s) {
  let c = s.avatar.customize[0]
  do { c = u8(c + COLOR_STEP) } while ((c & NIBBLE_HI_WILD) === NIBBLE_HI_WILD)
  s.avatar.customize[0] = c
  return s
}

export function changeTorso(s) {
  let c = s.avatar.customize[0]
  do { c = (u8(c + 1) & NIBBLE_LO_WILD) | (c & NIBBLE_HI_WILD) } // step low nibble, keep high
  while ((c & NIBBLE_LO_WILD) === NIBBLE_LO_WILD)
  s.avatar.customize[0] = c
  return s
}

export function changeSleeves(s) {
  let c = u8(s.avatar.customize[1]) & NIBBLE_HI_WILD // and #0xf0 drops the low nibble
  do { c = u8(c + COLOR_STEP) & NIBBLE_HI_WILD } while (c === NIBBLE_HI_WILD)
  s.avatar.customize[1] = c
  return s
}

// init_cust (custom.m:322): 256 random appearance changes (every F-key except F4
// walk), then force the sex bit to match the head (heads 0–4 male, 5–7 female).
// The C64's clock/raster PRNG isn't reproducible in a browser, so we take a RNG —
// behaviorally faithful (a random look), not bit-identical.
const RANDOM_OPS = [changeSex, selectHead, changeHeight, changeHair, changeLegs, changeTorso, changeSleeves]
export function randomizeAppearance(s, rng = Math.random) {
  for (let i = 0; i < 256; i++) {
    const v = (rng() * 8) & 7 // 0..7
    if (v === 3) continue // value 3 == function_key_4 (walk) — skipped
    RANDOM_OPS[v < 3 ? v : v - 1](s)
  }
  s.avatar.orientation &= 0x7f
  if (s.headNumber >= FEMALE_HEAD_START) s.avatar.orientation |= SEX_BIT
  return s
}

// ── instruction panels (display_panels) ────────────────────────────────────
// Space advances panels 0–3 and 5; panel 4 is the Y/N confirm (N steps back, Y
// forward); advancing past panel 5 reaches LAST_PANEL → done. F-keys still apply
// throughout (customize() runs change_characteristics every frame regardless).
export function advancePanel(s, key) {
  if (s.panel === CONFIRM_PANEL) {
    if (key === "Y") s.panel++
    else if (key === "N") s.panel--
  } else if (key === "SPACE") {
    s.panel++
  }
  if (s.panel >= LAST_PANEL) { s.panel = LAST_PANEL; s.done = true }
  return s
}

// ── one keystroke (customize(): display_panels then change_characteristics) ──
const KEYS = {
  F1: changeSex, F2: selectHead, F3: changeHeight, F4: toggleWalk,
  F5: changeHair, F6: changeLegs, F7: changeTorso, F8: changeSleeves,
}
export function handleKey(s, key, rng = Math.random) {
  advancePanel(s, key)
  if (key === "R") return randomizeAppearance(s, rng)
  const fn = KEYS[key]
  if (fn) fn(s)
  return s
}

// The five bytes sent to the host as MESSAGE_customize (=4): head_style,
// hair_pattern, av_orient, custom1 (legs/torso), custom2 (sleeves).
// Matches bridge parseHatcheryAppearance(args[0..4]).
export function customizePayload(s) {
  const head = s.heads[s.headNumber] || { style: 0 }
  return [u8(head.style), u8(s.hairPattern), u8(s.avatar.orientation),
    u8(s.avatar.customize[0]), u8(s.avatar.customize[1])]
}

// Projection of the working state onto the renderer's avatar fields: the worn
// Avatar record reads mod.orientation + mod.custom (2 bytes, region.js
// limbPatternsFromMod), and its contained class_head reads mod.style (image) +
// mod.orientation (hair, colorsFromOrientation). The view writes these and
// refreshes; this keeps customize.mjs free of any world/renderer dependency.
export function avatarFields(s) {
  return {
    orientation: u8(s.avatar.orientation),
    custom: [u8(s.avatar.customize[0]), u8(s.avatar.customize[1])],
    headStyle: u8((s.heads[s.headNumber] || {}).style || 0),
    hairPattern: u8(s.hairPattern),
  }
}

// Balloon colors. custom.m draws the panels through draw_balloon, which TRANSLATES
// the logical color via colors_8 (balloons.m) before display; one_black_line uses
// draw_balloon_2 (untranslated). Duplicating the resulting VIC indices, not naming
// them: text red(0x02)→colors_8[2]=yellow(0x07); prompt green(0x05)→colors_8[5]=0x04;
// the black separator stays 0x00 (untranslated → invisible on the black panel, so it
// reads as a blank spacer row, exactly as one_black_line draws press_return in black).
export const BALLOON_TEXT = 0x07
export const BALLOON_PROMPT = 0x04
export const BALLOON_SEP = 0x00

// One balloon "line": { text, color (VIC index) }. The instruction text is verbatim
// from custom.m (intro_0…intro_5d, press_return). Space advances panels 0–3 and 5;
// panel 4 (confirm) takes Y/N. SEP is a one_black_line spacer (invisible black row);
// PROMPT is the green "Press space bar" (instructs).
const txt = (text) => ({ text, color: BALLOON_TEXT })
const SEP = { text: "Press space bar", color: BALLOON_SEP }
const PROMPT = { text: "Press space bar", color: BALLOON_PROMPT }

export const PANELS = [
  { entries: [ // panel_0
    SEP,
    txt("Welcome to Lucasfilm's Habitat! You are about to enter an exciting new world of fun and adventure!"),
    txt("In Habitat, you will be represented by me, your Avatar."),
    PROMPT,
  ], confirm: false },
  { entries: [ // panel_1
    SEP,
    txt("Before you begin your adventures, you get to customize my appearance."),
    txt("You can select my sex, height, head style, and hair and body colors."),
    SEP, PROMPT,
  ], confirm: false },
  { entries: [ // panel_2
    txt("In a moment, you will use the function keys to alter my appearance until it suits you."),
    txt("You will then be prepared to enter the world of Habitat."),
    SEP, PROMPT,
  ], confirm: false },
  { entries: [ // panel_3 — the F-key legend; intro_3e is the green prompt line
    SEP,
    txt("F1 changes my sex, F2 changes my head"),
    txt("F3 changes height, F4 walks me around"),
    txt("F5 changes hair, F6 changes leg color"),
    txt("F7 changes my torso, F8 changes arms"),
    SEP,
    { text: "When finished, press the space bar.", color: BALLOON_PROMPT },
  ], confirm: false },
  { entries: [ // panel_4 — Y/N confirm; five black lines push intro_4 down
    SEP, SEP, SEP, SEP, SEP,
    txt("Am I now customized the way you want me to be? (Type Y or N)"),
  ], confirm: true },
  { entries: [ // panel_5
    txt("OK!  Here we go!"),
    txt("I will first appear inside our Turf."),
    txt("This is our home within the Habitat."),
    txt("Practice with the controls a bit, then head out into the world. Explore! Meet people!  Above all, have fun!"),
    PROMPT,
  ], confirm: false },
]
