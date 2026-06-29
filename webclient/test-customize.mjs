// Node tests: custom.m appearance + panel state machine (Main/custom.m).
import {
  newCustomizeState,
  changeSex, selectHead, changeHeight, toggleWalk,
  changeHair, changeLegs, changeTorso, changeSleeves,
  randomizeAppearance, advancePanel, handleKey, customizePayload,
  avatarFields, PANELS, BALLOON_TEXT, BALLOON_PROMPT, BALLOON_SEP, SEX_BIT, FIRST_HEAD,
} from "./lib/customize.mjs"

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const heads8 = () => Array.from({ length: 8 }, (_, i) => ({ style: i + 1, orientation: 0 }))
const fresh = () => newCustomizeState({ heads: heads8() })

// F1: sex bit toggles (custom.m:121 eor #0x80)
{
  const s = fresh()
  changeSex(s); assert(s.avatar.orientation === SEX_BIT, "F1 sets sex bit")
  changeSex(s); assert(s.avatar.orientation === 0, "F1 toggles sex bit back")
}

// F3: height steps through 0x10,0x20,0x30,0x00 within HEIGHT_MASK, preserving sex (custom.m:156)
{
  const s = fresh()
  const seen = [changeHeight(s).avatar.orientation, changeHeight(s).avatar.orientation,
    changeHeight(s).avatar.orientation, changeHeight(s).avatar.orientation]
  assert(JSON.stringify(seen) === JSON.stringify([0x10, 0x20, 0x30, 0x00]), `height cycle ${seen}`)
  s.avatar.orientation = SEX_BIT // female
  changeHeight(s)
  assert(s.avatar.orientation === (SEX_BIT | 0x10), "height preserves sex bit")
}

// F2: head cycles 0..7 and wraps; worn slot follows; new head takes the hair pattern (set_hair)
{
  const s = fresh()
  s.hairPattern = 0x18
  selectHead(s)
  assert(s.headNumber === 1 && s.avatar.headSlot === FIRST_HEAD + 1, "F2 advances head + slot")
  assert(s.heads[1].orientation === 0x18, "F2 set_hair writes hair into worn head")
  for (let i = 0; i < 7; i++) selectHead(s)
  assert(s.headNumber === 0, "F2 wraps 7→0")
}

// F5: hair steps by 8 within 0x78, skipping the 0x78 wild card (custom.m:203)
{
  const s = fresh()
  let prev = -1
  for (let i = 0; i < 16; i++) { changeHair(s); assert(s.hairPattern !== 0x78, "hair never lands on wild 0x78"); prev = s.hairPattern }
  // 0x70 + 8 → 0x78 (wild) → 0x00
  const s2 = fresh(); s2.hairPattern = 0x70; changeHair(s2)
  assert(s2.hairPattern === 0x00, `hair 0x70 skips wild → 0x00, got ${s2.hairPattern}`)
  assert(s2.heads[0].orientation === 0x00, "F5 set_hair updates worn head")
}

// F6: legs are the high nibble of customize[0], skipping 0xF_ (custom.m:231)
{
  const s = fresh()
  changeLegs(s); assert(s.avatar.customize[0] === 0x10, "F6 first step 0x10")
  s.avatar.customize[0] = 0xe0; changeLegs(s)
  assert(s.avatar.customize[0] === 0x00, "F6 0xE0 skips 0xF0 → 0x00")
}

// F7: torso is the low nibble of customize[0], preserving the leg nibble, skipping 0x_F (custom.m:244)
{
  const s = fresh()
  s.avatar.customize[0] = 0x30 // leg=3, torso=0
  changeTorso(s); assert(s.avatar.customize[0] === 0x31, "F7 steps low nibble, keeps leg")
  s.avatar.customize[0] = 0x3e; changeTorso(s)
  assert(s.avatar.customize[0] === 0x30, "F7 0x3E skips 0x3F → 0x30 (keeps leg)")
}

// F8: sleeves are the high nibble of customize[1]; the low nibble is dropped, skip 0xF0 (custom.m:262)
{
  const s = fresh()
  s.avatar.customize[1] = 0x05; changeSleeves(s)
  assert(s.avatar.customize[1] === 0x10, "F8 drops low nibble, first step 0x10")
  s.avatar.customize[1] = 0xe0; changeSleeves(s)
  assert(s.avatar.customize[1] === 0x00, "F8 0xE0 skips 0xF0 → 0x00")
}

