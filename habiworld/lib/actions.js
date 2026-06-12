/* jshint esversion: 8 */

'use strict'

// actions.js — client-initiated action choreography, ported from the
// C64 client's Behaviors/generic_goToAnd*.m recipes.
//
// The original client never fired a GET/PUT/HAND request from where the
// avatar happened to be standing: every verb was a small script — check
// preconditions against local state, WALK to the target, send the
// request, then on a success reply apply the state change locally
// (getResponse → changeContainers). This module owns everything the
// world model can know:
//
//   - preconditions   (hands empty/full, target exists — read from world)
//   - the walk target (find_goto_coords: outermost container's position)
//   - the post-success mutation (the same changeContainers the C64 did)
//
// The client owns the I/O, supplied per call as callbacks:
//
//   walkTo(x, y)       → Promise — walk our avatar adjacent to (x, y).
//                        May resolve with the server-confirmed arrival
//                        {x, y} (from the WALK reply); we use it to
//                        update our own avatar's tracked position.
//   send(msg)          → Promise<reply> — send one Elko request and
//                        resolve with its type:"reply" JSON. Habitat is
//                        a single-request-in-flight protocol (the C64's
//                        getResponse blocks), so the next reply after a
//                        send is ours.
//   animationWait(ms)  → Promise — optional. The C64's `waitWhile
//                        animation_wait_bit`: pause while the walk (or
//                        chore) animation would be playing. Defaults to
//                        a plain timer if not supplied.
//
// Every recipe resolves to { ok, reason? } — never rejects for in-world
// failures (full hands, server denial); those are outcomes, not errors.
// Wire/transport failures from the callbacks propagate as rejections.

const { HANDS, THE_REGION, SCREEN_WIDTH, OPEN_BIT, UNLOCKED_BIT } = require('./constants')

// How long a walk animation "plays" for a given distance: the C64
// blocked on animation_wait_bit until the avatar finished walking. We
// have no animation engine, so approximate — a quarter of the screen
// width per second, capped at the full-screen 4s.
function walkWaitMillis(from, to) {
  if (!from || from.x === undefined) return 1000
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  if (dist < 1) return 0
  return Math.min(8000, Math.ceil((dist / (SCREEN_WIDTH / 4)) * 2000))
}

// doMyAction ACTION_GO + waitWhile animation_wait_bit, as one step:
// walk to the spot, track our avatar's new position (from the WALK
// reply if the client returns it), and wait out the walk animation.
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

// Main/actions.m:1271 find_goto_coords — walk up the containment chain
// to the outermost container (the object physically present in the
// region) and use its position as the walk target. The C64 then asks
// the object class for an exact standing spot (get_object_walk_xy);
// we approximate with the container's own coordinates and let the
// client's walkTo handle ground-plane adjacency.
function gotoCoords(world, noid) {
  let o = world.get(noid)
  while (o && o.containerRef && o.containerRef !== world.region.ref) {
    const outer = world.getByRef(o.containerRef)
    if (!outer) break
    o = outer
  }
  if (!o || o.mod.x === undefined) return null
  return { x: o.mod.x, y: o.mod.y }
}

// Replies signal success with a non-zero err field (goToAndGet.m:
// "Non-zero is success"); confirmed on the wire — a granted GET replies
// err:1, a denied one err:0.
function succeeded(reply) {
  return !!(reply && reply.err)
}

// Port of get_object_walk_xy (Main/walkto.m) for door-type objects.
// The C64 stored walk-standing offsets in the prop image header at
// image_walk_offset (byte 4): door1 has [0+right, 32+left, 255] — i.e.
// stand at obj.x + 0 when approaching from the left (left door frame),
// or obj.x + 32 when approaching from the right (door is 32px wide).
// orientation bit 0 = flipped (mirrored), which swaps sides and negates
// the offset exactly as the assembly does.
function adjacentCoords(world, noid) {
  const obj = world.get(noid)
  if (!obj || obj.mod.x === undefined) return null
  const me = world.me
  const myX = me ? me.mod.x : 80
  const flipped = !!(obj.mod.orientation & 1)
  // pick side: 0 = left frame (obj.x + 0), 1 = right frame (obj.x + 32)
  let goRight = myX > obj.mod.x
  if (flipped) goRight = !goRight
  const rawOffset = goRight ? 32 : 0
  const xOffset = flipped ? -rawOffset : rawOffset
  return {
    x: Math.max(8, Math.min(152, obj.mod.x + xOffset)),
    y: obj.mod.y,
  }
}

// Scan the region for a walkable surface object: Street or Ground first,
// then a Flat/Trapezoid/Super_trapezoid with flat_type == 2 (GROUND_FLAT).
// THROW requires a ground-surface noid as the `target` parameter — the
// server rejects throws onto avatars, walls, sky, etc.
function findThrowSurface(world) {
  for (const o of world.objects.values()) {
    if (o.containerRef !== world.region.ref) continue
    const t = o.type
    if (t === 'Street' || t === 'Ground') return o
    if ((t === 'Flat' || t === 'Trapezoid' || t === 'Super_trapezoid') && o.mod.flat_type === 2) return o
  }
  return null
}

