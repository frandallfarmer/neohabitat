/* jshint esversion: 8 */

'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { HabitatWorld, constants, actions } = require('../index')
const { adjacentCoords } = require('../lib/behaviors/kernel')
const { HANDS, THE_REGION, OPEN_BIT } = constants

// Same fixture as world.test.js: us (noid 17), Naibor (noid 21), a
// knick-knack in our pocket slot 0, a flashlight on the ground (noid 30).
const REGION_REF = 'context-Lori_Ln_113_front'
const ME_REF = 'user-sagebot-1111'
const NAIBOR_REF = 'user-naibor-2222'

function makeStorm(world) {
  world.apply({
    to: 'session', op: 'make',
    obj: {
      type: 'context', ref: REGION_REF, name: '113 Lori Ln',
      mods: [{ type: 'Region', orientation: 1, neighbors: ['context-a', 'context-b', '', 'context-d'], realm: 'Streets', lighting: 0 }],
    },
  })
  world.apply({
    to: REGION_REF, op: 'make', you: true,
    obj: {
      type: 'user', ref: ME_REF, name: 'SageBot',
      mods: [{ type: 'Avatar', noid: 17, x: 12, y: 142, orientation: 0, gr_state: 0 }],
    },
  })
  world.apply({
    to: ME_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-knick-1', name: 'Knick_knack',
      mods: [{ type: 'Knick_knack', noid: 14, x: 12, y: 0, orientation: 0, gr_state: 3 }],
    },
  })
  world.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'user', ref: NAIBOR_REF, name: 'Naibor',
      mods: [{ type: 'Avatar', noid: 21, x: 100, y: 140, orientation: 0, gr_state: 0 }],
    },
  })
  world.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-flashlight-1', name: 'Flashlight',
      mods: [{ type: 'Flashlight', noid: 30, x: 60, y: 140, orientation: 0, gr_state: 0, on: 0 }],
    },
  })
}

// Recording callback set: walks, sends, and animation waits are
// logged; replies come from a scripted queue (default: grant
// everything with err:1). Waits resolve immediately so tests stay fast.
function recorder(replies) {
  const calls = { walks: [], sends: [], waits: [] }
  const queue = replies ? [...replies] : null
  return {
    calls,
    cb: {
      walkTo: async (x, y) => { calls.walks.push({ x, y }) },
      send: async (msg) => {
        calls.sends.push(msg)
        return queue ? queue.shift() : { type: 'reply', err: 1 }
      },
      animationWait: async (ms) => { calls.waits.push(ms) },
    },
  }
}

test('GET walks to the item, waits out the walk, sends GET, and lands it in HANDS on success', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'GET', { noid: 30 }, cb)
  assert.ok(result.ok)
  // find_goto_coords walk-offset spot for the flashlight (60,140), not the
  // raw item position: stand to its left at x=40, depth-clamped y=135.
  assert.deepEqual(calls.walks, [{ x: 40, y: 135 }])
  // Walk-animation wait scaled by distance: me (12,142) → (40,135) is
  // ~29 units ≈ 1.4s; always within (0, 8000].
  assert.equal(calls.waits.length, 1)
  assert.ok(calls.waits[0] > 1000 && calls.waits[0] <= 8000)
  assert.deepEqual(calls.sends, [{ op: 'GET', to: 'item-flashlight-1' }])
  // Our avatar's tracked position followed the walk.
  assert.equal(w.me.mod.x, 40)
  const held = w.holding(17)
  assert.ok(held)
  assert.equal(held.noid, 30)
  assert.equal(held.mod.y, HANDS)
})

test('GET refuses with full hands, before any I/O', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Move the knick-knack into HANDS first.
  w.apply({ op: 'GET$', noid: 17, target: 14, how: 1 })
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'GET', { noid: 30 }, cb)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'hands-full')
  assert.equal(calls.walks.length, 0)
  assert.equal(calls.sends.length, 0)
})

test('GET leaves the world untouched when the server denies', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const { cb } = recorder([{ type: 'reply', err: 0 }])
  const result = await actions.perform(w, 'GET', { noid: 30 }, cb)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'server-denied')
  assert.equal(w.holding(17), null)
  assert.ok(w.inRegion(30)) // still on the ground
})

