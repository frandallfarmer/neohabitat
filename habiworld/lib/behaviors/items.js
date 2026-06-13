/* jshint esversion: 8 */

'use strict'

// Item-specific verbs — ports of:
//   Behaviors/key_do.m       (read the key's number off it)
//   Behaviors/tokens_do.m    (split the token wad)
//   Behaviors/paper_do.m     (read page; editing/mailing is a text-UI flow)
//   Behaviors/head_do.m      (DO my worn head → DO myself)
//   Behaviors/head_talk.m    (talk through a worn head → avatar talk)
//   Behaviors/avatar_do.m    (TOUCH another avatar / DO the held item on self)
//   Behaviors/avatar_talk.m  (targeted talk; ESP loop is a text-UI flow)

const { ACTION_DO, ACTION_TALK } = require('../constants')
const { succeeded } = require('./kernel')

// key_do.m: purely local — holding the key shows its number in a
// balloon. No host message at all.
async function key_do(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.beep('not-holding')
  const hi = ctx.pointed.mod.key_number_hi || 0
  const lo = ctx.pointed.mod.key_number_lo || 0
  const number = hi * 256 + lo
  ctx.balloon(`Key number: ${number}`)
  return { ok: true, keyNumber: number }
}

// tokens_do.m: holding the wad, pick an amount (the C64 popped the
// denomination selector; a bot passes args.amount) and MSG_SPLIT it
// off. The split-off wad arrives asynchronously as a make.
async function tokens_do(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.beep('not-holding')
  const amount = ctx.args.amount
  if (!amount || amount <= 0) return ctx.beep('no-amount')
  ctx.chore('unpocket')
  const reply = await ctx.send({
    op: 'SPLIT',
    to: ctx.pointed.ref,
    amount_lo: amount & 0xff,
    amount_hi: (amount >> 8) & 0xff,
  })
  ctx.chore('stand')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  return { ok: true }
}

// paper_do.m, read-only portion: holding the paper enters text mode and
// READs page 0. The write-back (TRANSMIT_PAGE) and mail-on-exit flows
// need the text-handler client capability — bots edit paper through
// their own tools, so those branches aren't ported.
async function paper_do(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.depends()
  const reply = await ctx.send({ op: 'READ', to: ctx.pointed.ref, page: 0 })
  if (!reply) return ctx.beep('server-denied')
  const text = reply.text !== undefined
    ? (Array.isArray(reply.text) ? reply.text.join('\n') : reply.text)
    : ''
  ctx.balloon(text)
  return { ok: true, text: text }
}

// head_do.m: DO on the head I'm wearing redirects to DO on myself
// (pointing at my own face); a head anywhere else falls to depends.
async function head_do(ctx) {
  const head = ctx.pointed
  const me = ctx.actor
  if (me && head.containerRef === me.ref) {
    const avatar = ctx.world.getByRef(head.containerRef)
    if (avatar && ctx.world.holding(avatar.noid) !== head) {
      return ctx.doActionOn(ACTION_DO, avatar)
    }
    return ctx.beep('head-in-hand')
  }
  return ctx.depends()
}

// head_talk.m: talking at a head on MY body is avatar talk; otherwise
// the words just go to the room.
async function head_talk(ctx) {
  const head = ctx.pointed
  const me = ctx.actor
  if (me && head.containerRef === me.ref) {
    return ctx.doActionOn(ACTION_TALK, me)
  }
  if (!ctx.args.text) return ctx.beep('nothing-to-say')
  await ctx.send({ op: 'SPEAK', to: 'ME', esp: 0, text: ctx.args.text })
  return { ok: true }
}

// avatar_do.m: DO another avatar empty-handed = TOUCH them (must be
// adjacent — punt to depends otherwise, per v_punt_if_not_adjacent);
// DO them holding something = depends (use the item on them); DO
// myself holding something = DO the held item.
async function avatar_do(ctx) {
  const target = ctx.pointed
  const me = ctx.actor
  if (!me) return ctx.beep('not-in-region')

  if (target.noid !== me.noid) {
    if (ctx.inHand) return ctx.depends()
    if (!ctx.isAdjacent()) return ctx.depends()
    ctx.chore('hand_out')
    await ctx.send({ op: 'TOUCH', to: 'ME', target: target.noid })
    return { ok: true }
  }
  const held = ctx.inHand
  if (held) return ctx.doActionOn(ACTION_DO, held)
  return ctx.beep('nothing-to-do')
}

// avatar_talk.m: talk directed at an avatar. The host's ESP
// continuation loop is a text-input flow — plain targeted SPEAK only.
async function avatar_talk(ctx) {
  if (!ctx.args.text) return ctx.beep('nothing-to-say')
  await ctx.send({ op: 'SPEAK', to: 'ME', esp: 0, text: ctx.args.text })
  return { ok: true }
}

module.exports = {
  key_do,
  tokens_do,
  paper_do,
  head_do,
  head_talk,
  avatar_do,
  avatar_talk,
}
