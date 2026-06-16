/* jshint esversion: 8 */

'use strict'

// Port of Behaviors/avatar_put.m — PUT pointed at an avatar.
//
// Non-self branch (pointed at another avatar): hand the held item over.
//   lda in_hand_noid / if (zero) chainTo v_beep    — must hold something
//   doMyAction ACTION_GO / waitWhile animation_wait_bit
//   in-hand is Tokens → chainTo v_depends           — paying, not handing
//   chore AV_ACT_hand_out / sendMsg MSG_HAND / hand_back
//   getResponse HAND_SUCCESS → changeContainers into THEIR hands
//
// Self branch (pointed at myself, label its_me): pocket the held item.
//   A Head with the HEAD slot free is worn (MSG_WEAR); everything else —
//   Tokens included — drops into a pocket via v_putInto(me_noid). The
//   server's generic_PUT into CLASS_AVATAR (HabitatMod.java:618) finds the
//   first empty slot and, for Tokens, merges the denomination with any wad
//   already pocketed.

const { HANDS, HEAD, ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

module.exports = async function avatar_put(ctx) {
  const me = ctx.actor
  const recipient = ctx.pointed

  // Both branches need something in hand (avatar_put.m: beep if empty).
  const item = ctx.inHand
  if (!item) return ctx.beep('hands-empty')

  // ── Self: pocket OR explicit-coords drop. ───────────────────────────
  if (me && recipient.noid === me.noid) {
    // putObj path: explicit containerNoid means "drop into this container
    // at (x, y)" rather than pocketing into the avatar.
    const { containerNoid, x, y, orientation } = ctx.args
    if (containerNoid !== undefined) {
      ctx.chore('bend_over')
      const result = await ctx.putInto(containerNoid, x || 0, y || 0, orientation)
      ctx.chore('bend_back')
      return result
    }

    // A Head + free HEAD slot → wear it; else fall through to the pocket.
    const headWorn = ctx.world.inventory(me.noid).some((o) => o.mod.y === HEAD)
    if (item.type === 'Head' && !headWorn) {
      ctx.chore('unpocket')
      const reply = await ctx.send({ op: 'WEAR', to: item.ref })
      if (succeeded(reply)) {
        ctx.sound('CLOTHES_DONNED', me.noid)
        ctx.changeContainers(item.noid, me.noid, 0, HEAD)
        return { ok: true }
      }
      // WEAR refused — pocket it instead.
    }
    ctx.chore('unpocket')
    // PUT into our own avatar; the server assigns the pocket slot (and
    // merges Tokens). ctx.putInto applies reply.pos to the world model.
    return ctx.putInto(me.noid, 0, 0)
  }

  // ── Other avatar: hand it over. ────────────────────────────────────
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
