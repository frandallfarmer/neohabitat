/* jshint esversion: 8 */

'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { HabitatWorld, constants, dispatch, behaviors, classes } = require('../index')
const {
  HANDS, ACTION_DO, ACTION_RDO, ACTION_GO, ACTION_GET, ACTION_PUT,
} = constants

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
    to: REGION_REF, op: 'make',
    obj: {
      type: 'user', ref: NAIBOR_REF, name: 'Naibor',
      mods: [{ type: 'Avatar', noid: 21, x: 100, y: 140, orientation: 0, gr_state: 0 }],
    },
  })
  world.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-frisbee-1', name: 'Frisbee',
      mods: [{ type: 'Frisbee', noid: 30, x: 60, y: 140, orientation: 0, gr_state: 0 }],
    },
  })
  world.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-street-1', name: 'Street',
      mods: [{ type: 'Street', noid: 50, x: 80, y: 160, orientation: 0, gr_state: 0 }],
    },
  })
}

function recorder(replies) {
  const calls = { walks: [], sends: [], waits: [], beeps: 0, boings: 0 }
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
      beep: () => { calls.beeps++ },
      boing: () => { calls.boings++ },
    },
  }
}

// ── the class table itself ──────────────────────────────────────────

test('class table: every class has the 8 user-verb slots and avatar has 31', () => {
  for (const [num, entry] of Object.entries(classes.classes)) {
    assert.ok(entry.actions.length >= 8,
      `class ${entry.name} (${num}) has only ${entry.actions.length} action slots`)
  }
  assert.equal(classes.classes[1].actions.length, 31) // avatar: slots 0-30
  assert.equal(classes.byTypeName.Door, 23)
  assert.equal(classes.byTypeName.Avatar, 1)
  assert.equal(classes.byTypeName.Region, 0)
})

test('class table: door verbs match new.mud', () => {
  assert.deepEqual(classes.classes[23].actions, [
    'generic_adjacentOpenClose', 'illegal', 'generic_goToOrPassThrough',
    'generic_cease', 'noEffect', 'generic_goToAndDropAt',
    'generic_broadcast', 'generic_destroy',
  ])
})

// ── dispatch basics ─────────────────────────────────────────────────

test('dispatch routes GET on an item through generic_goToAndGet', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const { calls, cb } = recorder()
  const result = await dispatch(w, ACTION_GET, 30, {}, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.walks, [{ x: 60, y: 140 }])
  assert.equal(calls.waits.length, 1)
  assert.deepEqual(calls.sends, [{ op: 'GET', to: 'item-frisbee-1' }])
  assert.equal(w.holding(17).noid, 30)
})

// ── reply-contract regressions (ground truth from a live capture in the
//    Testing Grounds: Spray_can.java replies with success/SPRAY_SUCCESS
//    and the customize bytes, never `err`) ────────────────────────────

// Hold a fresh spray can in the avatar's HANDS and give the avatar a
// two-byte custom pattern so respray effects are observable.
function withHeldSprayCan(w) {
  w.me.mod.custom = [0, 0]
  w.apply({
    to: ME_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-spray-1', name: 'Spray_can',
      mods: [{ type: 'Spray_can', noid: 95, x: 0, y: HANDS, orientation: 0, gr_state: 0 }],
    },
  })
}

test('spray_can DO success path: SPRAY_SUCCESS + SPRAY_CUSTOMIZE_* repaint the avatar', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  withHeldSprayCan(w)
  // Spray_can.java main-path reply shape.
  const { calls, cb } = recorder([
    { type: 'reply', noid: 95, SPRAY_SUCCESS: 1, SPRAY_CUSTOMIZE_0: 7, SPRAY_CUSTOMIZE_1: 8 },
  ])
  const result = await dispatch(w, ACTION_DO, 95, { limb: 2 }, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.sends, [{ op: 'SPRAY', to: 'item-spray-1', limb: 2 }])
  assert.deepEqual(w.me.mod.custom, [7, 8]) // new pattern applied
})

test('spray_can DO guard-failure: {success:0, custom_1, custom_2} beeps and leaves the pattern', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  withHeldSprayCan(w)
  w.me.mod.custom = [34, 129]
  // Exact guard-failure reply captured live (not holding the can / empty).
  const { cb } = recorder([
    { type: 'reply', noid: 95, success: 0, custom_1: 34, custom_2: 129 },
  ])
  const result = await dispatch(w, ACTION_DO, 95, { limb: 0 }, cb)
  assert.equal(result.ok, false) // beeped, not a false success
  assert.deepEqual(w.me.mod.custom, [34, 129]) // unchanged
})

