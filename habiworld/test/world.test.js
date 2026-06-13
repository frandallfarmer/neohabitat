/* jshint esversion: 8 */

'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { HabitatWorld, constants } = require('../index')
const { HANDS } = constants

// Fixture modeled on a real make storm captured from prod docker logs
// (SageBot entering 113 Lori Ln, Jun 2026): region make, our avatar
// (you:true) with pocket items addressed to the user ref, another
// avatar, and a flashlight on the ground addressed to the context ref.
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
  // Pocket item: `to` = our user ref, y = slot index (0 = pocket slot 0)
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
  // Ground item: `to` = context ref, x/y are screen coordinates
  world.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-flashlight-1', name: 'Flashlight',
      mods: [{ type: 'Flashlight', noid: 30, x: 60, y: 140, orientation: 0, gr_state: 0, on: 0 }],
    },
  })
}

test('make storm populates region, avatars, ground, and pockets', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  assert.equal(w.region.name, '113 Lori Ln')
  assert.equal(w.region.orientation, 1)
  assert.equal(w.me.noid, 17)
  assert.equal(w.avatars().length, 2)
  assert.equal(w.inventory(17).length, 1)
  assert.equal(w.inventory(17)[0].type, 'Knick_knack')
  assert.equal(w.holding(17), null) // knick-knack is in slot 0, not HANDS
  assert.ok(w.inRegion(30)) // flashlight on the ground
})

test('WALK$ updates avatar position (the walk-to-avatar staleness bug)', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'WALK$', noid: 21, x: 40, y: 170, how: 1 })
  assert.equal(w.get(21).mod.x, 40)
  assert.equal(w.get(21).mod.y, 170)
})

test('PUT$ into avatar: the Naibor flashlight scenario', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Naibor (noid 21) picks the flashlight off the ground...
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  assert.equal(w.holding(21).name, 'Flashlight')
  assert.ok(!w.inRegion(30))
  // ...and puts it into SageBot's HANDS (cont = our avatar noid, y = 5).
  w.apply({ op: 'PUT$', noid: 21, obj: 30, cont: 17, x: 0, y: HANDS, how: 1, orient: 0 })
  assert.equal(w.holding(21), null)
  const held = w.holding(17)
  assert.ok(held, 'SageBot should know it is holding something')
  assert.equal(held.name, 'Flashlight')
  assert.equal(w.inventory(17).length, 2)
})

test('PUT$ to region drops at coordinates', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 17, target: 30, how: 0 })
  assert.equal(w.holding(17).noid, 30)
  // cont 0 = THE_REGION; x/y become screen coordinates again.
  w.apply({ op: 'PUT$', noid: 17, obj: 30, cont: 0, x: 88, y: 150, how: 0, orient: 1 })
  assert.equal(w.holding(17), null)
  assert.ok(w.inRegion(30))
  assert.equal(w.get(30).mod.x, 88)
  assert.equal(w.get(30).mod.orientation, 1)
})

test('GRABFROM$ moves item between avatar hands', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  // SageBot (noid 17) grabs from Naibor (avatar_noid 21).
  w.apply({ op: 'GRABFROM$', noid: 17, avatar_noid: 21 })
  assert.equal(w.holding(21), null)
  assert.equal(w.holding(17).noid, 30)
})

test('FIDDLE_$ pokes gr_state, orientation, and token denominations', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: ME_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-tokens-1', name: 'Tokens',
      mods: [{ type: 'Tokens', noid: 40, x: 0, y: 2, denom_lo: 10, denom_hi: 0 }],
    },
  })
  w.apply({ op: 'FIDDLE_$', noid: 0, target: 30, offset: 10, argCount: 1, value: 2 })
  assert.equal(w.get(30).mod.gr_state, 2)
  w.apply({ op: 'FIDDLE_$', noid: 0, target: 30, offset: 9, argCount: 1, value: 1 })
  assert.equal(w.get(30).mod.orientation, 1)
  // Token merge poke: 500 tokens = lo 244, hi 1 (HabitatMod.java:700)
  w.apply({ op: 'FIDDLE_$', noid: 0, target: 40, offset: 15, argCount: 2, value: [244, 1] })
  assert.equal(w.get(40).mod.denom_lo, 244)
  assert.equal(w.get(40).mod.denom_hi, 1)
})

test('GOAWAY_$ and delete remove objects', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GOAWAY_$', noid: 0, target: 30 })
  assert.equal(w.get(30), null)
  w.apply({ op: 'delete', to: NAIBOR_REF })
  assert.equal(w.avatars().length, 1)
})

test('CHANGELIGHT_$ adjusts region lighting', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'CHANGELIGHT_$', noid: 0, adjustment: 1 })
  assert.equal(w.region.lighting, 1)
  w.apply({ op: 'CHANGELIGHT_$', noid: 0, adjustment: -1 })
  assert.equal(w.region.lighting, 0)
})

test('changeContext clears everything for the next make storm', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ type: 'changeContext', context: 'context-elsewhere', immediate: true })
  assert.equal(w.avatars().length, 0)
  assert.equal(w.region.ref, '')
  assert.equal(w.me, null)
})

test('todo ops emit unhandledDelta instead of failing silently', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  let unhandled = null
  w.on('unhandledDelta', (msg) => { unhandled = msg })
  w.apply({ op: 'SIT$', noid: 17, up_or_down: 1, cont: 50, slot: 0 })
  assert.ok(unhandled)
  assert.equal(unhandled.op, 'SIT$')
})

test('unknown ops are ignored without throwing', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  assert.doesNotThrow(() => w.apply({ op: 'SOME_FUTURE_OP$', noid: 1 }))
})