test('PUT walks to the spot and drops the held item into the region', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 17, target: 14, how: 1 }) // knick-knack to HANDS
  const { calls, cb } = recorder([{ type: 'reply', err: 1, pos: 141 }])
  const result = await actions.perform(w, 'PUT', { x: 120, y: 140 }, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.walks, [{ x: 120, y: 140 }])
  assert.equal(calls.sends[0].op, 'PUT')
  assert.equal(calls.sends[0].containerNoid, THE_REGION)
  assert.equal(w.holding(17), null)
  const item = w.get(14)
  assert.equal(item.containerRef, REGION_REF)
  assert.equal(item.mod.x, 120)
  assert.equal(item.mod.y, 141) // server-adjusted pos from the reply
})

test('PUT refuses with empty hands', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'PUT', { x: 120, y: 140 }, cb)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'hands-empty')
  assert.equal(calls.sends.length, 0)
})

test('HAND walks to the recipient and transfers the held item to them', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 17, target: 14, how: 1 }) // knick-knack to HANDS
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'HAND', { noid: 21 }, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.walks, [{ x: 80, y: 140 }]) // Naibor's walk-offset spot (left of 100)
  assert.deepEqual(calls.sends, [{ op: 'HAND', to: NAIBOR_REF }])
  // One wait: the walk animation. avatar_put.m brackets the send with
  // hand_out/hand_back chores but does not block on them — the earlier
  // extra 1s wait here came from avatar_GRABFROM.m, which is the
  // RECEIVER's chore, not the giver's.
  assert.equal(calls.waits.length, 1)
  // The giver-side fix for "sage still thinks it holds the Changomatic":
  assert.equal(w.holding(17), null)
  const held = w.holding(21)
  assert.ok(held)
  assert.equal(held.noid, 14)
})

test('HAND refuses when the target is not an avatar', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 17, target: 14, how: 1 })
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'HAND', { noid: 30 }, cb)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-such-avatar')
  assert.equal(calls.sends.length, 0)
})

// Helper: add a Street to the world so THROW has a valid surface target.
function addStreet(world) {
  world.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-street-1', name: 'Street',
      mods: [{ type: 'Street', noid: 50, x: 80, y: 160, orientation: 0, gr_state: 0 }],
    },
  })
}

test('THROW stays in place, uses ground surface noid, lands held item in region', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  addStreet(w)
  w.apply({ op: 'GET$', noid: 17, target: 14, how: 1 }) // knick-knack to HANDS
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'THROW', { x: 100, y: 144 }, cb)
  assert.ok(result.ok)
  assert.equal(calls.walks.length, 0) // no walk — throw from current spot
  assert.deepEqual(calls.sends, [{ op: 'THROW', to: 'item-knick-1', target: 50, x: 100, y: 144 }])
  assert.equal(w.holding(17), null)
  const item = w.get(14)
  assert.equal(item.containerRef, REGION_REF)
  assert.equal(item.mod.x, 100)
})

test('THROW at avatar uses their position as landing coords', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  addStreet(w)
  w.apply({ op: 'GET$', noid: 17, target: 14, how: 1 })
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'THROW', { noid: 21 }, cb)
  assert.ok(result.ok)
  assert.equal(calls.walks.length, 0)
  // Naibor is at x:100 — must be clamped to [8,152], no clamp needed here
  assert.equal(calls.sends[0].x, 100)
  assert.equal(calls.sends[0].target, 50)
})

test('THROW clamps x to [8,152]', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  addStreet(w)
  w.apply({ op: 'GET$', noid: 17, target: 14, how: 1 })
  const { calls, cb } = recorder()
  await actions.perform(w, 'THROW', { x: 0, y: 144 }, cb) // x:0 would be server-rejected
  assert.equal(calls.sends[0].x, 8)
})

test('THROW refuses with empty hands', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  addStreet(w)
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'THROW', { x: 80, y: 144 }, cb)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'hands-empty')
  assert.equal(calls.sends.length, 0)
})

test('GET on an item inside a container walks to the outermost container', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // A box on the ground with a paper inside it.
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-box-1', name: 'Box',
      mods: [{ type: 'Box', noid: 40, x: 90, y: 130, orientation: 0, gr_state: 0, open_flags: 3 }],
    },
  })
  w.apply({
    to: 'item-box-1', op: 'make',
    obj: {
      type: 'item', ref: 'item-paper-9', name: 'Paper',
      mods: [{ type: 'Paper', noid: 41, x: 0, y: 0, orientation: 0, gr_state: 0 }],
    },
  })
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'GET', { noid: 41 }, cb)
  assert.ok(result.ok)
  // Walk-offset spot of the outermost container (the box at 90,130), not
  // the paper's slot coords: find_goto_coords climbs containment then
  // get_object_walk_xy → stand left of the box at x=72, y=129.
  assert.deepEqual(calls.walks, [{ x: 72, y: 129 }])
  assert.equal(w.holding(17).noid, 41)
})

