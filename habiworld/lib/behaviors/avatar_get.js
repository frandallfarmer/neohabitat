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
// Self branch (pointed at myself, label its_me): pull an item out of my
// OWN pocket. The C64 popped a pocket-selection UI (v_pick_from_container)
// to choose which item; a bot names it directly via args.item. Then:
//   chore AV_ACT_unpocket
//   sendMsg pointed_noid, MSG_GET, 0   — GET the ITEM (not REMOVE!)
//   getResponse GET_SUCCESS → changeContainers 0, AVATAR_HAND, actor_noid
// Sending GET (vs head_get's REMOVE) is exactly why this path can unpocket
// a head: the server's GET → head_WEAR → generic_GET when cont.noid ==
// avatar.noid. The "pocket" is the avatar, so retrieving ANYTHING from it
// — heads included — is an avatar_get, not a head_get.

const { HANDS, HEAD, ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

module.exports = async function avatar_get(ctx) {
  const victim = ctx.pointed
  const me = ctx.actor

  // ── Self: unpocket the named item (avatar_get its_me). ─────────────
  if (me && victim.noid === me.noid) {
    if (ctx.inHand) return ctx.beep('hands-full') // must be empty-handed
    const item = ctx.args.item != null ? ctx.world.get(ctx.args.item) : null
    if (!item) return ctx.beep('no-such-pocket-item')
    // Must actually be in MY pocket: contained by me, and not the item
    // already in my hands (a worn head is doffed via head_get, not here).
    if (item.containerRef !== me.ref || item.mod.y === HANDS || item.mod.y === HEAD) {
      return ctx.beep('not-in-my-pocket')
    }
    ctx.chore('unpocket')
    const reply = await ctx.send({ op: 'GET', to: item.ref })
    if (!succeeded(reply)) return ctx.beep('server-denied')
    ctx.changeContainers(item.noid, me.noid, 0, HANDS)
    ctx.chore('stand')
    return { ok: true }
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