test('dispatch on an unported behavior fails loudly with the .m name', async (t) => {
  // Find any class slot whose behavior hasn't been ported yet, so this
  // test keeps working as the port advances (and retires itself once
  // everything is ported).
  let found = null
  for (const entry of Object.values(classes.classes)) {
    if (entry.typeName === 'Region') continue // Region mods aren't object records
    entry.actions.forEach((name, slot) => {
      if (!found && !behaviors[name]) found = { typeName: entry.typeName, slot, name }
    })
    if (found) break
  }
  if (!found) return t.skip('all behaviors ported')

  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-unported-1', name: found.typeName,
      mods: [{ type: found.typeName, noid: 90, x: 50, y: 140, orientation: 0, gr_state: 0 }],
    },
  })
  const { cb } = recorder()
  const result = await dispatch(w, found.slot, 90, {}, cb)
  assert.equal(result.ok, false)
  assert.equal(result.reason, `unported:${found.name}`)
})

test('dispatch on an unknown server-only type uses the default item profile', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-ghost-1', name: 'Ghost',
      mods: [{ type: 'Ghost', noid: 60, x: 40, y: 140, orientation: 0, gr_state: 0 }],
    },
  })
  const { calls, cb } = recorder()
  const result = await dispatch(w, ACTION_GET, 60, {}, cb) // default get = goToAndGet
  assert.ok(result.ok)
  assert.equal(calls.sends[0].op, 'GET')
})

// ── the depends chain ───────────────────────────────────────────────

test('DO on the street while holding a frisbee falls through to generic_throw', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 17, target: 30, how: 1 }) // frisbee to HANDS
  const { calls, cb } = recorder([{ type: 'reply', err: 1, x: 120, y: 144 }])
  // street.do = generic_depends → rdo on in-hand frisbee = generic_throw,
  // with the street as subject (the THROW target surface).
  const result = await dispatch(w, ACTION_DO, 50, { x: 120, y: 144 }, cb)
  assert.ok(result.ok)
  assert.equal(calls.sends.length, 1)
  assert.equal(calls.sends[0].op, 'THROW')
  assert.equal(calls.sends[0].to, 'item-frisbee-1')
  assert.equal(calls.sends[0].target, 50) // subject = the street
  assert.equal(w.holding(17), null)
  assert.ok(w.inRegion(30))
  assert.equal(w.get(30).mod.x, 120)
})

test('DO on the street empty-handed depends to the avatar rdo (noEffect beep)', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const { calls, cb } = recorder()
  const result = await dispatch(w, ACTION_DO, 50, {}, cb)
  assert.equal(result.ok, false)
  assert.equal(calls.sends.length, 0)
  assert.equal(calls.beeps, 1) // avatar rdo = noEffect = v_beep
})

// ── avatar verbs ────────────────────────────────────────────────────

test('PUT at another avatar routes to avatar_put and hands the item over', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 17, target: 30, how: 1 })
  const { calls, cb } = recorder()
  const result = await dispatch(w, ACTION_PUT, 21, {}, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.walks, [{ x: 100, y: 140 }]) // avatar_go to Naibor
  assert.deepEqual(calls.sends, [{ op: 'HAND', to: NAIBOR_REF }])
  assert.equal(w.holding(21).noid, 30)
})

test('GET at another avatar routes to avatar_get and GRABs from their hands', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Put the frisbee in Naibor's hands.
  w.apply({ op: 'PUT$', noid: 17, obj: 30, cont: 21, x: 0, y: HANDS })
  const { calls, cb } = recorder()
  const result = await dispatch(w, ACTION_GET, 21, {}, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.sends, [{ op: 'GRAB', to: NAIBOR_REF }])
  assert.equal(w.holding(17).noid, 30)
  assert.equal(w.holding(21), null)
})

// ── internal slot chaining ──────────────────────────────────────────

test('GO on a wall-type Flat chains through trap_go to wall_go (slot 9)', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-wall-1', name: 'Flat',
      mods: [{ type: 'Flat', noid: 70, x: 100, y: 120, orientation: 0, gr_state: 0, flat_type: 1 }],
    },
  })
  const { calls, cb } = recorder()
  const result = await dispatch(w, ACTION_GO, 70, { x: 90 }, cb)
  assert.ok(result.ok)
  // wall_go: cursor x, y clamped to the wall's base
  assert.deepEqual(calls.walks, [{ x: 90, y: 120 }])
})

test('DO on a door routes to generic_adjacentOpenClose and toggles open', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-door-1', name: 'Door',
      mods: [{ type: 'Door', noid: 80, x: 16, y: 128, orientation: 0, gr_state: 0, open_flags: 2 }], // closed, unlocked
    },
  })
  const { calls, cb } = recorder()
  // Stand adjacent first so the punt-if-not-adjacent check passes.
  w.me.mod.x = 16
  w.me.mod.y = 128
  const result = await dispatch(w, ACTION_DO, 80, {}, cb)
  assert.ok(result.ok)
  assert.equal(calls.sends[0].op, 'OPEN')
  assert.ok(w.get(80).mod.open_flags & 1)
  // DO again: now open → toggles closed.
  const again = await dispatch(w, ACTION_DO, 80, {}, cb)
  assert.ok(again.ok)
  assert.equal(calls.sends[1].op, 'CLOSE')
  assert.equal(w.get(80).mod.open_flags & 1, 0)
})
