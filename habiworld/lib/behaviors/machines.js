/* jshint esversion: 8 */

'use strict'

// Coin-op machines and the bigger contraptions — ports of:
//   Behaviors/generic_coinOp.m       (DO of coke/fortune/jukebox/parking/teleport)
//   Behaviors/generic_PAY.m          (host: someone paid — debit them)
//   Behaviors/vendo_do.m / vendo_SELECT.m / vendo_SELL.m
//   Behaviors/teleport_PAY.m
//   Behaviors/magic_lamp_do.m / magic_lamp_RUB.m
//   Behaviors/sex_changer_do.m / sex_changer_SEXCHANGE.m
//   Behaviors/escape_device_do.m
//   Behaviors/grenade_do.m
//   Behaviors/fake_gun_do.m
//   Behaviors/instant_object_TRANSFORM.m
//   Behaviors/hand_of_god_BLAST.m
//
// The C64's v_spend debited the local token wad after a purchase; our
// world model tracks token denominations in mod.denom_lo/hi, so spend
// adjusts those (the server is authoritative and corrects via FIDDLE).

const { ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

// v_spend: debit my held/pocketed tokens by `price`.
function spend(ctx, price) {
  if (!ctx.actor || !price) return
  const wad = ctx.world.inventory(ctx.actor.noid).find((o) => o.type === 'Tokens')
  if (!wad) return
  const denom = (wad.mod.denom_hi || 0) * 256 + (wad.mod.denom_lo || 0)
  const left = Math.max(0, denom - price)
  wad.mod.denom_lo = left & 0xff
  wad.mod.denom_hi = (left >> 8) & 0xff
}

// generic_coinOp.m: walk to the machine and feed it the held tokens —
// MSG_PAY with no parameters (the machine knows its price). The reply
// carries success and the price actually charged.
async function generic_coinOp(ctx) {
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  const inHand = ctx.inHand
  if (!inHand) return ctx.beep('hands-empty')
  if (inHand.type !== 'Tokens') return ctx.beep('not-tokens')

  ctx.chore('operate')
  ctx.sound('COIN_DEPOSITED', ctx.pointed.noid)
  const reply = await ctx.send({ op: 'PAY', to: ctx.pointed.ref })
  ctx.chore('hand_back')
  if (!succeeded(reply)) {
    ctx.sound('COIN_REJECTED', ctx.pointed.noid)
    return ctx.beep('payment-rejected')
  }
  ctx.sound('COIN_ACCEPTED', ctx.pointed.noid)
  spend(ctx, reply.price !== undefined ? reply.price : 0)
  return { ok: true }
}

// generic_PAY.m (host): an avatar paid a machine — debit them locally
// if it was us (others' balances aren't tracked client-side).
async function generic_PAY(ctx) {
  if (ctx.actor && ctx.args.BUYER === ctx.actor.noid) {
    spend(ctx, ctx.args.COST !== undefined ? ctx.args.COST : 0)
  }
  return { ok: true }
}

// teleport_PAY.m (host): like generic_PAY plus the booth lights up.
async function teleport_PAY(ctx) {
  ctx.sound('TELEPORT_ACTIVATES', ctx.pointed.noid)
  ctx.pointed.mod.state = 1 // TELEPORT_ACTIVE
  ctx.newImage(ctx.pointed.noid)
  if (ctx.actor && ctx.args.BUYER === ctx.actor.noid) {
    spend(ctx, ctx.args.COST !== undefined ? ctx.args.COST : 0)
  }
  return { ok: true }
}

// vendo_do.m: cycle the vending machine's display window — walk up,
// MSG_VSELECT; the host answers with the next display slot, and the
// previous display item swaps back inside. Elko echoes the container
// moves to neighbors, so locally we just track the display slot.
async function vendo_do(ctx) {
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  if (!ctx.isAdjacent()) return ctx.depends()

  ctx.chore('operate')
  const reply = await ctx.send({ op: 'VSELECT', to: ctx.pointed.ref })
  ctx.chore('stand')
  const newSlot = reply ? reply.slot : undefined
  if (newSlot === undefined || newSlot === 0xff) return ctx.boing('vendo-empty')
  ctx.sound('VENDO_CHANGING', ctx.pointed.noid)
  ctx.pointed.mod.display_slot = newSlot
  ctx.newImage(ctx.pointed.noid)
  return { ok: true, displaySlot: newSlot }
}

// vendo_SELECT.m (host): someone cycled the display — track the slot.
async function vendo_SELECT(ctx) {
  ctx.sound('VENDO_CHANGING', ctx.pointed.noid)
  if (ctx.args.slot !== undefined) ctx.pointed.mod.display_slot = ctx.args.slot
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// vendo_SELL.m (host): a sale happened — dispense sound and debit the
// buyer if it was us. The product object arrives as a make.
async function vendo_SELL(ctx) {
  ctx.sound('VENDO_DISPENSING', ctx.pointed.noid)
  if (ctx.actor && ctx.args.buyer === ctx.actor.noid) {
    spend(ctx, ctx.args.price !== undefined ? ctx.args.price : 0)
  }
  return { ok: true }
}

// magic_lamp_do.m: rub the held lamp; if the genie hasn't emerged,
// MSG_RUB summons it (state → genie, the host's message ballooned).
async function magic_lamp_do(ctx) {
  const lamp = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== lamp.noid) return ctx.depends()
  if (lamp.mod.gr_state) return ctx.beep('genie-already-out')
  const reply = await ctx.send({ op: 'RUB', to: lamp.ref })
  if (!succeeded(reply)) return ctx.beep('server-denied')
  lamp.mod.gr_state = 1 // MAGIC_LAMP_GENIE
  ctx.newImage(lamp.noid)
  ctx.sound('GENIE_APPEARS', lamp.noid)
  if (reply.text) ctx.balloon(reply.text)
  return { ok: true, text: reply.text }
}

// magic_lamp_RUB.m (host): someone summoned the genie.
async function magic_lamp_RUB(ctx) {
  ctx.sound('GENIE_APPEARS', ctx.pointed.noid)
  ctx.pointed.mod.gr_state = 1
  ctx.newImage(ctx.pointed.noid)
  if (ctx.args.text) ctx.balloon(ctx.args.text)
  return { ok: true }
}

// sex_changer_do.m: stand next to the machine and operate it — the
// host is told, and the avatar's body-type bit flips locally too.
async function sex_changer_do(ctx) {
  if (!ctx.isAdjacent()) return ctx.depends()
  ctx.chore('operate')
  ctx.newImage(ctx.pointed.noid, 1)
  await ctx.send({ op: 'SEXCHANGE', to: ctx.pointed.ref })
  if (ctx.actor && ctx.actor.mod.orientation !== undefined) {
    ctx.actor.mod.orientation = ctx.actor.mod.orientation ^ 8 // SEX_BIT
  }
  ctx.sound('SEX_CHANGER', ctx.pointed.noid)
  ctx.newImage(ctx.pointed.noid, 0)
  return { ok: true }
}

// sex_changer_SEXCHANGE.m (host): someone else got changed. deltas.js's
// SEXCHANGE$ flips the bit; this slot delegates the machine theatrics.
async function sex_changer_SEXCHANGE(ctx) {
  const target = ctx.world.get(ctx.args.target)
  if (target && target.mod.orientation !== undefined) {
    target.mod.orientation = target.mod.orientation ^ 8
  }
  ctx.sound('SEX_CHANGER', ctx.pointed.noid)
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// sex_changer_go.m shares generic_goTo's shape via the table.

// escape_device_do.m: holding it, MSG_BUGOUT — success teleports us
// home (the region change arrives from the server; the bridge handles
// the transit for bots).
async function escape_device_do(ctx) {
  const dev = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== dev.noid) return ctx.depends()
  ctx.sound('ESCAPE_DEVICE_ACTIVATES', dev.noid)
  const reply = await ctx.send({ op: 'BUGOUT', to: dev.ref })
  if (!succeeded(reply)) return ctx.boing('server-denied')
  return { ok: true } // changeContext follows from the server
}

// escape_device_BUGOUT.m (host): someone escaped — the delete for
// their avatar follows; nothing to mutate here.
async function escape_device_BUGOUT() {
  return { ok: true }
}

// grenade_do.m: pull the pin on the held grenade. The countdown and
// EXPLODE arrive asynchronously.
async function grenade_do(ctx) {
  const grenade = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== grenade.noid) return ctx.depends()
  if (grenade.mod.pin_pulled) return ctx.beep('pin-already-pulled')
  const reply = await ctx.send({ op: 'PULLPIN', to: grenade.ref })
  if (!succeeded(reply)) return ctx.beep('server-denied')
  grenade.mod.pin_pulled = 1
  return { ok: true }
}

