/* jshint esversion: 8 */

'use strict'

// Port of Behaviors/generic_goToAndDropAt.m — the default 'put' verb
// (65 classes reference it: ground, street, and most items as the
// "drop the held thing where I pointed" behavior).
//
//   lda in_hand_noid / if (zero) chainTo v_beep    — must hold something
//   cmp pointed_noid / if (equal) chainTo v_beep   — can't drop onto itself
//   doMyAction ACTION_GO                           — walk to the spot
//      (on ground/street GO is generic_goToCursor — walks to args x/y)
//   waitWhile animation_wait_bit
//   jsr v_face_cursor
//   chore AV_ACT_bend_over
//   lda #THE_REGION_NOID / rjsr v_putInto          — drop into the region
//   chore AV_ACT_bend_back

const { THE_REGION, ACTION_GO } = require('../constants')

module.exports = async function generic_goToAndDropAt(ctx) {
  const item = ctx.inHand
  if (!item) return ctx.beep('hands-empty')
  if (ctx.pointed && item.noid === ctx.pointed.noid) return ctx.beep('drop-onto-self')

  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  ctx.face()
  ctx.chore('bend_over')
  const x = ctx.args.x !== undefined ? ctx.args.x : (ctx.actor ? ctx.actor.mod.x : 80)
  const y = ctx.args.y !== undefined ? ctx.args.y : 144
  const result = await ctx.putInto(THE_REGION, x, y)
  ctx.chore('bend_back')
  return result
}
