/* jshint esversion: 8 */

'use strict'

// Behaviors/avatar_OPEN.m and avatar_CLOSE.m — inbound host messages when a
// neighbor opens/closes a door or gate. Wire: { noid: actor, target: door_noid }.

const { OPEN_BIT, UNLOCKED_BIT } = require('../constants')
const { setOpenFlags } = require('../openable')

const skipInboundSound = (world, msg) =>
  !!(world.me && msg.noid != null && msg.noid === world.me.noid)

// avatar_OPEN.m — hand_out, EXIT_OPENING on door, flags OPEN|UNLOCKED, hand_back
function avatar_OPEN(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const door = world.get(msg.target)
  if (!door) return { ok: false, reason: 'no-door' }
  ctx.chore('hand_out')
  setOpenFlags(door.mod, OPEN_BIT | UNLOCKED_BIT)
  world.emit('fieldChanged', door, null)
  if (!skipInboundSound(world, msg)) {
    ctx.sound('EXIT_OPENING', msg.target)
  }
  ctx.newImage(msg.target)
  ctx.chore('hand_back')
  return { ok: true }
}

// avatar_CLOSE.m — hand_out, CLOSE_FLAGS on door, EXIT_CLOSING, hand_back
function avatar_CLOSE(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const door = world.get(msg.target)
  if (!door) return { ok: false, reason: 'no-door' }
  ctx.chore('hand_out')
  setOpenFlags(door.mod, msg.open_flags || 0)
  world.emit('fieldChanged', door, null)
  if (!skipInboundSound(world, msg)) {
    ctx.sound('EXIT_CLOSING', msg.target)
  }
  ctx.newImage(msg.target)
  ctx.chore('hand_back')
  return { ok: true }
}

module.exports = { avatar_OPEN, avatar_CLOSE }