// grenade_EXPLODE.m (host): it went off — the server follows with
// deletes/FIDDLEs for the damage; play the bang.
async function grenade_EXPLODE(ctx) {
  ctx.sound('EXPLOSION', ctx.pointed.noid)
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// fake_gun_do.m: reset a fired joke gun (MSG_RESET).
async function fake_gun_do(ctx) {
  const gun = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== gun.noid) return ctx.depends()
  if (!gun.mod.gr_state) return ctx.beep('not-fired') // FAKE_GUN_READY
  const reply = await ctx.send({ op: 'RESET', to: gun.ref })
  if (!succeeded(reply)) return ctx.beep('server-denied')
  gun.mod.gr_state = 0
  ctx.newImage(gun.noid)
  return { ok: true }
}

// fake_gun_rdo.m: "shoot" the subject — pure theater, a flag pops out.
async function fake_gun_rdo(ctx) {
  const gun = ctx.pointed
  ctx.chore('shoot1')
  const reply = await ctx.send({ op: 'FAKESHOOT', to: gun.ref })
  ctx.chore('shoot2')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.sound('JOKE_GUNSHOT', gun.noid)
  gun.mod.gr_state = 1 // FAKE_GUN_FIRED
  ctx.newImage(gun.noid)
  return { ok: true }
}

