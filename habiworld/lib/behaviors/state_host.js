/* jshint esversion: 8 */

'use strict'

// Inbound state host messages — region/meta ops and class behaviors that
// do not route through a simple noid→slot lookup.

const {
  THE_REGION,
  FIDDLE_FIELDS,
  FIDDLE_CONTAINED_OFFSET,
  FIDDLE_TOKEN_DENOM_OFFSET,
  FIDDLE_CUSTOMIZE_OFFSET,
} = require('../constants')

// Poster-derived classes (Sign, Short_sign) keep their text bytes at the
// same struct offset (15) that Tokens use for the 2-byte denomination —
// see host_FIDDLE. webclient/habirender/region.js renders the text from
// mod.ascii (falling back to mod.text).
const POSTER_TYPES = new Set(['Sign', 'Short_sign'])

// HabitatMod.java compose_fiddle_msg
function host_FIDDLE(ctx) {
  const msg = ctx.args
  const world = ctx.world
  const o = world.get(msg.target)
  if (!o) return { ok: false, reason: 'no-target' }
  const values = Array.isArray(msg.value) ? msg.value : [msg.value]
  if (msg.offset === FIDDLE_TOKEN_DENOM_OFFSET) {
    // C64 fiddle_with_object (actions.m) writes `count` raw bytes at the
    // struct offset and never branches on class — the field that lives at
    // the offset IS whatever that object's struct puts there. Byte 15 is
    // overloaded: Tokens hold a 2-byte denomination, but a Sign / Short_sign
    // (Poster) holds its text bytes (C64_TEXT_OFFSET == C64_TOKEN_DENOM_OFFSET
    // == 15). Reproduce that per class — e.g. the god tool's 't' command
    // FIDDLEs a sign's text at offset 15.
    if (POSTER_TYPES.has(o.type)) {
      const text = typeof msg.value === 'string'
        ? msg.value
        : values.map((c) => String.fromCharCode(c)).join('')
      o.mod.ascii = Array.from(text, (c) => c.charCodeAt(0))
      o.mod.text = text
    } else {
      o.mod.denom_lo = values[0] || 0
      o.mod.denom_hi = values[1] || 0
    }
  } else if (msg.offset === FIDDLE_CUSTOMIZE_OFFSET) {
    o.mod.custom = values
  } else if (msg.offset === FIDDLE_CONTAINED_OFFSET) {
    world._changeContainers(msg.target, values[0], o.mod.x, o.mod.y)
  } else if (FIDDLE_FIELDS[msg.offset]) {
    o.mod[FIDDLE_FIELDS[msg.offset]] = values[0]
  }
  world.emit('fieldChanged', o, msg.offset)
  return { ok: true }
}

function region_CHANGELIGHT(ctx) {
  const world = ctx.world
  world.region.lighting += ctx.args.adjustment || 0
  world.emit('lighting', world.region.lighting)
  return { ok: true }
}

function region_GOAWAY(ctx) {
  ctx.world._deleteByNoid(ctx.args.target)
  return { ok: true }
}

function region_CHANGE_CONTAINERS(ctx) {
  const msg = ctx.args
  ctx.world._changeContainers(msg.object_noid, msg.container_noid, msg.x, msg.y)
  return { ok: true }
}

// Behaviors/bottle_FILL.m
function bottle_FILL(ctx) {
  const o = ctx.pointed
  o.mod.filled = 1
  o.mod.gr_state = 1
  ctx.world.emit('fieldChanged', o, null)
  return { ok: true }
}

// Behaviors/bottle_POUR.m
function bottle_POUR(ctx) {
  const o = ctx.pointed
  o.mod.filled = 0
  o.mod.gr_state = 0
  ctx.world.emit('fieldChanged', o, null)
  return { ok: true }
}

// Behaviors/avatar_SITORGETUP.m / Avatar.java SITORSTAND
function avatar_SITORGETUP(ctx) {
  const msg = ctx.args
  const world = ctx.world
  const avatar = world.get(msg.noid)
  if (!avatar) return { ok: false, reason: 'no-avatar' }
  if (msg.up_or_down) {
    world._changeContainers(msg.noid, msg.cont, 0, msg.slot || 0)
    // avatar_SITORGETUP.m: chore sit_front|sit_chair from the seat's style bit. Persist the pose
    // so observers compose the seated avatar sitting (mod.activity drives the body composition).
    const seat = world.get(msg.cont)
    avatar.mod.activity = ((seat?.mod.style || 0) & 1) ? 133 /* AV_ACT_sit_chair */ : 157 /* AV_ACT_sit_front */
  } else {
    const seat = world.get(msg.cont)
    const x = seat ? seat.mod.x : (avatar.mod.x || 80)
    const y = seat ? (seat.mod.y | 0x80) : 144
    world._changeContainers(msg.noid, THE_REGION, x, y)
    avatar.mod.activity = 129 // AV_ACT_stand
  }
  world.emit('stateChanged', avatar)
  return { ok: true }
}

// changomatic_CHANGE.m — wire may cite a changomatic noid not yet in the observer's table.
function host_CHANGE(ctx) {
  const msg = ctx.args
  const target = ctx.world.get(msg.CHANGE_TARGET)
  if (target && msg.CHANGE_NEW_ORIENTATION !== undefined) {
    target.mod.orientation = msg.CHANGE_NEW_ORIENTATION
    ctx.world.emit('fieldChanged', target, null)
    ctx.newImage(target.noid)
  }
  const wand = ctx.world.get(msg.noid)
  if (wand) ctx.sound('CHANGOMATIC', wand.noid)
  return { ok: true }
}

// sex_changer_SEXCHANGE.m — same: machine noid is optional for state.
function host_SEXCHANGE(ctx) {
  const msg = ctx.args
  const target = ctx.world.get(msg.AVATAR_NOID)
  // sex_changer_SEXCHANGE.m: the announced avatar toggles its SEX_BIT (0x80 — the bit
  // colorsFromOrientation reads) and plays operate -> hand_back -> get_shot. Skip our OWN
  // avatar: sex_changer_do already toggled it optimistically, so re-applying the broadcast
  // here would cancel the change. (Was 0x100 — the wrong bit, so observers saw no change.)
  if (target && target.noid !== ctx.world.meNoid) {
    target.mod.orientation = (target.mod.orientation || 0) ^ 0x80
    ctx.chore('operate', target.noid)
    ctx.chore('hand_back', target.noid)
    ctx.chore('get_shot', target.noid)
    ctx.world.emit('fieldChanged', target, null)
  }
  const machine = ctx.world.get(msg.noid)
  if (machine) {
    ctx.sound('SEX_CHANGER', machine.noid)
    ctx.newImage(machine.noid)
  }
  return { ok: true }
}

module.exports = {
  host_FIDDLE,
  region_CHANGELIGHT,
  region_GOAWAY,
  region_CHANGE_CONTAINERS,
  host_CHANGE,
  host_SEXCHANGE,
  bottle_FILL,
  bottle_POUR,
  avatar_SITORGETUP,
}