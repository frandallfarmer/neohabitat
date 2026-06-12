/* jshint esversion: 8 */

'use strict'

// Port of Behaviors/avatar_put.m — PUT pointed at an avatar: hand the
// held item over (the "give" gesture).
//
// Non-self branch (pointed at another avatar):
//   lda in_hand_noid / if (zero) chainTo v_beep    — must hold something
//   doMyAction ACTION_GO / waitWhile animation_wait_bit
//   in-hand is Tokens → chainTo v_depends           — paying, not handing
//   chore AV_ACT_hand_out
//   sendMsg pointed_noid, MSG_HAND, 0
//   chore AV_ACT_hand_back
//   getResponse HAND_SUCCESS / if (!zero)
//     changeContainers 0, AVATAR_HAND, pointed_noid — into THEIR hands
//
// Self branch (pointed at myself): pocket the held item — wear it if
// it's a Head and my HEAD slot is free, else put it in a pocket slot.
// Not yet ported (the pocket-slot picker is a UI flow); explicit beep.

const { HANDS, ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

module.exports = async function avatar_put(ctx) {
  const recipient = ctx.pointed
  if (ctx.actor && recipient.noid === ctx.actor.noid) {
    return ctx.beep('unported:avatar_put-pocket-self')
  }

  const item = ctx.inHand
  if (!item) return ctx.beep('hands-empty')

  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  // Handing tokens means paying SOME amount — that's the tokens_rdo
  // flow (denomination selection), not a whole-wad HAND.
  if (item.type === 'Tokens') return ctx.depends()

  ctx.chore('hand_out')
  const reply = await ctx.send({ op: 'HAND', to: recipient.ref })
  ctx.chore('hand_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.changeContainers(item.noid, recipient.noid, 0, HANDS)
  return { ok: true }
}
