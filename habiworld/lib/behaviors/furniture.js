/* jshint esversion: 8 */

'use strict'

// Furniture and liquids — ports of:
//   Behaviors/generic_goToFurniture.m  (chair/couch/bed GO: walk + sit/stand)
//   Behaviors/generic_goToAndFill.m    (fountain/pond PUT: fill held bottle)

const { THE_REGION, ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

// Avatar posture activity values (chore.m AV_ACT_*). generic_goToFurniture.m picks the seated
// pose from the seat's style bit (style & 1 → sit_chair, else sit_front) and stands on get-up.
const STAND = 129     // AV_ACT_stand
const SIT_CHAIR = 133 // AV_ACT_sit_chair
const SIT_FRONT = 157 // AV_ACT_sit_front

// generic_goToFurniture.m. As a plain GO it just walks to the seat.
// Re-invoked (the C64 user clicked DO), it sits — or stands if already
// sitting. SITORSTAND goes to MY avatar with the seat noid; on success
// the avatar's container changes to the seat (slot from the reply) or
// back to the region when standing.
//
// Deviation from the original: when not yet adjacent the C64 only
// walked, requiring a second click to sit. A bot can't click twice, so
// we walk and then proceed to sit in one call.
async function generic_goToFurniture(ctx) {
  const me = ctx.actor
  const seat = ctx.pointed
  if (!me) return ctx.beep('not-in-region')

  if (ctx.args.goOnly) {
    const spot = ctx.gotoCoords(seat.noid)
    if (!spot) return ctx.beep('no-walk-target')
    await ctx.walkTo(spot.x, spot.y)
    return { ok: true }
  }

  // Explicit up_or_down (0=stand, 1=sit) overrides the toggle from world state.
  // Needed when callers pass an explicit intent (e.g. sitOrstand(1, noid)).
  const sitting = ctx.args.up_or_down !== undefined
    ? (ctx.args.up_or_down === 0)
    : (me.containerRef && me.containerRef !== ctx.world.region.ref)

  if (sitting) {
    // Get up.
    const reply = await ctx.send({
      op: 'SITORSTAND', to: 'ME', up_or_down: 0, seat_id: seat.noid,
    })
    if (!succeeded(reply)) return ctx.beep('server-denied')
    const spot = ctx.gotoCoords(seat.noid) || { x: seat.mod.x, y: seat.mod.y }
    ctx.changeContainers(me.noid, THE_REGION, spot.x, spot.y | 0x80)
    // C64 chore AV_ACT_stand. Persist the pose (mod.activity drives the body composition) so
    // the avatar recomposes standing once it's back in the region.
    me.mod.activity = STAND
    ctx.posture(STAND)
    ctx.world.emit('stateChanged', me)
    return { ok: true, posture: 'standing' }
  }

  if (!ctx.isAdjacent()) {
    const go = await ctx.doAction(ACTION_GO, { goOnly: true })
    if (!go.ok) return ctx.beep(go.reason)
    await ctx.waitWalkAnimation()
  }

  const reply = await ctx.send({
    op: 'SITORSTAND', to: 'ME', up_or_down: 1, seat_id: seat.noid,
  })
  if (!succeeded(reply)) return ctx.beep('server-denied')
  const slot = reply.slot !== undefined ? reply.slot : 0
  ctx.changeContainers(me.noid, seat.noid, 0, slot)
  // C64 generic_goToFurniture: set_actor_chore(sit_front|sit_chair) from the seat's style bit,
  // then MSG_POSTURE. Persist the pose so the seated avatar composes sitting (mod.activity drives
  // the body composition); neighbors derive the same from SIT$ in avatar_SITORGETUP.
  const sit = ((seat.mod.style || 0) & 1) ? SIT_CHAIR : SIT_FRONT
  me.mod.activity = sit
  ctx.posture(sit)
  ctx.world.emit('stateChanged', me)
  return { ok: true, posture: 'sitting' }
}

// generic_goToAndFill.m: PUT a held bottle at a water source — walk
// over, MSG_FILL the bottle, mark it filled.
async function generic_goToAndFill(ctx) {
  const bottle = ctx.inHand
  if (!bottle || bottle.type !== 'Bottle') return ctx.beep('not-holding-bottle')

  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  ctx.chore('bend_over')
  const reply = await ctx.send({ op: 'FILL', to: bottle.ref })
  ctx.chore('bend_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  bottle.mod.filled = 1
  ctx.newImage(bottle.noid)
  return { ok: true }
}

module.exports = {
  generic_goToFurniture,
  generic_goToAndFill,
}
