/* jshint esversion: 8 */

'use strict'

// Port of Behaviors/die_do.m — DO on a die rolls it.
//
//   lda #DIE_ROLLING / newImage pointed_noid   — show the rolling face
//   complexSound MAGIC
//   sendMsg pointed_noid, MSG_ROLL, 0
//   getResponse ROLL_STATE                      — the new face value
//   newImage pointed_noid                       — show the result
//
// The roller's OWN die never receives a ROLL$ delta: Die.java replies
// ROLL_STATE only to the roller and broadcasts ROLL$ to neighbors
// (deltas.js handles the neighbor case). So we apply gr_state here from
// the reply via ctx.changeState — the state change stays inside habiworld
// rather than being hand-rolled by the bot layer.

const DIE_ROLLING = 0

module.exports = async function die_do(ctx) {
  const die = ctx.pointed

  ctx.newImage(die.noid, DIE_ROLLING) // rolling animation
  ctx.sound('MAGIC', die.noid)

  const reply = await ctx.send({ op: 'ROLL', to: die.ref })
  const value = reply.ROLL_STATE
  if (value === undefined) return ctx.beep('server-denied')

  ctx.changeState(die.noid, value) // model gr_state + result image
  return { ok: true, value }
}
