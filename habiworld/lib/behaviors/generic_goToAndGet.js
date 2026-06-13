/* jshint esversion: 8 */

'use strict'

// Port of Behaviors/generic_goToAndGet.m — the default 'get' verb for
// every portable item class (40 classes reference it).
//
//   lda in_hand_noid / if (!zero) chainTo v_beep   — hand must be empty
//   doMyAction ACTION_GO                           — walk to the object
//   waitWhile animation_wait_bit                   — wait out the walk
//   chore AV_ACT_bend_over
//   sendMsg pointed_noid, MSG_GET, 0
//   getResponse GET_SUCCESS / if (!zero)           — non-zero is success
//     changeContainers 0, AVATAR_HAND, actor_noid  — item lands in HANDS
//   chore AV_ACT_bend_back

const { HANDS, ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

module.exports = async function generic_goToAndGet(ctx) {
  if (ctx.inHand) return ctx.beep('hands-full')
  const item = ctx.pointed

  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason) // doMyAction's go_success check
  await ctx.waitWalkAnimation()

  ctx.chore('bend_over')
  const reply = await ctx.send({ op: 'GET', to: item.ref })
  if (!succeeded(reply)) {
    ctx.chore('bend_back')
    return ctx.beep('server-denied')
  }
  ctx.changeContainers(item.noid, ctx.actor.noid, 0, HANDS)
  ctx.chore('bend_back')
  return { ok: true }
}
