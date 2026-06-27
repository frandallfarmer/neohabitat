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

// HabitatMod.java compose_fiddle_msg
function host_FIDDLE(ctx) {
  const msg = ctx.args
  const world = ctx.world
  const o = world.get(msg.target)
  if (!o) return { ok: false, reason: 'no-target' }
  const values = Array.isArray(msg.value) ? msg.value : [msg.value]
  if (msg.offset === FIDDLE_TOKEN_DENOM_OFFSET) {
    o.mod.denom_lo = values[0] || 0
    o.mod.denom_hi = values[1] || 0
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
  if (target) {
    target.mod.orientation = (target.mod.orientation || 0) ^ 0x100
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