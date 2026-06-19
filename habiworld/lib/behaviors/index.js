/* jshint esversion: 8 */

'use strict'

// Behavior registry: every key is the exact behavior name used in
// new.mud's class action tables (which match the Behaviors/*.m source
// filenames — exceptions noted inline). The dispatcher resolves table
// entries against this registry; names not present here run as
// `unported` stubs that fail loudly with the original filename, so a
// missing port is always visible, never silent.
//
// Substantial behaviors get their own file; one-to-three-line .m files
// are defined here with their source cited.

const { ACTION_GO, THE_REGION } = require('../constants')

const B = {}

// ── failure terminators ─────────────────────────────────────────────

// Behaviors/illegal.m: chainTo v_boing
B.illegal = async (ctx) => ctx.boing()

// Behaviors/noEffect.m: chainTo v_beep
B.noEffect = async (ctx) => ctx.beep()

// Behaviors/unimplemented.m: chainTo v_boing
B.unimplemented = async (ctx) => ctx.boing()

// Behaviors/BOING.m: chainTo v_boing
B.BOING = async (ctx) => ctx.boing()

// beta.mud spells the v_boing terminator lowercase in several Region slots.
B.boing = async (ctx) => ctx.boing()

// Behaviors/generic_destroy.m: chainTo v_beep ("Eventually will be silent")
B.generic_destroy = async (ctx) => ctx.beep()

// ── no-ops and dispatch plumbing ────────────────────────────────────

// Behaviors/generic_cease.m: rts — return without doing anything.
B.generic_cease = async () => ({ ok: true })

// Behaviors/generic_depends.m: chainTo v_depends — re-dispatch the verb
// as reverse-DO on the in-hand item (or the avatar if empty-handed).
B.generic_depends = async (ctx) => ctx.depends()

// ── movement ────────────────────────────────────────────────────────

// Behaviors/generic_goTo.m: find_goto_coords → goXY. The near-universal
// default 'go'.
B.generic_goTo = async (ctx) => {
  const spot = ctx.gotoCoords(ctx.pointed.noid)
  if (!spot) return ctx.beep('no-walk-target')
  await ctx.walkTo(spot.x, spot.y)
  return { ok: true }
}

// Behaviors/generic_goToCursor.m: walk to the cursor position (for us:
// args x/y). Used as the 'go' of ground and street — which makes it the
// walk step of every drop-at choreography.
B.generic_goToCursor = async (ctx) => {
  const x = ctx.args.x !== undefined ? ctx.args.x : (ctx.pointed ? ctx.pointed.mod.x : 80)
  const y = ctx.args.y !== undefined ? ctx.args.y : (ctx.pointed ? ctx.pointed.mod.y : 144)
  await ctx.walkTo(x, y)
  return { ok: true }
}

// Behaviors/generic_goToOrPassThrough.m: door 'go' — pointing at the
// black opening of an open door walks through it (region change);
// otherwise walk to the door's standing spot (get_object_walk_xy →
// our adjacentCoords).
B.generic_goToOrPassThrough = async (ctx) => {
  if (ctx.args.passThrough) {
    await ctx.walkTo(ctx.pointed.mod.x, ctx.pointed.mod.y)
    return ctx.changeRegion('up')
  }
  const spot = ctx.adjacentCoords(ctx.pointed.noid) || ctx.gotoCoords(ctx.pointed.noid)
  if (!spot) return ctx.beep('no-walk-target')
  await ctx.walkTo(spot.x, spot.y)
  return { ok: true }
}

// Behaviors/avatar_go.m: GO at another avatar walks to them; GO at
// myself toggles sit/stand posture (not ported — beep).
B.avatar_go = async (ctx) => {
  if (ctx.actor && ctx.pointed.noid === ctx.actor.noid) {
    return ctx.beep('unported:avatar_go-posture-toggle')
  }
  const spot = ctx.gotoCoords(ctx.pointed.noid)
  if (!spot) return ctx.beep('no-walk-target')
  await ctx.walkTo(spot.x, spot.y)
  return { ok: true }
}

// Behaviors/sky_go.m: goXY to the cursor, then leave the region upward
// (region transit is a client capability).
B.sky_go = async (ctx) => {
  const me = ctx.actor
  await ctx.walkTo(
    ctx.args.x !== undefined ? ctx.args.x : (me ? me.mod.x : 80),
    ctx.args.y !== undefined ? ctx.args.y : (me ? me.mod.y : 144))
  return ctx.changeRegion('up')
}

