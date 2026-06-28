/* jshint esversion: 8 */

'use strict'

// Magic and combat family — ports of:
//   Behaviors/generic_doMagic.m          (DO a held magic item)
//   Behaviors/generic_doMagicIfMagic.m   (same, gated on the magic bit)
//   Behaviors/generic_adjacentDoMagic.m  (DO a STATIONARY magic object)
//   Behaviors/button_CHANGESTATE.m       (host: a switch/knob changed state)
//   Behaviors/generic_strike.m           (RDO of melee weapons — knife/club)
//   Behaviors/generic_shoot.m            (RDO of guns)
//
// strike/shoot arrive through the depends chain: the user DOes the
// victim while holding the weapon → victim.do → depends → weapon.rdo.
// So pointed = the weapon, subject = the victim.

const { ACTION_GO } = require('../constants')

// generic_doMagic.m: must be holding the item; complexSound MAGIC and
// MSG_MAGIC with the affected object (ourselves by default, or args.target
// for directed magic via direct performVerb call). Host answers async.
async function generic_doMagic(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.depends()
  ctx.sound('MAGIC', ctx.pointed.noid)
  const target = ctx.args.target !== undefined ? ctx.args.target : ctx.actor.noid
  await ctx.send({ op: 'MAGIC', to: ctx.pointed.ref, target })
  return { ok: true }
}

// generic_doMagicIfMagic.m: same, but only if the object actually has
// its magic bit set (GENERIC_isMagic — surfaced as magic_type on
// neohabitat mods); non-magic ones beep.
async function generic_doMagicIfMagic(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.depends()
  const mod = ctx.pointed.mod
  const isMagic = !!(mod.isMagic || mod.magic_type)
  if (!isMagic) return ctx.beep('not-magic')
  ctx.sound('MAGIC', ctx.pointed.noid)
  const target = ctx.args.target !== undefined ? ctx.args.target : ctx.actor.noid
  await ctx.send({ op: 'MAGIC', to: ctx.pointed.ref, target })
  return { ok: true }
}

// generic_rdoMagic.m: RDO path — the user DOs another object while holding
// the magic item → depends re-dispatches here with the original pointed as
// subject. MAGIC op targets the subject. No in-hand check (C64 source
// doesn't include one for the RDO path).
// For direct performVerb calls, args.target supplies the target noid.
async function generic_rdoMagic(ctx) {
  const subject = ctx.args.target !== undefined
    ? ctx.world.get(ctx.args.target)
    : ctx.subject
  ctx.chore('point')
  ctx.sound('MAGIC', ctx.pointed.noid)
  await ctx.send({
    op: 'MAGIC', to: ctx.pointed.ref,
    target: subject ? subject.noid : (ctx.actor ? ctx.actor.noid : 0),
  })
  return { ok: true }
}

// generic_rdoMagicIfMagic.m: same, guarded by the isMagic bit.
async function generic_rdoMagicIfMagic(ctx) {
  const mod = ctx.pointed.mod
  const isMagic = !!(mod.isMagic || mod.magic_type)
  if (!isMagic) return ctx.beep('not-magic')
  const subject = ctx.args.target !== undefined
    ? ctx.world.get(ctx.args.target)
    : ctx.subject
  ctx.chore('point')
  ctx.sound('MAGIC', ctx.pointed.noid)
  await ctx.send({
    op: 'MAGIC', to: ctx.pointed.ref,
    target: subject ? subject.noid : (ctx.actor ? ctx.actor.noid : 0),
  })
  return { ok: true }
}

// generic_adjacentDoMagic.m: the DO of a STATIONARY magic object (a lever,
// fountain, switch, idol...). Unlike generic_doMagic, which acts on a held
// item, you must first walk adjacent and then operate it. C64 order: GO →
// operate chore → MSG_MAGIC (affected object = the actor) → MAGIC sound →
// newImage the object → hand_back chore. NeoHabitat's Magical.MAGIC answers
// asynchronously (the spell's effect arrives as its own broadcasts), so
// there is no NEW_STATE reply to wait on — newImage just redraws the
// object's current graphic.
async function generic_adjacentDoMagic(ctx) {
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  ctx.chore('operate')
  const target = ctx.args.target !== undefined ? ctx.args.target : ctx.actor.noid
  await ctx.send({ op: 'MAGIC', to: ctx.pointed.ref, target })
  ctx.sound('MAGIC', ctx.pointed.noid)
  ctx.newImage(ctx.pointed.noid)
  ctx.chore('hand_back')
  return { ok: true }
}

