/* jshint esversion: 8 */

'use strict'

// Held-item verbs with simple state — ports of:
//   Behaviors/bottle_rdo.m       (pour the held bottle onto something)
//   Behaviors/drugs_do.m         (take a dose)
//   Behaviors/drugs_TAKE.m       (host: someone took a dose)
//   Behaviors/windup_toy_do.m    (wind the held toy)
//   Behaviors/windup_toy_WIND.m  (host: someone wound it)
//   Behaviors/book_do.m          (read the held book, one page per call)
//   Behaviors/gun_do.m           (toggle the held gun's safety — local only)
//   Behaviors/tokens_rdo.m       (pay tokens to an avatar)

const { ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')
const { decodeRead } = require('./devices')

// bottle_rdo.m: DO something while holding the bottle → walk to the
// target (subject), and if the bottle is full, MSG_POUR empties it.
async function bottle_rdo(ctx) {
  const bottle = ctx.pointed // RDO target = the held bottle
  if (!ctx.inHand || ctx.inHand.noid !== bottle.noid) return ctx.beep('hands-empty')
  // ctx.subject is set by the depends chain; args.target is the direct-call path.
  const target = ctx.args.target !== undefined ? ctx.world.get(ctx.args.target) : ctx.subject
  if (target) {
    const spot = ctx.gotoCoords(target.noid)
    if (spot) {
      await ctx.walkTo(spot.x, spot.y)
      await ctx.waitWalkAnimation()
    }
  }
  if (!bottle.mod.filled) return ctx.beep('bottle-empty')
  ctx.chore('hand_out')
  const reply = await ctx.send({ op: 'POUR', to: bottle.ref })
  ctx.chore('hand_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  bottle.mod.filled = 0
  ctx.newImage(bottle.noid)
  return { ok: true }
}

// drugs_do.m: take a dose from the held drugs — MSG_TAKE (effects are
// asynchronous host messages), then decrement the local count, deleting
// the empties.
async function drugs_do(ctx) {
  const drugs = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== drugs.noid) return ctx.depends()
  const reply = await ctx.send({ op: 'TAKE', to: drugs.ref })
  // Drugs.java TAKE replies { TAKE_SUCCESS: 1 } — no err field.
  if (reply.TAKE_SUCCESS !== 1) return ctx.beep('server-denied')
  const count = (drugs.mod.count || 1) - 1
  if (count <= 0) ctx.world._deleteByNoid(drugs.noid)
  else drugs.mod.count = count
  return { ok: true }
}

// drugs_TAKE.m (host): another avatar took a dose — same local
// decrement on the announced object.
async function drugs_TAKE(ctx) {
  const drugs = ctx.pointed
  const count = (drugs.mod.count || 1) - 1
  if (count <= 0) ctx.world._deleteByNoid(drugs.noid)
  else drugs.mod.count = count
  return { ok: true }
}

// windup_toy_do.m: wind the held toy — MSG_WIND, bump windLevel
// (clamped at 4), show the wound image.
async function windup_toy_do(ctx) {
  const toy = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== toy.noid) return ctx.depends()
  await ctx.send({ op: 'WIND', to: toy.ref })
  toy.mod.wind_level = Math.min(4, (toy.mod.wind_level || 0) + 1)
  ctx.newImage(toy.noid, 'WOUND')
  return { ok: true }
}

// windup_toy_WIND.m (host): someone wound it.
function windup_toy_WIND(ctx) {
  const toy = ctx.pointed
  toy.mod.wind_level = Math.min(4, (toy.mod.wind_level || 0) + 1)
  ctx.world.emit('fieldChanged', toy, null)
  ctx.newImage(toy.noid, 'WOUND')
  return { ok: true }
}

// book_do.m: the C64 looped pages through the text UI until the reader
// quit. One page per call here: READ the next page (host replies with
// the new page number), balloon the text, remember where we are.
async function book_do(ctx) {
  const book = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== book.noid) return ctx.depends()
  if (ctx.readText) return ctx.readText(book.noid) // graphical: modal text display (paging)
  const page = ctx.args.page !== undefined ? ctx.args.page
    : (book.mod.current_page !== undefined ? book.mod.current_page + 1 : 1)
  const reply = await ctx.send({ op: 'READ', to: book.ref, page: page })
  if (!reply) return ctx.beep('server-denied')
  if (reply.nextpage !== undefined) book.mod.current_page = reply.nextpage
  else book.mod.current_page = page
  const text = decodeRead(reply)
  ctx.balloon(text)
  return { ok: true, text, page: book.mod.current_page }
}

// gun_do.m: toggle the held gun's safety. Purely local on the C64 —
// no host message at all, just the bit and a click.
async function gun_do(ctx) {
  const gun = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== gun.noid) return ctx.depends()
  const safetyOn = gun.mod.safety_on ? 0 : 1
  gun.mod.safety_on = safetyOn
  ctx.sound(safetyOn ? 'GUN_SAFETY_ON' : 'GUN_SAFETY_OFF', gun.noid)
  return { ok: true, safetyOn: !!safetyOn }
}

// tokens_rdo.m: pay tokens to an avatar — DO the recipient while
// holding the wad. Preconditions: subject is an avatar, we're adjacent,
// THEIR hands are empty. Amount comes from args (the C64 popped the
// denomination selector). PAYTO; the change and the recipient's new wad
// arrive asynchronously.
async function tokens_rdo(ctx) {
  const wad = ctx.pointed
  const recipient = ctx.subject
  if (!recipient || recipient.type !== 'Avatar') return ctx.beep('no-such-avatar')
  if (!ctx.isAdjacent(recipient.noid)) return ctx.beep('not-adjacent')
  if (ctx.world.holding(recipient.noid)) return ctx.beep('their-hands-full')
  const amount = ctx.args.amount
  if (!amount || amount <= 0) return ctx.beep('no-amount')

  ctx.chore('hand_out')
  const reply = await ctx.send({
    op: 'PAYTO',
    to: wad.ref,
    target_id: recipient.noid,
    amount_lo: amount & 0xff,
    amount_hi: (amount >> 8) & 0xff,
  })
  ctx.chore('hand_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  return { ok: true }
}

module.exports = {
  bottle_rdo,
  drugs_do,
  drugs_TAKE,
  windup_toy_do,
  windup_toy_WIND,
  book_do,
  gun_do,
  tokens_rdo,
}