// Behaviors/wall_go.m: walk toward the cursor x with the y clamped at
// the wall's base.
B.wall_go = async (ctx) => {
  const x = ctx.args.x !== undefined ? ctx.args.x : (ctx.actor ? ctx.actor.mod.x : 80)
  await ctx.walkTo(x, ctx.pointed.mod.y)
  return { ok: true }
}

// Behaviors/trap_go.m: a Flat's 'go' re-dispatches to internal slot
// 8 + flat_type (8 = sky_go, 9 = wall_go, 10 = goToCursor, 11 = noEffect).
B.trap_go = async (ctx) => ctx.doAction(8 + (ctx.pointed.mod.flat_type || 0))

// Behaviors/trap_put.m: PUT (drop) the held item onto a Trapezoid/Flat/
// Super_trapezoid — but ONLY when it's a GROUND-type surface
// (flat_type/TRAP_type == 2); a wall/sky backdrop beeps. Otherwise it is
// the same walk-and-drop as generic_goToAndDropAt.
B.trap_put = async (ctx) => {
  const item = ctx.inHand
  if (!item) return ctx.beep('hands-empty')
  if (ctx.pointed && item.noid === ctx.pointed.noid) return ctx.beep('drop-onto-self')
  if (ctx.pointed.mod.flat_type !== 2) return ctx.beep('not-ground') // ground ONLY
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  ctx.face()
  ctx.chore('bend_over')
  const x = ctx.args.x !== undefined ? ctx.args.x : (ctx.actor ? ctx.actor.mod.x : 80)
  const y = ctx.args.y !== undefined ? ctx.args.y : 144
  const result = await ctx.putInto(THE_REGION, x, y)
  ctx.chore('bend_back')
  return result
}

// ── talk ────────────────────────────────────────────────────────────

// Behaviors/generic_broadcast.m: v_talk to everybody. The ESP
// continuation loop (host flags ESP mode in the reply) is a client
// text-input flow — not ported; plain SPEAK only.
B.generic_broadcast = async (ctx) => {
  if (!ctx.args.text) return ctx.beep('nothing-to-say')
  await ctx.send({ op: 'SPEAK', to: 'ME', esp: 0, text: ctx.args.text })
  return { ok: true }
}

// ── region transit (client capability) ──────────────────────────────

// Behaviors/GoToNewRegion.m: the region's 'go' — leave through an edge.
B.GoToNewRegion = async (ctx) =>
  ctx.changeRegion(ctx.args.direction !== undefined ? ctx.args.direction : 'up')

// Behaviors/transit_region.m (region slot 8): host-commanded transit.
B.transit_region = async (ctx) =>
  ctx.changeRegion(ctx.args.direction !== undefined ? ctx.args.direction : 'up')

// ── substantial ports (one file per .m) ─────────────────────────────

B.generic_goToAndGet = require('./generic_goToAndGet')
B.generic_goToAndDropAt = require('./generic_goToAndDropAt')
B.generic_throw = require('./generic_throw')
B.generic_adjacentOpenClose = require('./generic_adjacentOpenClose')
B.avatar_put = require('./avatar_put')
B.avatar_get = require('./avatar_get')
B.head_get = require('./head_get')
B.die_do = require('./die_do')
B.plaque_do = require('./devices').plaque_do

// ── family modules (several related .m ports per file) ──────────────

Object.assign(B,
  require('./avatar_door_host'),      // avatar_OPEN / avatar_CLOSE
  require('./avatar_container_host'), // avatar_OPENCONTAINER / avatar_CLOSECONTAINER
  require('./containers'),     // pickFrom/dropInto/openCloseContainer
  require('./devices'),        // switches, lights, read, getMass
  require('./magic'),          // doMagic, strike, shoot
  require('./items'),          // key, tokens, paper, head, avatar do/talk
  require('./furniture'),      // sit/stand, fill bottle at water
  require('./consumables'),    // bottle, drugs, windup, book, gun, pay
  require('./gadgets'),        // sensor, spray, shovel, changomatic, mailbox...
  require('./machines'),       // coinOp, vendo, lamp, sex changer, grenade...
  require('./machines2'),      // machine puts, stereo/tape, atm, teleport talk
  require('./host_messages'))  // avatar/region slot 8+ delta delegates

module.exports = B
