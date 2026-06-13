/* jshint esversion: 8 */

'use strict'

// Port of Behaviors/avatar_get.m — GET pointed at an avatar: grab
// whatever they're holding out of their hands.
//
// Non-self branch:
//   lda in_hand_noid / if (zero)                   — my hand must be empty
//   doMyAction ACTION_GO / waitWhile animation_wait_bit
//   chore AV_ACT_hand_out
//   sendMsg pointed_noid, MSG_GRAB, 0
//   chore AV_ACT_hand_back
//   getResponse GRAB_NOID / if (!zero)              — non-zero is success
//     changeContainers 0, AVATAR_HAND, actor_noid   — into MY hands
//
// Self branch (pointed at myself): pick an item out of my own pocket
// via the pocket-selection UI (v_pick_from_container). Not ported —
// bots address pocket items directly by noid; explicit beep.

const { HANDS, ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

module.exports = async function avatar_get(ctx) {
  const victim = ctx.pointed
  if (ctx.actor && victim.noid === ctx.actor.noid) {
    return ctx.beep('unported:avatar_get-pocket-self')
  }

  if (ctx.inHand) return ctx.beep('hands-full')
  const theirItem = ctx.world.holding(victim.noid)
  if (!theirItem) return ctx.beep('their-hands-empty')

  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  ctx.chore('hand_out')
  const reply = await ctx.send({ op: 'GRAB', to: victim.ref })
  ctx.chore('hand_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.changeContainers(theirItem.noid, ctx.actor.noid, 0, HANDS)
  return { ok: true }
}
