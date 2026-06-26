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

// vendo_put.m + Vendo_front.java VEND: neohabitat uses VEND, not PAY.
// The C64 chained to generic_coinOp which sent generic_PAY; neohabitat's
// Vendo_front.java only answers VEND, so we send it directly here.
async function vendo_put(ctx) {
  const front = ctx.pointed
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  const inHand = ctx.inHand
  if (!inHand) return ctx.beep('hands-empty')
  if (inHand.type !== 'Tokens') return ctx.beep('not-tokens')

  ctx.chore('operate')
  ctx.sound('COIN_DEPOSITED', front.noid)
  const reply = await ctx.send({ op: 'VEND', to: front.ref })
  ctx.chore('hand_back')

  if (!succeeded(reply)) {
    ctx.sound('COIN_REJECTED', front.noid)
    return ctx.beep('payment-rejected')
  }

  ctx.sound('VENDO_DISPENSING', front.noid)
  // Debit tokens locally (mirrors C64 v_spend); SELL$ broadcast covers neighbors.
  const price = (reply.item_price_lo || 0) + (reply.item_price_hi || 0) * 256
  if (ctx.actor && price) {
    const wad = ctx.world.inventory(ctx.actor.noid).find((o) => o.type === 'Tokens')
    if (wad) {
      const denom = (wad.mod.denom_hi || 0) * 256 + (wad.mod.denom_lo || 0)
      const left = Math.max(0, denom - price)
      wad.mod.denom_lo = left & 0xff
      wad.mod.denom_hi = (left >> 8) & 0xff
    }
  }
  return { ok: true, price }
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

// teleport_talk.m: speak the destination address at the booth — ZAPTO.
// The region change follows from the server.
// If not adjacent, or if ZAPTO is refused, fall back to ordinary speech.
// NOTE: The C64 also checked mod.state===1 (active), but the server does
// its own state check. The client-side guard was a UI nicety. Removed
// here so bots don't need to pay a coin before every test teleport.
// new.mud class_teleport_booth has no slot 12, so the old doAction(12)
// was always a dead end — inline the broadcast instead.
async function teleport_talk(ctx) {
  if (ctx.isAdjacent()) {
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
  // Not adjacent — just broadcast the words as ordinary speech.
  await ctx.send({ op: 'SPEAK', to: ctx.actor.ref, esp: 0, text: ctx.args.text || '' })
  return { ok: true }
}

// teleport_ZAPIN.m (host): arrival flourish only.
async function teleport_ZAPIN(ctx) {
  ctx.sound('TELEPORT_ARRIVAL', ctx.pointed.noid)
  return { ok: true }
}

// teleport_ZAPTO (host, new.mud name): departure flourish; the
// traveler's delete follows.
function teleport_ZAPTO(ctx) {
  ctx.sound('TELEPORT_DEPARTING', ctx.pointed.noid)
  ctx.pointed.mod.state = 0
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// ── elevator (a Teleporter variant) ─────────────────────────────────
// Server-side Elevator extends Teleporter; ZAPTO routes to
// "otis-<area>-<floor>". Client behaviors mirror the teleport's.

// elevator_talk.m: stand in the elevator and speak the desired floor —
// ZAPTO with that text. The region change follows from the server. If not
// adjacent (not in the car), the words just broadcast as ordinary speech.
async function elevator_talk(ctx) {
  if (ctx.isAdjacent()) {
    const reply = await ctx.send({
      op: 'ZAPTO', to: ctx.pointed.ref, port_number: String(ctx.args.text || ''),
    })
    if (succeeded(reply)) {
      ctx.sound('ELEVATOR_DEPARTING', ctx.pointed.noid)
      return { ok: true } // changeContext follows
    }
    ctx.sound('ELEVATOR_CONF_WAIT', ctx.pointed.noid)
    return ctx.beep('bad-floor')
  }
  await ctx.send({ op: 'SPEAK', to: ctx.actor.ref, esp: 0, text: ctx.args.text || '' })
  return { ok: true }
}

// elevator_ZAPIN.m (host): arrival flourish only.
async function elevator_ZAPIN(ctx) {
  ctx.sound('ELEVATOR_ARRIVAL', ctx.pointed.noid)
  return { ok: true }
}

// elevator_ZAPTO / elevator_ZAPOUT.m (host): departure flourish; the
// traveler's delete follows.
async function elevator_ZAPTO(ctx) {
  ctx.sound('ELEVATOR_DEPARTING', ctx.pointed.noid)
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

// atm_get.m: withdraw cash. Faithful port of the C64 client (Behaviors/atm_get.m):
//   - hand must be empty OR holding a token wad (atm_get.m:25-34);
//   - GO to the ATM and wait (:35-36);
//   - select_denomination: prompt "Available: <balance>, Choose amount: " (:38-42) — graphical
//     clients prompt via ctx.requestTextInput; bots pass args.amount;
//   - operate chore + ATM_THINKING, send WITHDRAW, MONEY_OUT_OF_ATM + hand_back (:48-52);
//   - getResponse → beep_or_boing on failure (:54-58; actions.m:794: code 0 = beep, >=2 = boing);
//   - debit the local balance by the ACTUAL amount granted (:60-74);
//   - holding a wad → the cash merges into it (:76-93); empty hand → a new wad arrives async.
async function atm_get(ctx) {
  const held = ctx.inHand
  if (held && held.type !== 'Tokens') return ctx.beep('hands-full') // empty or a token wad only

  const go = await ctx.doAction(ACTION_GO) // doMyAction ACTION_GO — walk to the ATM
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  let amount = ctx.args.amount
  if (amount == null && ctx.requestTextInput) {
    const balance = ctx.actor && ctx.actor.mod.bankBalance != null ? ctx.actor.mod.bankBalance : 0
    const typed = await ctx.requestTextInput(`Available: ${balance}, Choose amount: `, { numeric: true })
    amount = parseInt(typed, 10)
  }
  if (!amount || amount <= 0) return ctx.beep('no-amount') // no money chosen → abort

  ctx.chore('operate')                            // chore AV_ACT_operate
  ctx.sound('ATM_THINKING', ctx.pointed.noid)     // sound ATM_THINKING
  const reply = await ctx.send({                  // sendMsg MSG_WITHDRAW
    op: 'WITHDRAW', to: ctx.pointed.ref,
    amount_lo: amount & 0xff, amount_hi: (amount >> 8) & 0xff,
  })
  ctx.sound('MONEY_OUT_OF_ATM', ctx.pointed.noid) // complexSound MONEY_OUT_OF_ATM
  ctx.chore('hand_back')                          // chore AV_ACT_hand_back

  // getResponse WITHDRAWAL_SUCCESS → beep_or_boing (Atm.java result_code: 1 ok, 0 beep, 2 boing).
  const code = reply ? reply.result_code : 0
  if (code !== 1) return code >= 2 ? ctx.boing('atm') : ctx.beep('atm')

  // Debit the local balance by the ACTUAL withdrawal (server may grant less than requested).
  const withdrawn = (reply.amount_hi || 0) * 256 + (reply.amount_lo || 0)
  if (ctx.actor) ctx.actor.mod.bankBalance = (ctx.actor.mod.bankBalance || 0) - withdrawn

  // Holding a wad → the cash merges into it locally; empty hand → a fresh wad arrives async.
  if (held && held.type === 'Tokens') {
    const denom = (held.mod.denom_hi || 0) * 256 + (held.mod.denom_lo || 0) + withdrawn
    held.mod.denom_lo = denom & 0xff
    held.mod.denom_hi = (denom >> 8) & 0xff
  }
  return { ok: true, withdrawn }
}

// atm_put.m: deposit the held tokens.
async function atm_put(ctx) {
  const wad = ctx.inHand
  if (!wad || wad.type !== 'Tokens') return ctx.beep('not-tokens')
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  // Atm.java DEPOSIT(@JSONMethod token_noid) looks up the mod by noid —
  // must send the wad's noid, not just the request.
  const reply = await ctx.send({ op: 'DEPOSIT', to: ctx.pointed.ref, token_noid: wad.noid })
  if (!succeeded(reply)) return ctx.beep('server-denied')
  const deposited = (wad.mod.denom_hi || 0) * 256 + (wad.mod.denom_lo || 0)
  if (ctx.actor) ctx.actor.mod.bankBalance = (ctx.actor.mod.bankBalance || 0) + deposited
  ctx.sound('MONEY_INTO_ATM', ctx.pointed.noid)
  ctx.world._deleteByNoid(wad.noid) // the wad went into the account
  return { ok: true, deposited }
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
function magic_lamp_WISH(ctx) {
  ctx.sound('MAGIC', ctx.pointed.noid)
  const text = ctx.args.WISH_MESSAGE
  if (text) ctx.balloon(text)
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
  elevator_talk,
  elevator_ZAPIN,
  elevator_ZAPTO,
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
