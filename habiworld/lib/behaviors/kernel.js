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

// The C64 stores OBJECT_y_position as (foreground_bit | depth): bit 7
// (0x80 = 128) flags the foreground/avatar render layer, the low 7 bits
// are the depth into the region's walkable band [0, region_depth].
// Avatars always render in the foreground, so an avatar's y is 128 + depth
// (e.g. 160 = 128 + a depth of 32). Walk targets are produced in depth
// space, clamped to the band, then raised into the foreground.
const FOREGROUND_BIT = 0x80
// If a region make never carried a depth, fall back to the common value
// (matches a full-height walkable band; avatars at y≈160).
const DEFAULT_REGION_DEPTH = 32

// Port of get_object_walk_xy (Main/walkto.m:212). Given an object that is
// physically present in the region, return the (x, y) an avatar must stand
// at to be adjacent to it. CANONICAL — mirror the .m, do not approximate.
//
//   side  = (object.x >= avatar.x) ? 0:left : 1:right     (cmp → carry)
//   idx   = (side XOR flipped) + image_walk_offset(4)      → prop byte 4/5
//   x     = object.x + offset      (flipped non-avatar: mirror; see note)
//   x     = x & 0xFC               (4px grid, strips facing/anim low bits)
//           if x >= 156: pass 0 → flip side & retry; pass 1 → 8 if x>=208
//           (negative-wrapped) else 156
//   depth = (object.y & 0x7f) + walkByte6, clamped to [0, region_depth]
//   y     = 128 + depth            (foreground layer)
function getObjectWalkXY(world, obj) {
  const me = world.me
  const avatarX = me ? me.mod.x : 80
  const objX = obj.mod.x
  const flipped = obj.mod.orientation & 1
  const offsets = getWalkOffsets(byTypeName[obj.type], obj.mod.style)
    || { xLeft: 0, xRight: 32, yDelta: 0 } // unmapped types: door-sized

  // ── Y (walkto.m:288) — depth from object.y low 7 bits + walk Y offset,
  //    clamped to the region band, then raised into the foreground layer.
  const regionDepth = world.region.depth || DEFAULT_REGION_DEPTH
  let depth = (obj.mod.y & 0x7f) + (offsets.yDelta || 0)
  if (depth < 0) depth = 0
  else if (depth > regionDepth) depth = regionDepth
  const y = FOREGROUND_BIT + depth

  // ── X (walkto.m:220 try_other_side) — pick approach side, two passes.
  // First pass side: avatar at/left of object → left(0), else right(1).
  let side = avatarX <= objX ? 0 : 1
  for (let pass = 0; pass < 2; pass++) {
    const useLeft = (side ^ flipped) === 0
    const xOffset = useLeft ? offsets.xLeft : offsets.xRight
    // Flipped non-avatar objects mirror the offset. The .m adds the first
    // cel's width before two's-complement negating (walkto.m:253); cel
    // widths aren't reliably available (Java image_celWidth is wrong), and
    // a plain sign inversion reproduces the observed door/safe behavior.
    let x = (flipped ? objX - xOffset : objX + xOffset) & 0xFF // wrap like a 6502 byte
    x &= 0xFC // 4px grid
    if (x < 156) return { x, y } // in range
    if (pass === 0) { side ^= 1; continue } // try_other_side
    return { x: x >= 208 ? 8 : 156, y } // 2nd pass clamp (neg-wrap → left edge)
  }
}

// Port of find_goto_coords (Main/actions.m:1271): walk up the containment
// chain to the outermost object physically in the region, then ask it for
// its walk coordinates via get_object_walk_xy. This single function is the
// canonical basis for BOTH the GO walk target and the adjacency test — the
// C64 uses find_goto_coords for both, so they can never disagree.
function findGotoCoords(world, noid) {
  let o = world.get(noid)
  while (o && o.containerRef && o.containerRef !== world.region.ref) {
    const outer = world.getByRef(o.containerRef)
    if (!outer) break
    o = outer
  }
  if (!o || o.mod.x === undefined) return null
  return getObjectWalkXY(world, o)
}

// gotoCoords and adjacentCoords are the same thing in the C64
// (find_goto_coords); kept as two names only for caller readability.
const gotoCoords = findGotoCoords
const adjacentCoords = findGotoCoords

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
  // Avatar chores always run on an Avatar noid (actor_noid on the C64).
  // Host OPEN$ points at the neighbor actor; DO on a door points at the door.
  ctx.chore = (act, noid) => {
    if (!client.chore) return
    const target = noid != null ? noid
      : (pointed && pointed.type === 'Avatar' ? pointed.noid : (me ? me.noid : null))
    if (target != null) client.chore(act, target)
  }
  // C64 newImage noid[, state]: optional state sets gr_state then redraws.
  // Background objects set background_render (full backdrop); the renderer
  // handles that via refresh on newImage / fieldChanged.
  ctx.newImage = (noid, state) => {
    if (state !== undefined && typeof state === 'number') {
      const o = world.objects.get(noid)
      if (o) {
        o.mod.gr_state = state
        world.emit('stateChanged', o)
      }
    }
    if (client.newImage) client.newImage(noid, state)
  }
  ctx.balloon = (text, meta) => {
    if (!client.balloon || text == null || text === "") return
    const info = (meta && typeof meta === "object") ? { ...meta } : {}
    if (info.speaker == null && info.speakerNoid == null && ctx.actor) {
      info.speaker = ctx.actor.noid
    }
    client.balloon(String(text), info)
  }
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

  // Set gr_state on the model and redraw (newImage). Used when the new
  // state arrives in a reply to our own request (die_do's ROLL_STATE),
  // not as a broadcast delta — keeps the state mutation inside habiworld.
  ctx.changeState = (noid, state) => {
    world._changeState(noid, state)
    if (client.newImage) client.newImage(noid, state)
  }

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
  // Optional `orientation` overrides item.mod.orientation (used by putObj
  // to place items at a specific rotation).
  ctx.putInto = async (containerNoid, x, y, orientation) => {
    const item = ctx.inHand
    if (!item) return ctx.beep('hands-empty')
    const orient = orientation !== undefined ? orientation : (item.mod.orientation || 0)
    const reply = await ctx.send({
      op: 'PUT',
      to: item.ref,
      containerNoid: containerNoid,
      x: x,
      y: y,
      orientation: orient,
    })
    if (!succeeded(reply)) return ctx.beep('server-denied')
    const finalY = reply.pos !== undefined ? reply.pos : y
    world._changeContainers(item.noid, containerNoid, x, finalY)
    if (orientation !== undefined) item.mod.orientation = orientation
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
