/* jshint esversion: 8 */

'use strict'

// Port of Behaviors/generic_throw.m — the reverse-DO of every
// throwable item (33 classes). Reached through the depends chain:
// the user DOes a distant spot on the ground while holding the item;
// ground's do is generic_depends, which re-dispatches RDO on the
// in-hand item with the original pointed object as `subject`.
//
// So in this ctx: pointed = the held item being thrown, subject = the
// ground/street surface aimed at, args x/y = the aim coordinates.
//
//   lda Im_sitting / if (!zero) chainTo v_beep     — can't throw seated
//   putArg THROW_Y / THROW_X (desired x/y)
//   lda subject_noid / putArg THROW_TARGET          — surface noid
//   chore AV_ACT_throw
//   sendMsg pointed_noid, MSG_THROW, 3
//   getResponse THROW_HIT / if (zero) chainTo v_beep
//   getResponse THROW_NEW_X / THROW_NEW_Y           — server's landing spot
//   changeContainers → THE_REGION at the landing spot
//   orientation &= 0xfe                             — clear the moving bit
//   chore AV_ACT_hand_back
//
// No walk: the C64 threw from wherever the avatar stood. The server
// (generic_THROW, HabitatMod.java:891) rejects x<8 / x>152 and targets
// that aren't ground surfaces.

const { THE_REGION } = require('../constants')
const { succeeded } = require('./kernel')

module.exports = async function generic_throw(ctx) {
  const item = ctx.pointed // the in-hand item (RDO target after depends)
  if (!item || !ctx.inHand || ctx.inHand.noid !== item.noid) {
    return ctx.beep('hands-empty')
  }
  // Surface noid: args.target for direct performVerb calls; ctx.subject
  // (the ground/street pointed at) for the depends-chain path.
  const surfaceNoid = ctx.args.target !== undefined
    ? ctx.args.target
    : (ctx.subject ? ctx.subject.noid : undefined)
  if (surfaceNoid === undefined) return ctx.beep('no-surface')

  const targetX = Math.max(8, Math.min(152, ctx.args.x !== undefined ? ctx.args.x : 80))
  const targetY = ctx.args.y !== undefined ? ctx.args.y : 144

  ctx.chore('throw')
  const reply = await ctx.send({
    op: 'THROW',
    to: item.ref,
    target: surfaceNoid,
    x: targetX,
    y: targetY,
  })
  if (!succeeded(reply)) return ctx.beep('server-denied')

  // Server reply carries the actual landing spot (THROW_NEW_X/Y).
  const landX = reply.x !== undefined ? reply.x : targetX
  const landY = reply.y !== undefined ? reply.y : targetY
  ctx.changeContainers(item.noid, THE_REGION, landX, landY)
  if (item.mod.orientation !== undefined) {
    item.mod.orientation = item.mod.orientation & ~1
  }
  ctx.chore('hand_back')
  return { ok: true }
}
