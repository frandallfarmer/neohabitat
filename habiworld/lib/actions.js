/* jshint esversion: 8 */

'use strict'

// actions.js — bot-facing action API. Historically this module held
// hand-rolled ports of the C64 goToAnd* recipes; those now live in
// lib/behaviors/ under their original .m names, dispatched through the
// class-to-resource table (lib/classes.js). This module remains as the
// stable verb-level API habibot calls:
//
//   perform(world, 'GET',  { noid }, cb)  → class-dispatched ACTION_GET
//   perform(world, 'HAND', { noid }, cb)  → ACTION_PUT at an avatar
//                                           (avatar_put = the give gesture)
//   perform(world, 'PUT',  { x, y }, cb)  → drop at ground coords
//   perform(world, 'THROW',{ noid|x,y }, cb)
//   perform(world, 'OPEN' / 'CLOSE', { noid }, cb)
//
// PUT, THROW, OPEN and CLOSE keep explicit recipes here rather than
// going through verb dispatch: PUT has no pointed object (the C64
// pointed at a ground object; bots pass coordinates), THROW from a bot
// skips the depends chain, and OPEN/CLOSE need idempotent semantics on
// top of the C64's single DO-toggle (generic_adjacentOpenClose).
//
// Client callbacks per call: { walkTo, send, animationWait } — see
// behaviors/kernel.js for the full optional set.

const { THE_REGION, OPEN_BIT, UNLOCKED_BIT, ACTION_GET, ACTION_PUT } = require('./constants')
const {
  makeCtx, walkWaitMillis, gotoCoords, adjacentCoords, findThrowSurface, succeeded,
} = require('./behaviors/kernel')
const { dispatch } = require('./behaviors/dispatch')

// Walk to a spot, track our avatar's confirmed position, wait out the
// walk animation — the `doMyAction ACTION_GO; waitWhile
// animation_wait_bit` pair for the explicit recipes below.
async function goTo(world, spot, cb) {
  const me = world.me
  const from = me ? { x: me.mod.x, y: me.mod.y } : null
  const arrived = await cb.walkTo(spot.x, spot.y)
  const dest = (arrived && arrived.x !== undefined) ? arrived : spot
  if (me) {
    me.mod.x = dest.x
    me.mod.y = dest.y
  }
  await cb.animationWait(walkWaitMillis(from, dest))
}

const ACTIONS = {
  // Class-dispatched get: most items route to generic_goToAndGet, heads
  // to head_get, avatars to avatar_get (grab from their hands).
  async GET(world, opts, cb) {
    return dispatch(world, ACTION_GET, opts.noid, opts, cb)
  },

  // Give the held item to another avatar: ACTION_PUT pointed at them
  // lands in avatar_put (Behaviors/avatar_put.m). The avatar check
  // stays here so callers get a precise reason instead of whatever
  // behavior the target's class would route PUT to.
  async HAND(world, opts, cb) {
    const recipient = world.get(opts.noid)
    if (!recipient || recipient.type !== 'Avatar') {
      return { ok: false, reason: 'no-such-avatar' }
    }
    return dispatch(world, ACTION_PUT, opts.noid, opts, cb)
  },

  // Drop the held item at ground coordinates (generic_goToAndDropAt
  // semantics with the walk aimed at the drop spot).
  async PUT(world, opts, cb) {
    const me = world.me
    if (!me) return { ok: false, reason: 'not-in-region' }
    const item = world.holding(me.noid)
    if (!item) return { ok: false, reason: 'hands-empty' }
    await goTo(world, { x: opts.x, y: opts.y }, cb)
    const ctx = makeCtx(world, ACTION_PUT, null, opts, cb, null)
    const result = await ctx.putInto(THE_REGION, opts.x, opts.y)
    if (!result.ok && result.reason === 'beep') result.reason = 'server-denied'
    return result
  },

  // Fling the held item (Behaviors/generic_throw.m semantics, minus
  // the depends chain a pointing UI would arrive through). No walk —
  // throws happen from where the avatar stands.
  async THROW(world, opts, cb) {
    const me = world.me
    if (!me) return { ok: false, reason: 'not-in-region' }
    const item = world.holding(me.noid)
    if (!item) return { ok: false, reason: 'hands-empty' }

    let targetX = opts.x != null ? opts.x : 80
    let targetY = opts.y != null ? opts.y : 144
    if (opts.noid) {
      const target = world.get(opts.noid)
      if (target) {
        targetX = target.mod.x
        targetY = target.mod.y
      }
    }
    targetX = Math.max(8, Math.min(152, targetX))

    const surface = findThrowSurface(world)
    if (!surface) return { ok: false, reason: 'no-surface' }

    const reply = await cb.send({
      op: 'THROW',
      to: item.ref,
      target: surface.noid,
      x: targetX,
      y: targetY,
    })
    if (!succeeded(reply)) return { ok: false, reason: 'server-denied' }
    world._changeContainers(item.noid, THE_REGION, targetX, targetY)
    return { ok: true }
  },

  // Idempotent open: walk adjacent (get_object_walk_xy spot), send
  // OPEN. The C64's door DO is a toggle (generic_adjacentOpenClose);
  // bots want "make it open", so this stays a separate recipe.
  async OPEN(world, opts, cb) {
    const me = world.me
    if (!me) return { ok: false, reason: 'not-in-region' }
    const obj = world.get(opts.noid)
    if (!obj) return { ok: false, reason: 'no-such-object' }
    const spot = adjacentCoords(world, opts.noid)
    if (spot) await goTo(world, spot, cb)
    const reply = await cb.send({ op: 'OPEN', to: obj.ref })
    if (!succeeded(reply)) return { ok: false, reason: 'server-denied' }
    // Don't rely on OPEN$ broadcast — the sender may be excluded from neighbors.
    obj.mod.open_flags = OPEN_BIT | UNLOCKED_BIT
    return { ok: true }
  },

  async CLOSE(world, opts, cb) {
    const me = world.me
    if (!me) return { ok: false, reason: 'not-in-region' }
    const obj = world.get(opts.noid)
    if (!obj) return { ok: false, reason: 'no-such-object' }
    const spot = adjacentCoords(world, opts.noid)
    if (spot) await goTo(world, spot, cb)
    const reply = await cb.send({ op: 'CLOSE', to: obj.ref })
    if (!succeeded(reply)) return { ok: false, reason: 'server-denied' }
    obj.mod.open_flags = (obj.mod.open_flags || 0) & ~OPEN_BIT
    return { ok: true }
  },
}

// Single entry point: run one named action against the world. Unknown
// verbs throw — that's a programming error, not an in-world outcome.
async function perform(world, verb, opts, cb) {
  const action = ACTIONS[verb]
  if (!action) throw new Error(`habiworld actions: unknown verb ${verb}`)
  if (!cb || typeof cb.walkTo !== 'function' || typeof cb.send !== 'function') {
    throw new Error('habiworld actions: callbacks {walkTo, send} are required')
  }
  const callbacks = typeof cb.animationWait === 'function' ? cb : {
    ...cb,
    animationWait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
  return action(world, opts || {}, callbacks)
}

module.exports = { perform, ACTIONS, gotoCoords, adjacentCoords, walkWaitMillis }