// F4: walk toggle
{
  const s = fresh()
  toggleWalk(s); assert(s.walkAround === true, "F4 enables walk")
  toggleWalk(s); assert(s.walkAround === false, "F4 disables walk")
}

// R / init_cust: sex bit ends matching the head (heads 0–4 male, 5–7 female) (custom.m:343)
{
  // deterministic rng that drives head_number to a known parity by ending on selectHead picks.
  let n = 0
  const rng = () => { n = (n + 1) % 8; return n / 8 }
  const s = fresh()
  randomizeAppearance(s, rng)
  const female = (s.avatar.orientation & SEX_BIT) !== 0
  assert(female === (s.headNumber >= 5), `init_cust sex matches head (head ${s.headNumber}, female ${female})`)
}

// Panels: Space walks 0→3, panel 4 is Y/N, Y→5, Space→6 done; N steps back (custom.m:374)
{
  const s = fresh()
  for (const expect of [1, 2, 3, 4]) { advancePanel(s, "SPACE"); assert(s.panel === expect, `space → panel ${expect}, got ${s.panel}`) }
  advancePanel(s, "SPACE"); assert(s.panel === 4, "space inert on confirm panel")
  advancePanel(s, "N"); assert(s.panel === 3, "N steps back from confirm")
  advancePanel(s, "SPACE"); advancePanel(s, "Y"); assert(s.panel === 5, "Y advances past confirm")
  advancePanel(s, "SPACE"); assert(s.panel === 6 && s.done, "space past 5 → done")
}

// handleKey wires panels + appearance together: a panel key doesn't customize; an F-key doesn't advance
{
  const s = fresh()
  handleKey(s, "SPACE"); assert(s.panel === 1 && s.avatar.orientation === 0, "SPACE only advances panel")
  handleKey(s, "F1"); assert(s.panel === 1 && s.avatar.orientation === SEX_BIT, "F1 only customizes")
}

// payload: the five host bytes (bridge parseHatcheryAppearance order)
{
  const s = fresh()
  s.headNumber = 2; s.avatar.headSlot = FIRST_HEAD + 2
  s.hairPattern = 0x18; s.avatar.orientation = 0x90; s.avatar.customize = [0x34, 0x20]
  const p = customizePayload(s)
  assert(JSON.stringify(p) === JSON.stringify([3, 0x18, 0x90, 0x34, 0x20]), `payload ${p}`)
}

// avatarFields: projection onto the renderer's avatar/head fields
{
  const s = fresh()
  s.headNumber = 3; s.avatar.headSlot = FIRST_HEAD + 3
  s.hairPattern = 0x10; s.avatar.orientation = 0x88; s.avatar.customize = [0x21, 0x30]
  const f = avatarFields(s)
  assert(f.orientation === 0x88, "fields orientation")
  assert(JSON.stringify(f.custom) === JSON.stringify([0x21, 0x30]), "fields custom bytes")
  assert(f.headStyle === heads8()[3].style && f.hairPattern === 0x10, "fields head style + hair")
}

// PANELS: six instruction panels; the fourth is the Y/N confirm; panel 3 lists all eight F-keys
{
  assert(PANELS.length === 6, "six instruction panels (custom.m panel_0..5)")
  assert(PANELS[4].confirm === true && PANELS.filter((p) => p.confirm).length === 1, "only panel 4 confirms")
  const legend = PANELS[3].entries.map((e) => e.text).join(" ")
  for (const fk of ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"]) assert(legend.includes(fk), `legend names ${fk}`)
}

// Balloon colors duplicate the C64 colors_8-translated VIC values (balloons.m / custom.m):
// text yellow 0x07, prompt 0x04, black separators 0x00 (invisible spacer rows).
{
  assert(BALLOON_TEXT === 0x07 && BALLOON_PROMPT === 0x04 && BALLOON_SEP === 0x00, "C64 balloon color values")
  // panel_0: a black spacer, two yellow text lines, then the prompt color.
  const colors = PANELS[0].entries.map((e) => e.color)
  assert(colors[0] === BALLOON_SEP, "panel_0 opens with a black spacer (one_black_line)")
  assert(colors[1] === BALLOON_TEXT && colors[2] === BALLOON_TEXT, "panel_0 text is yellow")
  assert(colors[colors.length - 1] === BALLOON_PROMPT, "panel_0 ends with the prompt color")
  // panel_4 has five black spacers before the confirm text (custom.m: five one_black_line).
  assert(PANELS[4].entries.filter((e) => e.color === BALLOON_SEP).length === 5, "panel_4 has five spacers")
}

console.log("test-customize: ok")