// fake_gun_FAKESHOOT.m (host): someone fired the joke gun nearby.
async function fake_gun_FAKESHOOT(ctx) {
  ctx.sound('JOKE_GUNSHOT', ctx.pointed.noid)
  ctx.pointed.mod.gr_state = 1
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// fake_gun_RESET.m (host): it was reset.
async function fake_gun_RESET(ctx) {
  ctx.pointed.mod.gr_state = 0
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// instant_object_TRANSFORM.m (host): the pill becomes something else —
// delete it; the new object arrives by-and-by as a make.
async function instant_object_TRANSFORM(ctx) {
  ctx.world._deleteByNoid(ctx.pointed.noid)
  return { ok: true }
}

// hand_of_god_BLAST.m (host): an oracle smiting — the named target
// vanishes.
async function hand_of_god_BLAST(ctx) {
  ctx.pointed.mod.gr_state = 1 // GOD_FIRING
  ctx.newImage(ctx.pointed.noid)
  const target = ctx.args.BLAST_TARGET !== undefined ? ctx.args.BLAST_TARGET : ctx.args.target
  if (target !== undefined) ctx.world._deleteByNoid(target)
  return { ok: true }
}

module.exports = {
  generic_coinOp,
  generic_PAY,
  teleport_PAY,
  vendo_do,
  vendo_SELECT,
  vendo_SELL,
  magic_lamp_do,
  magic_lamp_RUB,
  sex_changer_do,
  sex_changer_SEXCHANGE,
  escape_device_do,
  escape_device_BUGOUT,
  grenade_do,
  grenade_EXPLODE,
  fake_gun_do,
  fake_gun_rdo,
  fake_gun_FAKESHOOT,
  fake_gun_RESET,
  instant_object_TRANSFORM,
  hand_of_god_BLAST,
}