test('THROW$ moves item from hands to region and clears orientation LSB', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 17, target: 30, how: 0 })
  assert.equal(w.holding(17).noid, 30)
  w.apply({ op: 'THROW$', noid: 17, obj: 30, x: 100, y: 160, hit: 0 })
  assert.equal(w.holding(17), null)
  assert.ok(w.inRegion(30))
  assert.equal(w.get(30).mod.x, 100)
  assert.equal(w.get(30).mod.y, 160)
  // orientation LSB should be clear after the throw
  assert.equal(w.get(30).mod.orientation & 1, 0)
})

test('WEAR$ moves item from hands to HEAD slot', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Put flashlight in Naibor's hands first, then have Naibor wear it
  // (unlikely in practice but valid for the state machine)
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  w.apply({ op: 'WEAR$', noid: 21 })
  assert.equal(w.holding(21), null) // no longer in HANDS
  const { HEAD: HEAD_SLOT } = require('../lib/constants')
  const worn = w.inventory(21).find((o) => o.mod.y === HEAD_SLOT)
  assert.ok(worn, 'item should be in HEAD slot')
  assert.equal(worn.noid, 30)
})

test('REMOVE$ moves item from HEAD slot back to HANDS', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  w.apply({ op: 'WEAR$', noid: 21 })
  w.apply({ op: 'REMOVE$', noid: 21, target: 30 })
  assert.equal(w.holding(21).noid, 30) // back in HANDS
})

test('OPEN$ and CLOSE$ update door open_flags', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Add a door to the region
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-door-1', name: 'Door',
      mods: [{ type: 'Door', noid: 50, x: 120, y: 130, orientation: 0, gr_state: 0, open_flags: 0 }] },
  })
  w.apply({ op: 'OPEN$', noid: 17, target: 50 })
  assert.equal(w.get(50).mod.open_flags, 3) // OPEN_BIT | UNLOCKED_BIT
  w.apply({ op: 'CLOSE$', noid: 17, target: 50, open_flags: 0 })
  assert.equal(w.get(50).mod.open_flags, 0)
})

test('OPENCONTAINER$ sets open_flags; CLOSECONTAINER$ purges contents', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Add a bag and a coin inside it
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-bag-1', name: 'Bag',
      mods: [{ type: 'Bag', noid: 60, x: 80, y: 140, orientation: 0, gr_state: 0, open_flags: 0 }] },
  })
  w.apply({ op: 'OPENCONTAINER$', noid: 17, cont: 60 })
  assert.equal(w.get(60).mod.open_flags, 3)
  // Contents arrive via make messages after OPENCONTAINER$
  w.apply({
    to: 'item-bag-1', op: 'make',
    obj: { type: 'item', ref: 'item-coin-1', name: 'Coin',
      mods: [{ type: 'Tokens', noid: 61, x: 0, y: 0, orientation: 0, gr_state: 0 }] },
  })
  assert.equal(w.contentsOf(60).length, 1)
  w.apply({ op: 'CLOSECONTAINER$', noid: 17, cont: 60, open_flags: 0 })
  assert.equal(w.get(60).mod.open_flags, 0)
  assert.equal(w.contentsOf(60).length, 0) // contents purged
  assert.equal(w.get(61), null)
})

test('CHANGE$ sets orientation on target object', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'CHANGE$', noid: 99, CHANGE_TARGET: 30, CHANGE_NEW_ORIENTATION: 2 })
  assert.equal(w.get(30).mod.orientation, 2)
})

test('ROLL$ sets gr_state on a die', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-die-1', name: 'Die',
      mods: [{ type: 'Die', noid: 70, x: 50, y: 150, orientation: 0, gr_state: 0 }] },
  })
  w.apply({ op: 'ROLL$', noid: 70, state: 5 })
  assert.equal(w.get(70).mod.gr_state, 5)
})

test('FILL$ and POUR$ toggle bottle state', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-bottle-1', name: 'Bottle',
      mods: [{ type: 'Bottle', noid: 80, x: 55, y: 145, orientation: 0, gr_state: 0, filled: 0 }] },
  })
  w.apply({ op: 'FILL$', noid: 80, AVATAR_NOID: 17 })
  assert.equal(w.get(80).mod.filled, 1)
  assert.equal(w.get(80).mod.gr_state, 1)
  w.apply({ op: 'POUR$', noid: 80, AVATAR_NOID: 17 })
  assert.equal(w.get(80).mod.filled, 0)
  assert.equal(w.get(80).mod.gr_state, 0)
})

test('SEXCHANGE$ toggles avatar body-type bit', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const before = w.get(21).mod.orientation
  w.apply({ op: 'SEXCHANGE$', noid: 99, AVATAR_NOID: 21 })
  assert.equal(w.get(21).mod.orientation, before ^ 0x100)
  w.apply({ op: 'SEXCHANGE$', noid: 99, AVATAR_NOID: 21 })
  assert.equal(w.get(21).mod.orientation, before) // toggle back
})

test('deleting an avatar cascades to its pocket contents (no ghost items)', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Hand Naibor the knick-knack: us GET, then observers' view of the give.
  w.apply({ op: 'GET$', noid: 17, target: 14, how: 1 })
  w.apply({ op: 'GRABFROM$', noid: 21, avatar_noid: 17 })
  assert.equal(w.holding(21).noid, 14)
  // Naibor leaves the region: his avatar AND the item he carries go.
  w.apply({ op: 'delete', to: NAIBOR_REF })
  assert.equal(w.get(21), null)
  assert.equal(w.get(14), null) // would orphan without the cascade
})
