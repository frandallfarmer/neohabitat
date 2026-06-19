/* jshint esversion: 8 */

'use strict'

// Behaviors/avatar_OPENCONTAINER.m and avatar_CLOSECONTAINER.m — inbound host
// messages when a neighbor (or broadcast) opens/closes a container. State
// matches deltas.js (formerly the only port); presentation via ctx.sound.
// Chore stays in the renderer (web client avatar-chore onOp) — the C64 runs
// bend_over/bend_back on the acting avatar here too, but we omit ctx.chore on
// inbound to avoid double-playing alongside avatar-chore.

const { OPEN_BIT, UNLOCKED_BIT } = require('../constants')
const { setOpenFlags } = require('../openable')

const skipInboundSound = (world, msg) =>
  !!(world.me && msg.noid != null && msg.noid === world.me.noid)

// avatar_OPENCONTAINER.m — OPENCONTAINER$ wire: { noid: actor, cont }
function avatar_OPENCONTAINER(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const cont = world.get(msg.cont)
  if (!cont) return { ok: false, reason: 'no-container' }
  setOpenFlags(cont.mod, OPEN_BIT | UNLOCKED_BIT)
  world.emit('fieldChanged', cont, null)
  if (!skipInboundSound(world, msg)) {
    ctx.sound('CONTAINER_OPENING', msg.cont)
  }
  ctx.newImage(msg.cont)
  return { ok: true }
}

// avatar_CLOSECONTAINER.m — CLOSECONTAINER$ wire: { noid: actor, cont, open_flags }
function avatar_CLOSECONTAINER(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const cont = world.get(msg.cont)
  if (!cont) return { ok: false, reason: 'no-container' }
  setOpenFlags(cont.mod, msg.open_flags || 0)
  world.emit('fieldChanged', cont, null)
  world.contentsOf(msg.cont).forEach((item) => world._deleteByNoid(item.noid))
  if (!skipInboundSound(world, msg)) {
    ctx.sound('CONTAINER_CLOSING', msg.cont)
  }
  ctx.newImage(msg.cont)
  return { ok: true }
}

module.exports = { avatar_OPENCONTAINER, avatar_CLOSECONTAINER }