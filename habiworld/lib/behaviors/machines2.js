/* jshint esversion: 8 */

'use strict'

// Coin-fed machines, the stereo, the ATM, the teleport — ports of:
//   Behaviors/coke_machine_put.m / fortune_machine_put.m / jukebox_put.m
//   Behaviors/vendo_put.m
//   Behaviors/teleport_put.m / teleport_talk.m / teleport_ZAPIN.m / ZAPTO
//   Behaviors/stereo_put.m / stereo_get.m / stereo_UNLOAD.m / stereo_PLAY.m
//   Behaviors/tape_LOAD.m
//   Behaviors/atm_do.m / atm_get.m / atm_put.m
//   Behaviors/magic_lamp_talk.m / magic_lamp_WISH.m / magic_lamp_GIVEUP.m
//   Behaviors/jukebox_do.m / jukebox_talk.m / jukebox_PLAY.m
//   Behaviors/sex_changer_go.m
//
// The C64's *_put behaviors chained their class's COINOP internal slot
// (which is generic_coinOp); we call the behavior directly through the
// same slot indirection the table provides.

const { HANDS, THE_REGION, ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

// ── PUT-tokens-into-machine family (each chains its COINOP slot) ────

// coke_machine_put.m: PAY, then the machine grumbles. The dispensed
// can arrives as a make.
async function coke_machine_put(ctx) {
  const paid = await ctx.doAction(9) // COKE_COINOP slot → generic_coinOp
  if (paid.ok) ctx.sound('STINGY_COKE_MACHINE', ctx.pointed.noid)
  return paid
}

// fortune_machine_put.m: same chain, different slot constant.
async function fortune_machine_put(ctx) {
  const paid = await ctx.doAction(9) // FORTUNE_COINOP
  if (paid.ok) ctx.sound('FORTUNE_DISPENSED', ctx.pointed.noid)
  return paid
}

// jukebox_put.m: pay to play the displayed selection.
async function jukebox_put(ctx) {
  return ctx.doAction(10) // JUKEBOX_COINOP
}

// vendo_put.m: pay; the purchased product pops into the region (the
// C64 unpacked it from the reply — elko sends a make).
async function vendo_put(ctx) {
  const paid = await ctx.doAction(10) // VENDO_COINOP
  if (paid.ok) ctx.sound('VENDO_DISPENSING', ctx.pointed.noid)
  return paid
}

// teleport_put.m: walk up and pay an inactive booth to activate it.
async function teleport_put(ctx) {
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  if (ctx.pointed.mod.state) return ctx.beep('already-active')
  const paid = await ctx.doAction(11) // TELEPORT_COINOP
  if (!paid.ok) return paid
  ctx.sound('TELEPORT_ACTIVATES', ctx.pointed.noid)
  ctx.pointed.mod.state = 1 // TELEPORT_ACTIVE
  return { ok: true }
}

// teleport_talk.m: speak the destination address at an active,
// adjacent booth — ZAPTO. The region change follows from the server.
// An inactive booth (or talking from across the room) just broadcasts
// the words as ordinary speech.
async function teleport_talk(ctx) {
  if (ctx.isAdjacent() && ctx.pointed.mod.state === 1) {
    const reply = await ctx.send({
      op: 'ZAPTO', to: ctx.pointed.ref, port_number: ctx.args.text || '',
    })
    if (succeeded(reply)) {
      ctx.sound('TELEPORT_DEPARTING', ctx.pointed.noid)
      ctx.pointed.mod.state = 0 // TELEPORT_READY
      return { ok: true } // changeContext follows
    }
    ctx.sound('TELEPORT_ACTIVATES', ctx.pointed.noid)
    return ctx.beep('bad-address')
  }
  return ctx.doAction(12) // TELEPORT_BROADCAST → generic_broadcast
}

// teleport_ZAPIN.m (host): arrival flourish only.
async function teleport_ZAPIN(ctx) {
  ctx.sound('TELEPORT_ARRIVAL', ctx.pointed.noid)
  return { ok: true }
}

// teleport_ZAPTO (host, new.mud name): departure flourish; the
// traveler's delete follows.
async function teleport_ZAPTO(ctx) {
  ctx.sound('TELEPORT_DEPARTING', ctx.pointed.noid)
  ctx.pointed.mod.state = 0
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// ── stereo and tape ─────────────────────────────────────────────────

// stereo_put.m: PUT at the stereo with a tape in hand loads the tape
// (MSG_LOAD names the tape; it moves inside the stereo). Holding
// anything else just drops it at the stereo.
async function stereo_put(ctx) {
  const item = ctx.inHand
  if (!item) return ctx.beep('hands-empty')
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  if (item.type !== 'Tape') {
    ctx.chore('bend_over')
    const dropped = await ctx.putInto(THE_REGION,
      ctx.pointed.mod.x, ctx.pointed.mod.y)
    ctx.chore('bend_back')
    return dropped
  }
  if (ctx.pointed.mod.tape) return ctx.beep('stereo-loaded')
  ctx.chore('bend_over')
  const reply = await ctx.send({
    op: 'LOAD', to: ctx.pointed.ref, tape: item.noid,
  })
  ctx.chore('bend_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.changeContainers(item.noid, ctx.pointed.noid, 0, 0)
  ctx.pointed.mod.tape = item.noid
  return { ok: true }
}

// stereo_get.m: GET while holding a loaded stereo ejects the tape
// (MSG_UNLOAD; the tape lands at my feet... and then in the world per
// the host's follow-ups). Otherwise a normal goToAndGet of the stereo.
async function stereo_get(ctx) {
  const held = ctx.inHand
  const stereo = ctx.pointed
  if (held) {
    if (held.noid !== stereo.noid || !stereo.mod.tape) return ctx.beep('hands-full')
    const tape = ctx.world.get(stereo.mod.tape)
    const reply = await ctx.send({ op: 'UNLOAD', to: stereo.ref })
    if (!succeeded(reply)) return ctx.beep('server-denied')
    if (tape && ctx.actor) {
      ctx.changeContainers(tape.noid, THE_REGION,
        ctx.actor.mod.x, ctx.actor.mod.y)
    }
    stereo.mod.tape = 0
    return { ok: true }
  }
  if (ctx.inHand) return ctx.beep('hands-full')
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  ctx.chore('bend_over')
  const reply = await ctx.send({ op: 'GET', to: stereo.ref })
  ctx.chore('bend_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.changeContainers(stereo.noid, ctx.actor.noid, 0, HANDS)
  return { ok: true }
}

// stereo_UNLOAD.m (host): someone ejected the tape.
async function stereo_UNLOAD(ctx) {
  ctx.pointed.mod.tape = 0
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// stereo_PLAY / jukebox_PLAY (host): music starts — a renderer/sound
// client capability; nothing in the world model changes.
async function stereo_PLAY(ctx) {
  ctx.sound('MUSIC', ctx.pointed.noid)
  return { ok: true }
}

// tape_LOAD.m (host): someone loaded a tape into a stereo.
async function tape_LOAD(ctx) {
  const stereoNoid = ctx.args.LOAD_STEREO !== undefined ? ctx.args.LOAD_STEREO : ctx.args.stereo
  const tapeNoid = ctx.args.LOAD_TAPE !== undefined ? ctx.args.LOAD_TAPE : ctx.args.tape
  if (tapeNoid !== undefined && stereoNoid !== undefined) {
    ctx.changeContainers(tapeNoid, stereoNoid, 0, 0)
    const stereo = ctx.world.get(stereoNoid)
    if (stereo) stereo.mod.tape = tapeNoid
  }
  return { ok: true }
}

// ── ATM ─────────────────────────────────────────────────────────────

// atm_do.m: balloon my bank balance — local only.
async function atm_do(ctx) {
  const balance = ctx.actor && ctx.actor.mod.bankBalance !== undefined
    ? ctx.actor.mod.bankBalance : 0
  ctx.balloon(`Balance: $${balance}`)
  return { ok: true, balance: balance }
}

// atm_get.m: withdraw — the C64 prompted for an amount; bots pass
// args.amount. The token wad arrives/updates asynchronously.
async function atm_get(ctx) {
  if (ctx.inHand) return ctx.beep('hands-full')
  const amount = ctx.args.amount
  if (!amount || amount <= 0) return ctx.beep('no-amount')
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  const reply = await ctx.send({
    op: 'WITHDRAW', to: ctx.pointed.ref,
    amount_lo: amount & 0xff, amount_hi: (amount >> 8) & 0xff,
  })
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.sound('MONEY_OUT_OF_ATM', ctx.pointed.noid)
  return { ok: true }
}

// atm_put.m: deposit the held tokens.
async function atm_put(ctx) {
  const wad = ctx.inHand
  if (!wad || wad.type !== 'Tokens') return ctx.beep('not-tokens')
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  const reply = await ctx.send({ op: 'DEPOSIT', to: ctx.pointed.ref })
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.sound('MONEY_INTO_ATM', ctx.pointed.noid)
  ctx.world._deleteByNoid(wad.noid) // the wad went into the account
  return { ok: true }
}

// ── magic lamp talk / jukebox ───────────────────────────────────────

// magic_lamp_talk.m: with the genie out, your words are a WISH;
// otherwise ordinary speech (slot 10 broadcast).
async function magic_lamp_talk(ctx) {
  if (ctx.pointed.mod.gr_state) { // genie out
    const reply = await ctx.send({
      op: 'WISH', to: ctx.pointed.ref, text: ctx.args.text || '',
    })
    return succeeded(reply) ? { ok: true } : ctx.beep('wish-denied')
  }
  return ctx.doAction(10) // MAGIC_LAMP_BROADCAST → generic_broadcast
}

// magic_lamp_WISH (host): wish theatrics; outcome arrives separately.
async function magic_lamp_WISH(ctx) {
  ctx.sound('MAGIC', ctx.pointed.noid)
  return { ok: true }
}

// magic_lamp_GIVEUP (host): the genie returns to the lamp.
async function magic_lamp_GIVEUP(ctx) {
  ctx.sound('GENIE_OUT', ctx.pointed.noid)
  ctx.pointed.mod.gr_state = 0 // MAGIC_LAMP_WAITING
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// jukebox_do.m: walk up and flip to the next catalog entry; the host
// replies with the song listing, ballooned off the jukebox.
async function jukebox_do(ctx) {
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  const reply = await ctx.send({ op: 'CATALOG', to: ctx.pointed.ref })
  if (reply && reply.text) ctx.balloon(reply.text)
  return { ok: true, text: reply ? reply.text : undefined }
}

// jukebox_talk.m: ordinary broadcast — the words just go to the room
// (the C64 file chains straight to v_talk).
async function jukebox_talk(ctx) {
  if (!ctx.args.text) return ctx.beep('nothing-to-say')
  await ctx.send({ op: 'SPEAK', to: 'ME', esp: 0, text: ctx.args.text })
  return { ok: true }
}

// jukebox_PLAY (host): music starts.
async function jukebox_PLAY(ctx) {
  ctx.sound('MUSIC', ctx.pointed.noid)
  return { ok: true }
}

// sex_changer_go.m: plain find_goto_coords walk (its own .m because
// the machine overrides the default 'go' table slot).
async function sex_changer_go(ctx) {
  const spot = ctx.gotoCoords(ctx.pointed.noid)
  if (!spot) return ctx.beep('no-walk-target')
  await ctx.walkTo(spot.x, spot.y)
  return { ok: true }
}

module.exports = {
  coke_machine_put,
  fortune_machine_put,
  jukebox_put,
  vendo_put,
  teleport_put,
  teleport_talk,
  teleport_ZAPIN,
  teleport_ZAPTO,
  stereo_put,
  stereo_get,
  stereo_UNLOAD,
  stereo_PLAY,
  tape_LOAD,
  atm_do,
  atm_get,
  atm_put,
  magic_lamp_talk,
  magic_lamp_WISH,
  magic_lamp_GIVEUP,
  jukebox_do,
  jukebox_talk,
  jukebox_PLAY,
  sex_changer_go,
}