// ── OPEN / CLOSE (adjacentCoords + goTo) ────────────────────────────────────

// Helper: add a door to the world at a given position.
function addDoor(world, noid, x, orientation, open_flags = 0) {
  world.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: `item-door-${noid}`, name: 'Door',
      mods: [{ type: 'Door', noid, x, y: 128, orientation, gr_state: 0, open_flags }],
    },
  })
}

test('OPEN walks adjacent (right side for left-wall door) then sends OPEN', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Left-wall door at x=16, not flipped: avatar at x=12 is to the LEFT,
  // so goRight=false (myX <= obj.x) → stand at door.x + 0 = 16.
  // After clamp: 16.
  addDoor(w, 60, 16, 0, 0)
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'OPEN', { noid: 60 }, cb)
  assert.ok(result.ok)
  assert.equal(calls.walks.length, 1)
  assert.equal(calls.walks[0].x, 16) // left frame — avatar was already to the left
  assert.deepEqual(calls.sends, [{ op: 'OPEN', to: 'item-door-60' }])
})

test('OPEN walks to right frame when avatar is to the right of the door', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Door at x=16, avatar at x=12 is LEFT; move avatar right first via WALK$
  w.apply({ op: 'WALK$', noid: 17, x: 80, y: 142, how: 0 })
  addDoor(w, 60, 16, 0, 0)
  const { calls, cb } = recorder()
  await actions.perform(w, 'OPEN', { noid: 60 }, cb)
  assert.equal(calls.walks[0].x, 48) // right frame: 16 + 32 = 48
})

test('OPEN updates world model open_flags on success', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  addDoor(w, 60, 16, 0, 0)  // starts closed
  const { cb } = recorder()
  const result = await actions.perform(w, 'OPEN', { noid: 60 }, cb)
  assert.ok(result.ok)
  assert.equal(w.get(60).mod.open_flags & OPEN_BIT, OPEN_BIT)
})

test('CLOSE walks adjacent then sends CLOSE', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  addDoor(w, 60, 16, 0, OPEN_BIT)  // start open
  const { calls, cb } = recorder()
  const result = await actions.perform(w, 'CLOSE', { noid: 60 }, cb)
  assert.ok(result.ok)
  assert.equal(calls.walks.length, 1)
  assert.deepEqual(calls.sends, [{ op: 'CLOSE', to: 'item-door-60' }])
})

test('CLOSE clears OPEN_BIT from world model on success', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  addDoor(w, 60, 16, 0, OPEN_BIT)  // starts open
  const { cb } = recorder()
  const result = await actions.perform(w, 'CLOSE', { noid: 60 }, cb)
  assert.ok(result.ok)
  assert.equal(w.get(60).mod.open_flags & OPEN_BIT, 0)
})

test('adjacentCoords flipped door: right-wall door (orientation=1) stands 32px to the left', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Flipped door at x=128. Avatar at x=12 is to the left.
  // goRight = (12 > 128) = false; flipped → goRight = true; rawOffset=32; xOffset=-32
  // walk to 128 - 32 = 96
  addDoor(w, 60, 128, 1, 0)
  const { calls, cb } = recorder()
  await actions.perform(w, 'OPEN', { noid: 60 }, cb)
  assert.equal(calls.walks[0].x, 96)
})

// Live-calibrated against the real C64 client (Randy in the Library): a
// wall-mounted Safe at (30,80) in a region of depth 32. Randy stood adjacent
// at (56,160) and opened it. get_object_walk_xy: x = (30+28)&0xFC = 56;
// y = 128 + clamp((80&0x7f) + (-1), 0, 32) = 128 + 32 = 160. The region_depth
// clamp drops the wall object's stand-spot to the floor — the bug that made
// SageBot "refuse" the safe before find_goto_coords was ported faithfully.
test('find_goto_coords: wall Safe — avatar stands on the floor (Randy calibration 56,160)', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.region.depth = 32 // Library depth (makeStorm omits it)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-safe-1', name: 'Wall safe',
      mods: [{ type: 'Safe', noid: 80, x: 30, y: 80, orientation: 0, gr_state: 0, open_flags: 2 }],
    },
  })
  w.me.mod.x = 80 // approach from the right, like Randy
  const spot = adjacentCoords(w, 80)
  assert.deepEqual(spot, { x: 56, y: 160 })
})
