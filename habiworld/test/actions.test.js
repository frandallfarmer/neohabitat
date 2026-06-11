/* jshint esversion: 8 */

'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { HabitatWorld, constants, actions } = require('../index')
const { HANDS, THE_REGION } = constants

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
  assert.deepEqual(calls.walks, [{ x: 60, y: 140 }]) // flashlight's spot
  // Walk-animation wait scaled by distance: me (12,142) → (60,140) is
  // ~48 units ≈ 1.2 quarter-screens ≈ 1.2s; always within (0, 4000].
  assert.equal(calls.waits.length, 1)
  assert.ok(calls.waits[0] > 1000 && calls.waits[0] <= 4000)
  assert.deepEqual(calls.sends, [{ op: 'GET', to: 'item-flashlight-1' }])
  // Our avatar's tracked position followed the walk.
  assert.equal(w.me.mod.x, 60)
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
  assert.deepEqual(calls.walks, [{ x: 100, y: 140 }]) // Naibor's spot
  assert.deepEqual(calls.sends, [{ op: 'HAND', to: NAIBOR_REF }])
  // Two waits: the walk animation, then the 1s hand_out/hand_back chore
  // (avatar_GRABFROM.m's asyncAnimationWait).
  assert.equal(calls.waits.length, 2)
  assert.equal(calls.waits[1], 1000)
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
  assert.deepEqual(calls.walks, [{ x: 90, y: 130 }]) // the box, not the paper's slot coords
  assert.equal(w.holding(17).noid, 41)
})
