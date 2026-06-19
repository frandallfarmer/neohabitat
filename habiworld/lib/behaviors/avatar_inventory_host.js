/* jshint esversion: 8 */

'use strict'

// Behaviors/avatar_GET_uppercase.m, avatar_PUT_uppercase.m, avatar_GRABFROM.m,
// avatar_THROW.m, avatar_WEAR.m, avatar_REMOVE.m — inbound host messages when a
// neighbor (or broadcast) picks up, drops, grabs, throws, or dons/doffs items.
// State matches the former deltas.js handlers; presentation via ctx.chore / ctx.sound.

const { HANDS, HEAD, THE_REGION } = require('../constants')

const skipInboundSound = (world, msg) =>
  !!(world.me && msg.noid != null && msg.noid === world.me.noid)

// avatar_GET_uppercase.m — GET$ wire: { noid: actor, target, how }
// how 0: bend_over → changeContainers → bend_back; 1: unpocket → stand; 2: stand only
function avatar_GETM(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const how = msg.how || 0
  if (how === 0) ctx.chore('bend_over')
  else if (how === 1) ctx.chore('unpocket')
  world._changeContainers(msg.target, msg.noid, 0, HANDS)
  if (how === 0) ctx.chore('bend_back')
  else ctx.chore('stand')
  return { ok: true }
}

// avatar_PUT_uppercase.m — PUT$ wire: { noid, obj, cont, x, y, how, orient }
function avatar_PUTM(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const how = msg.how || 0
  const item = world.get(msg.obj)
  if (!item) return { ok: false, reason: 'no-item' }
  if (how === 0) ctx.chore('bend_over')
  else ctx.chore('unpocket')
  if (msg.orient !== undefined) item.mod.orientation = msg.orient
  world._changeContainers(msg.obj, msg.cont, msg.x, msg.y)
  if (how === 0) ctx.chore('bend_back')
  else ctx.chore('stand')
  return { ok: true }
}

// avatar_GRABFROM.m — GRABFROM$ wire: { noid: actor, avatar_noid: victim }
function avatar_GRABFROM(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const item = world.holding(msg.avatar_noid)
  if (!item) return { ok: false, reason: 'nothing-to-grab' }
  ctx.chore('hand_out')
  world._changeContainers(item.noid, msg.noid, 0, HANDS)
  ctx.chore('hand_back')
  return { ok: true }
}

// avatar_THROW.m — THROW$ wire: { noid: actor, obj, x, y, hit }
function avatar_THROW(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const item = world.get(msg.obj)
  if (!item) return { ok: false, reason: 'no-item' }
  ctx.chore('throw')
  if (item.mod.orientation !== undefined) {
    item.mod.orientation = item.mod.orientation & ~1
  }
  world._changeContainers(msg.obj, THE_REGION, msg.x, msg.y)
  ctx.chore('hand_back')
  return { ok: true }
}

// avatar_WEAR.m — WEAR$ wire: { noid: actor }
function avatar_WEAR(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const item = world.holding(msg.noid)
  if (!item) return { ok: false, reason: 'hands-empty' }
  if (!skipInboundSound(world, msg)) {
    ctx.sound('CLOTHES_DONNED', msg.noid)
  }
  ctx.chore('stand')
  ctx.newImage(item.noid, 0)
  world._changeContainers(item.noid, msg.noid, 0, HEAD)
  return { ok: true }
}

// avatar_REMOVE.m — REMOVE$ wire: { noid: actor, target: head_item_noid }
function avatar_REMOVE(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const item = world.get(msg.target)
  if (!item) return { ok: false, reason: 'no-head' }
  if (!skipInboundSound(world, msg)) {
    ctx.sound('CLOTHES_DOFFED', msg.noid)
  }
  ctx.chore('stand')
  ctx.newImage(item.noid, 'HEAD_OFF')
  world._changeContainers(msg.target, msg.noid, 0, HANDS)
  return { ok: true }
}

module.exports = {
  avatar_GETM,
  avatar_PUTM,
  avatar_GRABFROM,
  avatar_THROW,
  avatar_WEAR,
  avatar_REMOVE,
}