const ACTIONS = {
  // Behaviors/generic_goToAndGet.m — the default 'get'. Hands must be
  // empty; go to the item (and wait out the walk, per waitWhile
  // animation_wait_bit); MSG_GET; on success the item lands in our
  // HANDS slot (changeContainers 0, AVATAR_HAND, actor_noid).
  async GET(world, opts, cb) {
    const me = world.me
    if (!me) return { ok: false, reason: 'not-in-region' }
    if (world.holding(me.noid)) return { ok: false, reason: 'hands-full' }
    const item = world.get(opts.noid)
    if (!item) return { ok: false, reason: 'no-such-object' }
    const spot = gotoCoords(world, item.noid)
    if (spot) await goTo(world, spot, cb)
    const reply = await cb.send({ op: 'GET', to: item.ref })
    if (!succeeded(reply)) return { ok: false, reason: 'server-denied' }
    world._changeContainers(item.noid, me.noid, 0, HANDS)
    return { ok: true }
  },

  // Behaviors/generic_goToAndDropAt.m — the default 'put'. Hands must
  // NOT be empty; go to the drop spot (waiting out the walk); drop into
  // THE_REGION. The reply carries the server-adjusted ground position
  // in `pos`.
  async PUT(world, opts, cb) {
    const me = world.me
    if (!me) return { ok: false, reason: 'not-in-region' }
    const item = world.holding(me.noid)
    if (!item) return { ok: false, reason: 'hands-empty' }
    await goTo(world, { x: opts.x, y: opts.y }, cb)
    const reply = await cb.send({
      op: 'PUT',
      to: item.ref,
      containerNoid: THE_REGION,
      x: opts.x,
      y: opts.y,
      orientation: item.mod.orientation || 0,
    })
    if (!succeeded(reply)) return { ok: false, reason: 'server-denied' }
    const y = reply.pos !== undefined ? reply.pos : opts.y
    world._changeContainers(item.noid, THE_REGION, opts.x, y)
    return { ok: true }
  },

  // Avatar HAND — give the in-HANDS item to another avatar. The server
  // transfers whatever sits in the giver's HANDS (there is no item
  // parameter); observers learn of it via GRABFROM$. For the giver the
  // success reply IS the notification, so we apply the transfer here:
  // the item moves into the recipient's HANDS (avatar_GRABFROM.m's
  // changeContainers, seen from the other side).
  async HAND(world, opts, cb) {
    const me = world.me
    if (!me) return { ok: false, reason: 'not-in-region' }
    const item = world.holding(me.noid)
    if (!item) return { ok: false, reason: 'hands-empty' }
    const recipient = world.get(opts.noid)
    if (!recipient || recipient.type !== 'Avatar') {
      return { ok: false, reason: 'no-such-avatar' }
    }
    await goTo(world, { x: recipient.mod.x, y: recipient.mod.y }, cb)
    const reply = await cb.send({ op: 'HAND', to: recipient.ref })
    if (!succeeded(reply)) return { ok: false, reason: 'server-denied' }
    world._changeContainers(item.noid, recipient.noid, 0, HANDS)
    // avatar_GRABFROM.m's asyncAnimationWait — let the hand_out /
    // hand_back chore play before reporting done.
    await cb.animationWait(1000)
    return { ok: true }
  },

  // Avatar THROW — fling the in-HANDS item toward a spot or avatar.
  // Unlike GET/PUT/HAND, the avatar stays in place (no goTo): the C64
  // threw from wherever the avatar stood. The server needs a ground-
  // surface noid as `target` (Class_Street, Class_Ground, or a GROUND_FLAT
  // Flat/Trapezoid); passing an avatar noid or x<8 / x>152 is rejected.
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

    // Clamp x to the server's accepted range: generic_THROW rejects x<8 or x>152.
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

  // generic_adjacentOpenClose — walk adjacent to the door (get_object_walk_xy
  // gives the standing spot; see adjacentCoords), wait out the walk, send OPEN.
  // The world model updates via the OPEN$ broadcast which arrives before the
  // reply, so no manual state mutation is needed here.
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

  // generic_adjacentOpenClose (close branch) — same walk pattern as OPEN.
  async CLOSE(world, opts, cb) {
    const me = world.me
    if (!me) return { ok: false, reason: 'not-in-region' }
    const obj = world.get(opts.noid)
    if (!obj) return { ok: false, reason: 'no-such-object' }
    const spot = adjacentCoords(world, opts.noid)
    if (spot) await goTo(world, spot, cb)
    const reply = await cb.send({ op: 'CLOSE', to: obj.ref })
    if (!succeeded(reply)) return { ok: false, reason: 'server-denied' }
    // Don't rely on CLOSE$ broadcast — apply locally, preserving UNLOCKED_BIT.
    obj.mod.open_flags = (obj.mod.open_flags || 0) & ~OPEN_BIT
    return { ok: true }
  },
}

// Single entry point: run one named action recipe against the world.
// Unknown verbs throw — that's a programming error, not an in-world
// outcome.
async function perform(world, verb, opts, cb) {
  const action = ACTIONS[verb]
  if (!action) throw new Error(`habiworld actions: unknown verb ${verb}`)
  if (!cb || typeof cb.walkTo !== 'function' || typeof cb.send !== 'function') {
    throw new Error('habiworld actions: callbacks {walkTo, send} are required')
  }
  // animationWait is optional — default to a plain timer.
  const callbacks = typeof cb.animationWait === 'function' ? cb : {
    ...cb,
    animationWait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
  return action(world, opts || {}, callbacks)
}

module.exports = { perform, ACTIONS, gotoCoords, adjacentCoords, walkWaitMillis }
