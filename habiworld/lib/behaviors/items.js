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

const { ACTION_DO, ACTION_TALK, HANDS } = require('../constants')
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

// tokens_do.m: holding the wad, split an amount off it. The C64 popped the
// denomination selector — "Available: <wad value>, Choose amount: " (tokens_do.m:31-40,
// the # is the held wad's denomination) — via ctx.requestTextInput; bots pass args.amount.
// MSG_SPLIT it off; the split-off wad arrives asynchronously as a make.
async function tokens_do(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.beep('not-holding')
  let amount = ctx.args.amount
  if (amount == null && ctx.requestTextInput) {
    const denom = (ctx.pointed.mod.denom_hi || 0) * 256 + (ctx.pointed.mod.denom_lo || 0)
    const typed = await ctx.requestTextInput(`Available: ${denom}, Choose amount: `, { numeric: true })
    amount = parseInt(typed, 10)
  }
  if (!amount || amount <= 0) return ctx.beep('no-amount')
  ctx.chore('unpocket')                            // chore AV_ACT_unpocket
  const reply = await ctx.send({                   // sendMsg MSG_SPLIT
    op: 'SPLIT',
    to: ctx.pointed.ref,
    amount_lo: amount & 0xff,
    amount_hi: (amount >> 8) & 0xff,
  })
  ctx.chore('stand')                               // chore AV_ACT_stand
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
  // graphical: modal text display — paper is editable (WRITE / PSENDMAIL); books/docs aren't.
  if (ctx.readText) return ctx.readText(ctx.pointed.noid, { editable: true })
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

// game_piece.KING: neohabitat's DO for game pieces — toggles gr_state
// between CHECKER_PIECE (6) and CHECKER_KING (7). Replies { state: gr_state }
// via send_reply_msg (no err field). Broadcasts ROLL$ (same as a die roll).
async function game_piece_do(ctx) {
  const piece = ctx.pointed
  const reply = await ctx.send({ op: 'KING', to: piece.ref })
  if (!reply || reply.state === undefined) return ctx.beep('server-denied')
  piece.mod.gr_state = reply.state
  ctx.newImage(piece.noid)
  return { ok: true, state: reply.state }
}

// telekenesis_get: pick up a game piece without walking (the C64 bypassed
// the accessable() proximity check for CLASS_GAME_PIECE in generic_GET).
// Empty-handed only; GET on the piece; server replies send_reply_success.
async function telekenesis_get(ctx) {
  const piece = ctx.pointed
  if (ctx.inHand) return ctx.beep('hands-full')
  ctx.chore('hand_out')
  const reply = await ctx.send({ op: 'GET', to: piece.ref })
  ctx.chore('hand_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.changeContainers(piece.noid, ctx.actor.noid, 0, HANDS)
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

// avatar_PAID.m (host): PAYTO recipient gets a token wad; debit the payer.
function avatar_PAID(ctx) {
  const world = ctx.world
  const amount = (ctx.args.amount_lo || 0) + (ctx.args.amount_hi || 0) * 256
  const wad = world.holding(ctx.args.payer)
  if (wad && wad.type === 'Tokens' && amount) {
    const denom = (wad.mod.denom_hi || 0) * 256 + (wad.mod.denom_lo || 0)
    const left = Math.max(0, denom - amount)
    wad.mod.denom_lo = left & 0xff
    wad.mod.denom_hi = (left >> 8) & 0xff
  }
  if (ctx.args.object) world._makeObject(ctx.args.object, ctx.args.container || '', false)
  return { ok: true }
}

module.exports = {
  key_do,
  tokens_do,
  paper_do,
  head_do,
  head_talk,
  game_piece_do,
  telekenesis_get,
  avatar_do,
  avatar_talk,
  avatar_PAID,
}
