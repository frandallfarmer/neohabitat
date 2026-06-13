/* jshint esversion: 8 */

'use strict'

// kernel.js — the behavior runtime: the JS equivalent of action_head.i's
// macro vocabulary plus the Main/ "system call" vectors that behaviors
// were allowed to touch. Every ported Behaviors/*.m function receives a
// ctx built here; nothing in a behavior may reach the world or the wire
// except through ctx.
//
// The ctx fields mirror the C64 zero-page registers exactly:
//   actor    — my avatar              (actor_noid / actor_object)
//   pointed  — the verb's target      (pointed_noid / pointed_object)
//   inHand   — held item or null      (in_hand_noid / in_hand_object)
//   subject  — previous pointed, set when `depends` re-dispatches
//              (subject_noid — what you were pointing at before the
//              verb fell through to the in-hand item)
//   args     — verb arguments (cursor x/y, host message fields)
//   verb     — current action slot    (current_action_number)
//
// Client I/O callbacks (walkTo, send, animationWait are required; the
// rest are optional and no-op by default — a bot ignores sounds and
// chores, a future renderer implements them):
//   send(msg) → Promise<reply>      sendMsg + waitWhile reply_wait_bit
//   walkTo(x, y) → Promise<{x,y}>   v_goXY / v_start_walk
//   animationWait(ms)               waitWhile animation_wait_bit
//   beep() / boing()                v_beep / v_boing failure terminators
//   sound(n), chore(act), newImage(noid, state), balloon(text),
//   face(dir), changeRegion(direction), changeLight(n)

const {
  HANDS, THE_REGION, SCREEN_WIDTH, OPEN_BIT, UNLOCKED_BIT,
} = require('../constants')
const { byTypeName } = require('../classes')
const { getWalkOffsets } = require('../walk_offsets')

// How long a walk animation "plays" for a given distance: the C64
// blocked on animation_wait_bit until the avatar finished walking. We
// have no animation engine, so approximate — an eighth of the screen
// width per second, capped at 8s.
function walkWaitMillis(from, to) {
  if (!from || from.x === undefined) return 1000
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  if (dist < 1) return 0
  return Math.min(8000, Math.ceil((dist / (SCREEN_WIDTH / 4)) * 2000))
}

// Main/actions.m:1271 find_goto_coords — walk up the containment chain
// to the outermost container (the object physically present in the
// region) and use its position as the walk target.
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

// Port of get_object_walk_xy (Main/walkto.m).
// Uses per-(class, style) walk-offset tables from Constants.java via
// walk_offsets.js. The C64 prop-file header bytes 4/5/6 store left/right
// approach X offsets and a Y delta; orientation bit 0 (flipped) mirrors
// the X position using the first cel's width. Falls back to hardcoded
// door values (0 / 32) when the class has no table entry.
function adjacentCoords(world, noid) {
  const obj = world.get(noid)
  if (!obj || obj.mod.x === undefined) return null
  const me = world.me
  const myX = me ? me.mod.x : 80
  const flipped = !!(obj.mod.orientation & 1)
  const classNum = byTypeName[obj.type]
  const offsets = getWalkOffsets(classNum, obj.mod.style)

  let xLeft, xRight, yDelta
  if (offsets) {
    xLeft  = offsets.xLeft
    xRight = offsets.xRight
    yDelta = offsets.yDelta
  } else {
    // fallback: door-sized offsets (0 / 32) for unmapped types
    xLeft = 0; xRight = 32; yDelta = 0
  }

  // Side selection: avatar to the left of the object → approach from left.
  // Flipped orientation XORs the choice (C64: try_side XOR flipped).
  const tryLeft = myX < obj.mod.x
  const useLeft = tryLeft !== flipped

  // For flipped non-avatar objects the C64 two's-complement negates the
  // walk offset (cel mirror), which simplifies to plain sign inversion —
  // image_celWidth from Java Constants is unused (that code path was
  // never activated in production; the sign-flip alone is correct).
  const xOffset = useLeft ? xLeft : xRight
  const x = flipped
    ? obj.mod.x - xOffset
    : obj.mod.x + xOffset

  // Clamp to [8, 156] and 4-pixel align. If out of range on first try,
  // try the other side (C64's try_other_side branch).
  let xFinal = x & ~3
  if (xFinal < 8 || xFinal > 156) {
    const altOffset = useLeft ? xRight : xLeft
    const altX = flipped ? obj.mod.x - altOffset : obj.mod.x + altOffset
    xFinal = Math.max(8, Math.min(156, altX & ~3))
  } else {
    xFinal = Math.max(8, Math.min(156, xFinal))
  }

  // Do NOT mask y with 0x7F — the Elko JSON stores raw screen pixel y
  // (avatars walk at y≈130-150). The C64's `and #0x7f` cleared a runtime
  // background-layer flag that was set in C64 RAM but is never present in
  // the server-side JSON coordinates.
  const y = obj.mod.y + (yDelta || 0)
  return { x: xFinal, y: Math.max(0, y) }
}

// Scan the region for a walkable surface object: Street or Ground first,
// then a Flat/Trapezoid/Super_trapezoid with flat_type == 2 (GROUND_FLAT).
// THROW requires a ground-surface noid as the `target` parameter.
function findThrowSurface(world) {
  for (const o of world.objects.values()) {
    if (o.containerRef !== world.region.ref) continue
    const t = o.type
    if (t === 'Street' || t === 'Ground') return o
    if ((t === 'Flat' || t === 'Trapezoid' || t === 'Super_trapezoid') && o.mod.flat_type === 2) return o
  }
  return null
}

// Replies signal success with a non-zero err field ("Non-zero is
// success" — goToAndGet.m).
function succeeded(reply) {
  return !!(reply && reply.err)
}

const defaultAnimationWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Build the behavior context. `parent` is the calling ctx when this is
// a nested dispatch (doMyAction / depends); depth guards against
// depends-loops the C64 never had to worry about.
function makeCtx(world, verb, pointed, args, client, parent) {
  const me = world.me
  const ctx = {
    world,
    verb,
    args: args || {},
    actor: me,
    pointed,
    // depends swaps pointed → in-hand item and stashes the old pointed
    // in subject (depends.m: moveb pointed_noid, subject_noid)
    subject: parent && parent.pointed !== pointed
      ? parent.pointed
      : (parent ? parent.subject : null),
    client,
    depth: parent ? parent.depth + 1 : 0,
    // Walk-animation state is shared across the whole dispatch chain:
    // `doMyAction ACTION_GO` records the walk in a nested ctx, but the
    // calling behavior's `waitWhile animation_wait_bit` reads it.
    _walkState: parent ? parent._walkState : { millis: null },
  }

  Object.defineProperty(ctx, 'inHand', {
    get() { return me ? world.holding(me.noid) : null },
  })

  // ── host I/O ──────────────────────────────────────────────────────

  ctx.send = (msg) => client.send(msg)

  // v_goXY: walk, track our avatar's confirmed position, record how
  // long the walk animation would play (consumed by waitWalkAnimation —
  // the `doMyAction ACTION_GO / waitWhile animation_wait_bit` pair).
  ctx.walkTo = async (x, y) => {
    const from = (me && me.mod.x !== undefined) ? { x: me.mod.x, y: me.mod.y } : null
    const arrived = await client.walkTo(x, y)
    const dest = (arrived && arrived.x !== undefined) ? arrived : { x, y }
    if (me) {
      me.mod.x = dest.x
      me.mod.y = dest.y
    }
    ctx._walkState.millis = walkWaitMillis(from, dest)
    return dest
  }

  ctx.animationWait = (ms) =>
    (client.animationWait || defaultAnimationWait)(ms)

  // waitWhile animation_wait_bit, after a GO — waits out the distance
  // recorded by the last walkTo.
  ctx.waitWalkAnimation = async () => {
    const ms = ctx._walkState.millis === null ? 1000 : ctx._walkState.millis
    ctx._walkState.millis = null
    if (ms > 0) await ctx.animationWait(ms)
  }

  // ── failure terminators ───────────────────────────────────────────
  // beep = "can't do that", boing = "illegal operation". Optional
  // reason refines the result for callers; the C64 had only the noises.

  ctx.beep = (reason) => {
    if (client.beep) client.beep(reason)
    return { ok: false, reason: reason || 'beep' }
  }

  ctx.boing = (reason) => {
    if (client.boing) client.boing(reason)
    return { ok: false, reason: reason || 'boing' }
  }

  // ── presentation hooks (no-op for bots, real for a renderer) ──────

  ctx.sound = (n, noid) => { if (client.sound) client.sound(n, noid) }
  ctx.chore = (act) => { if (client.chore) client.chore(act) }
  ctx.newImage = (noid, state) => { if (client.newImage) client.newImage(noid, state) }
  ctx.balloon = (text) => { if (client.balloon) client.balloon(text) }
  ctx.face = (dir) => { if (client.face) client.face(dir) }

  ctx.changeLight = (n) => {
    world.region.lighting = (world.region.lighting || 0) + n
    if (client.changeLight) client.changeLight(n)
  }

  // v_go_to_new_region — region transit is a client capability (the
  // bridge owns it for bots). Behaviors request it and report honestly
  // when the client can't.
  ctx.changeRegion = (direction) => {
    if (client.changeRegion) return client.changeRegion(direction)
    return { ok: false, reason: 'needs-client-capability:changeRegion' }
  }

  // ── world shorthands ──────────────────────────────────────────────

  ctx.changeContainers = (itemNoid, containerNoid, x, y) =>
    world._changeContainers(itemNoid, containerNoid, x, y)

  ctx.gotoCoords = (noid) => gotoCoords(world, noid)
  ctx.adjacentCoords = (noid) => adjacentCoords(world, noid)

  // v_adjacency_check (Main/actions.m:1209). The C64 compared the
  // avatar's position with find_goto_coords output for exact equality —
  // safe when its own walker landed pixel-perfect. Our walks go through
  // a server round-trip with landing adjustments, so use a tolerance
  // instead of equality.
  ctx.isAdjacent = (noid) => {
    if (!me) return false
    const target = noid === undefined ? (pointed && pointed.noid) : noid
    if (target === undefined || target === null) return false
    const spot = adjacentCoords(world, target) || gotoCoords(world, target)
    if (!spot) return false
    return Math.abs(me.mod.x - spot.x) <= 32 &&
      Math.abs(me.mod.y - spot.y) <= 16
  }

  // v_putInto (used by generic_goToAndDropAt and the pocket flows):
  // PUT the in-hand item into a container, apply the transfer on a
  // success reply. The reply's `pos` carries the server-adjusted y.
  ctx.putInto = async (containerNoid, x, y) => {
    const item = ctx.inHand
    if (!item) return ctx.beep('hands-empty')
    const reply = await ctx.send({
      op: 'PUT',
      to: item.ref,
      containerNoid: containerNoid,
      x: x,
      y: y,
      orientation: item.mod.orientation || 0,
    })
    if (!succeeded(reply)) return ctx.beep('server-denied')
    const finalY = reply.pos !== undefined ? reply.pos : y
    world._changeContainers(item.noid, containerNoid, x, finalY)
    return { ok: true }
  }

  return ctx
}

module.exports = {
  makeCtx,
  walkWaitMillis,
  gotoCoords,
  adjacentCoords,
  findThrowSurface,
  succeeded,
}
