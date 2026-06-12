/* jshint esversion: 8 */

'use strict'

// Port of Behaviors/head_get.m — GET on a Head is special: if it's the
// head I'm wearing, take it off (MSG_REMOVE → my HANDS); any other
// contained head beeps (can't snatch a worn head, can't GET from a
// pocket this way); a head sitting in the region is a normal
// goToAndGet (walk, MSG_GET, into HANDS).

const { HANDS, HEAD, ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

module.exports = async function head_get(ctx) {
  const head = ctx.pointed
  const world = ctx.world

  if (head.containerRef && head.containerRef !== world.region.ref) {
    const container = world.getByRef(head.containerRef)
    if (container && container.type === 'Avatar' &&
        ctx.actor && container.noid === ctx.actor.noid &&
        head.mod.y === HEAD && !ctx.inHand) {
      // It's on my own head and my hands are free — doff it.
      const reply = await ctx.send({ op: 'REMOVE', to: head.ref })
      if (!succeeded(reply)) return ctx.beep('server-denied')
      ctx.sound('CLOTHES_DOFFED', ctx.actor.noid)
      ctx.chore('stand')
      ctx.newImage(head.noid, 'HEAD_OFF')
      ctx.changeContainers(head.noid, ctx.actor.noid, 0, HANDS)
      return { ok: true }
    }
    return ctx.beep('head-not-takeable') // worn by someone else, pocketed, or hands full
  }

  // On the ground — ordinary goToAndGet choreography.
  if (ctx.inHand) return ctx.beep('hands-full')
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  ctx.chore('bend_over')
  const reply = await ctx.send({ op: 'GET', to: head.ref })
  ctx.chore('bend_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.changeContainers(head.noid, ctx.actor.noid, 0, HANDS)
  return { ok: true }
}