// button_CHANGESTATE.m (host/async): a switch, knob, or button changed its
// graphic state because some avatar operated it. Replay that avatar's
// operate chore, play the MAGIC sound on the object, set the new graphic
// state, and redraw. (NeoHabitat's Magical does not emit CHANGESTATE$ today
// — the constant is defined but unsent, like DIE$/REINCARNATE$ — so this
// lights up class_magic_immobile slot 8 to match the C64 for any server
// that does broadcast it. Field names are read defensively.)
function button_CHANGESTATE(ctx) {
  const obj = ctx.pointed
  const args = ctx.args
  const switcherNoid = args.switcher ?? args.SWITCHER_NOID ?? args.actor
  if (switcherNoid != null) ctx.chore('operate', switcherNoid)
  ctx.sound('MAGIC', obj.noid)
  const state = args.new_state ?? args.state ?? args.NEW_STATE
  if (state !== undefined) {
    obj.mod.gr_state = state
    ctx.world.emit('fieldChanged', obj, null)
  }
  ctx.newImage(obj.noid, state)
  return { ok: true }
}

// Shared ATTACK result handling (Weapon.java replies ATTACK_result:
// 0 = miss, 1 = destroyed target object, 2 = hit avatar, 3 = killed).
async function resolveAttack(ctx, victim, reply) {
  const result = reply ? reply.ATTACK_result : 0
  if (!result) return ctx.boing('missed')
  if (result === 1) {
    // Destroyed the target object — remove it locally (v_delete_object).
    ctx.world._deleteByNoid(victim.noid)
    return { ok: true, result: 'destroyed' }
  }
  // Hit (or killed) an avatar — play their reaction chore. Death
  // arrives asynchronously as host messages.
  const targetNoid = reply.ATTACK_target !== undefined ? reply.ATTACK_target : victim.noid
  ctx.newImage(targetNoid) // AV_ACT_get_shot — render hook only for us
  return { ok: true, result: result === 3 ? 'killed' : 'hit' }
}

// generic_strike.m: melee — the ACTOR must be adjacent to the victim
// (adjacency is checked against the subject, not the weapon), then
// MSG_ATTACK from the weapon naming the victim.
// ctx.subject set by depends chain; args.pointed_noid for direct calls.
async function generic_strike(ctx) {
  const victim = ctx.args.pointed_noid !== undefined
    ? ctx.world.get(ctx.args.pointed_noid)
    : ctx.subject
  if (!victim) return ctx.beep('no-target')
  if (!ctx.isAdjacent(victim.noid)) return ctx.beep('not-adjacent')
  ctx.chore('knife')
  const reply = await ctx.send({
    op: 'ATTACK', to: ctx.pointed.ref, pointed_noid: victim.noid,
  })
  return resolveAttack(ctx, victim, reply)
}

// generic_shoot.m: ranged — no adjacency; shoot chores and the GUNSHOT
// sound bracket the request.
// ctx.subject set by depends chain; args.pointed_noid for direct calls.
async function generic_shoot(ctx) {
  const victim = ctx.args.pointed_noid !== undefined
    ? ctx.world.get(ctx.args.pointed_noid)
    : ctx.subject
  if (!victim) return ctx.beep('no-target')
  ctx.chore('shoot1')
  ctx.sound('GUNSHOT', ctx.pointed.noid)
  ctx.chore('shoot2')
  const reply = await ctx.send({
    op: 'ATTACK', to: ctx.pointed.ref, pointed_noid: victim.noid,
  })
  return resolveAttack(ctx, victim, reply)
}

module.exports = {
  generic_doMagic,
  generic_doMagicIfMagic,
  generic_adjacentDoMagic,
  button_CHANGESTATE,
  generic_rdoMagic,
  generic_rdoMagicIfMagic,
  generic_strike,
  generic_shoot,
}
