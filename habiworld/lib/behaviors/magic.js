/* jshint esversion: 8 */

'use strict'

// Magic and combat family — ports of:
//   Behaviors/generic_doMagic.m         (DO a held magic item)
//   Behaviors/generic_doMagicIfMagic.m  (same, gated on the magic bit)
//   Behaviors/generic_strike.m          (RDO of melee weapons — knife/club)
//   Behaviors/generic_shoot.m           (RDO of guns)
//
// strike/shoot arrive through the depends chain: the user DOes the
// victim while holding the weapon → victim.do → depends → weapon.rdo.
// So pointed = the weapon, subject = the victim.

// generic_doMagic.m: must be holding the item; complexSound MAGIC and
// MSG_MAGIC with the affected object (ourselves — the wielder). The
// host answers asynchronously (effects arrive as host messages), so
// no response handling.
async function generic_doMagic(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.depends()
  ctx.sound('MAGIC', ctx.pointed.noid)
  await ctx.send({ op: 'MAGIC', to: ctx.pointed.ref, target: ctx.actor.noid })
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
  await ctx.send({ op: 'MAGIC', to: ctx.pointed.ref, target: ctx.actor.noid })
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
async function generic_strike(ctx) {
  const victim = ctx.subject
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
async function generic_shoot(ctx) {
  const victim = ctx.subject
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
  generic_strike,
  generic_shoot,
}
