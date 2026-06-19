/* jshint esversion: 8 */

'use strict'

// Port of Behaviors/generic_adjacentOpenClose.m — the DO verb of doors
// and gates. One behavior, toggling: DO an open door closes it, DO a
// closed door opens it.
//
//   getProp in_hand, class == CHANGOMATIC → chainTo v_depends
//   doMyAction ACTION_GO / waitWhile animation_wait_bit
//   jsr v_punt_if_not_adjacent                 — depends if walk fell short
//   jsr v_face_cursor
//   have_key = in-hand Key with matching key_number_hi/lo
//   if door open:  MSG_CLOSE (hand_out/hand_back chores around it)
//     success → sound EXIT_CLOSING; flags close (and lock iff have_key);
//     newImage. failure → v_boing.
//   if closed: locked && !have_key → balloon "It's locked."
//     MSG_OPEN → success: sound EXIT_OPENING, flags = OPEN|UNLOCKED,
//     newImage. failure → v_beep.
//
// State is written locally on the success reply (the C64's putProp) —
// we may not receive our own OPEN$/CLOSE$ broadcast.

const { ACTION_GO, OPEN_BIT, UNLOCKED_BIT } = require('../constants')
const { setOpenFlags } = require('../openable')
const { succeeded } = require('./kernel')

module.exports = async function generic_adjacentOpenClose(ctx) {
  const door = ctx.pointed
  const inHand = ctx.inHand
  if (inHand && inHand.type === 'Changomatic') return ctx.depends()

  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  if (!ctx.isAdjacent()) return ctx.depends() // v_punt_if_not_adjacent
  ctx.face()

  const haveKey = !!(inHand && inHand.type === 'Key' &&
    inHand.mod.key_number_hi === door.mod.key_hi &&
    inHand.mod.key_number_lo === door.mod.key_lo)

  const flags = door.mod.open_flags || 0
  if (flags & OPEN_BIT) {
    // Open → close it.
    ctx.chore('hand_out')
    const reply = await ctx.send({ op: 'CLOSE', to: door.ref })
    ctx.chore('hand_back')
    if (!succeeded(reply)) return ctx.boing('server-denied')
    ctx.sound('EXIT_CLOSING', door.noid)
    setOpenFlags(door.mod, haveKey
      ? flags & ~(OPEN_BIT | UNLOCKED_BIT) // close AND lock
      : (flags & ~OPEN_BIT) | UNLOCKED_BIT) // close but don't lock
    ctx.world.emit('fieldChanged', door, null)
    ctx.newImage(door.noid)
    return { ok: true }
  }

  // Closed → open it.
  if (!(flags & UNLOCKED_BIT) && !haveKey) {
    ctx.balloon("It's locked.")
    return { ok: false, reason: 'locked' }
  }
  ctx.chore('hand_out')
  const reply = await ctx.send({ op: 'OPEN', to: door.ref })
  ctx.chore('hand_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.sound('EXIT_OPENING', door.noid)
  setOpenFlags(door.mod, OPEN_BIT | UNLOCKED_BIT)
  ctx.world.emit('fieldChanged', door, null)
  ctx.newImage(door.noid)
  return { ok: true }
}
