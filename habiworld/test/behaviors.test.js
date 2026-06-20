/* jshint esversion: 8 */

'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { HabitatWorld, constants, dispatch, behaviors, classes } = require('../index')
const { adjacentCoords } = require('../lib/behaviors/kernel')
const {
  HANDS, HEAD, THE_REGION, ACTION_DO, ACTION_RDO, ACTION_GO, ACTION_GET, ACTION_PUT,
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

test('class table: every object class has the 8 user-verb slots and avatar has 31', () => {
  // Region (0) carries no object action slots, and Zone (255) is a
  // server-side meta class with an empty action table — both legitimately
  // have fewer than 8 slots.
  const NO_VERB_SLOTS = new Set([0, 255])
  for (const [num, entry] of Object.entries(classes.classes)) {
    if (NO_VERB_SLOTS.has(Number(num))) continue
    assert.ok(entry.actions.length >= 8,
      `class ${entry.name} (${num}) has only ${entry.actions.length} action slots`)
  }
  assert.equal(classes.classes[1].actions.length, 31) // avatar: slots 0-30
  assert.equal(classes.byTypeName.Door, 23)
  assert.equal(classes.byTypeName.Avatar, 1)
  assert.equal(classes.byTypeName.Region, 0)
})

test('class table: door verbs match the canonical beta.mud', () => {
  // Canonical: PUT (slot 5) is noEffect — items aren't dropped onto a door.
  assert.deepEqual(classes.classes[23].actions, [
    'generic_adjacentOpenClose', 'illegal', 'generic_goToOrPassThrough',
    'generic_cease', 'noEffect', 'noEffect',
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
  assert.deepEqual(calls.walks, [{ x: 40, y: 139 }]) // frisbee's walk-offset spot
  assert.equal(calls.waits.length, 1)
  assert.deepEqual(calls.sends, [{ op: 'GET', to: 'item-frisbee-1' }])
  assert.equal(w.holding(17).noid, 30)
})

test('a standalone GO waits out the walk animation (post-GO waitWhile)', async () => {
  // The open/close tool and walk_to_object dispatch ACTION_GO on its own.
  // generic_goTo walks but doesn't wait (the C64 caller does that), so the
  // top-level dispatch must wait out the distance — otherwise the next step
  // (the OPEN, etc.) fires before the walk animation finishes.
  const w = new HabitatWorld()
  makeStorm(w)
  const { calls, cb } = recorder()
  await dispatch(w, ACTION_GO, 30, {}, cb) // frisbee, far from the avatar (12,142)
  assert.equal(calls.walks.length, 1)
  assert.equal(calls.waits.length, 1, 'a standalone GO must wait out the walk')
  assert.ok(calls.waits[0] > 0, 'the wait is distance-scaled, not zero')
})

test('ctx.walkTo ports goXY: startWalk then position update and moved', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const walks = []
  const moved = []
  w.on('moved', (rec) => moved.push(rec.noid))
  const { cb } = recorder()
  cb.walkTo = async (x, y) => ({ x: 80, y: 130, how: 1 })
  cb.startWalk = (noid, x, y, how) => walks.push({ noid, x, y, how })
  await dispatch(w, ACTION_GO, 30, {}, cb)
  assert.deepEqual(walks, [{ noid: 17, x: 80, y: 130, how: 1 }])
  assert.equal(w.me.mod.x, 80)
  assert.equal(w.me.mod.y, 130)
  assert.deepEqual(moved, [17])
})

test('nested GO does not double-wait (goToAndGet waits exactly once)', async () => {
  // generic_goToAndGet does doAction(ACTION_GO) then waitWalkAnimation in one
  // chain; the top-level post-walk wait must NOT add a second wait.
  const w = new HabitatWorld()
  makeStorm(w)
  const { calls, cb } = recorder()
  await dispatch(w, ACTION_GET, 30, {}, cb)
  assert.equal(calls.waits.length, 1, 'exactly one wait, no double-wait')
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

test('spray_can DO via avatar_do passes pointedAtLimb as limb (pointer.m which_limb)', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  withHeldSprayCan(w)
  const { calls, cb } = recorder([
    { type: 'reply', noid: 95, SPRAY_SUCCESS: 1, SPRAY_CUSTOMIZE_0: 7, SPRAY_CUSTOMIZE_1: 8 },
  ])
  const result = await dispatch(w, ACTION_DO, 17, { limb: 2 }, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.sends, [{ op: 'SPRAY', to: 'item-spray-1', limb: 2 }])
})

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

test('spray_can DO emits fieldChanged so renderers repaint body paint', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  withHeldSprayCan(w)
  let fieldChanged = 0
  w.on('fieldChanged', () => { fieldChanged++ })
  const { cb } = recorder([
    { type: 'reply', noid: 95, SPRAY_SUCCESS: 1, SPRAY_CUSTOMIZE_0: 3, SPRAY_CUSTOMIZE_1: 4 },
  ])
  await dispatch(w, ACTION_DO, 95, { limb: 1 }, cb)
  assert.equal(fieldChanged, 1)
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
  // Sidewalk is a real server class (151) that the canonical .mud client
  // table doesn't carry — so it exercises the DEFAULT_ITEM_ACTIONS fallback.
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-sidewalk-1', name: 'Sidewalk',
      mods: [{ type: 'Sidewalk', noid: 60, x: 40, y: 140, orientation: 0, gr_state: 0 }],
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
  assert.deepEqual(calls.walks, [{ x: 80, y: 140 }]) // avatar_go to Naibor's walk-offset spot
  assert.deepEqual(calls.sends, [{ op: 'HAND', to: NAIBOR_REF }])
  assert.equal(w.holding(21).noid, 30)
})

test('PUT at MYSELF pockets the held item (avatar_put its_me) — no walk, no HAND', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 17, target: 30, how: 1 }) // frisbee into our HANDS
  assert.equal(w.holding(17).noid, 30)
  // Server assigns pocket slot 7 in the PUT reply.
  const { calls, cb } = recorder([{ type: 'reply', err: 1, pos: 7 }])
  const result = await dispatch(w, ACTION_PUT, 17, {}, cb) // PUT pointing at self
  assert.ok(result.ok)
  assert.deepEqual(calls.walks, []) // pocketing doesn't walk
  assert.equal(calls.sends.length, 1)
  assert.equal(calls.sends[0].op, 'PUT')
  assert.equal(calls.sends[0].containerNoid, 17) // into our own avatar
  assert.equal(w.holding(17), null) // HANDS now empty
  assert.equal(w.get(30).mod.y, 7) // item landed in the server-assigned pocket slot
})

test('PUT a held head at MYSELF wears it when the HEAD slot is free', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-head-cat', name: 'cat head',
      mods: [{ type: 'Head', noid: 60, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(60, 17, 0, HANDS) // cat head in our HANDS
  const { calls, cb } = recorder([{ type: 'reply', noid: 60, err: 1 }])
  const result = await dispatch(w, ACTION_PUT, 17, {}, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.sends, [{ op: 'WEAR', to: 'item-head-cat' }]) // worn, not pocketed
  assert.equal(w.get(60).mod.y, HEAD) // moved into the HEAD slot
})

test('PUT on street with held head uses goXY cursor depth (y|0x80) for walk and drop', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-head-randy', name: 'Randy head',
      mods: [{ type: 'Head', noid: 70, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(70, 17, 0, HANDS)
  const { calls, cb } = recorder([{ type: 'reply', err: 1, pos: 11 }])
  cb.walkTo = async (x, y) => { calls.walks.push({ x, y }); return { x, y } }
  const result = await dispatch(w, ACTION_PUT, 50, { x: 116, y: 11 }, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.walks, [{ x: 116, y: 139 }])
  assert.equal(calls.sends[0].op, 'PUT')
  assert.equal(calls.sends[0].containerNoid, THE_REGION)
  assert.equal(calls.sends[0].x, 116)
  assert.equal(calls.sends[0].y, 139)
  assert.equal(w.holding(17), null)
})

test('PUT a 2nd head at MYSELF pockets it when already wearing one', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // cat head already worn …
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-head-cat', name: 'cat head',
      mods: [{ type: 'Head', noid: 60, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(60, 17, 0, HEAD)
  // … angel head in HANDS.
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-head-angel', name: 'angel head',
      mods: [{ type: 'Head', noid: 61, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(61, 17, 0, HANDS)
  // Server assigns pocket slot 1 in the PUT reply (HEAD slot is taken).
  const { calls, cb } = recorder([{ type: 'reply', noid: 61, err: 1, pos: 1 }])
  const result = await dispatch(w, ACTION_PUT, 17, {}, cb)
  assert.ok(result.ok)
  assert.equal(calls.sends[0].op, 'PUT') // pocketed, not WEAR
  assert.equal(calls.sends[0].containerNoid, 17)
  assert.notEqual(w.get(61).mod.y, HEAD) // angel did NOT land on the head
  assert.equal(w.get(61).mod.y, 1) // it's in the server-assigned pocket slot
  assert.equal(w.get(60).mod.y, HEAD) // cat still worn
})

test('GET at another avatar routes to avatar_get and GRABs from their hands', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Put the frisbee in Naibor's hands.
  w.apply({ op: 'PUT$', noid: 17, obj: 30, cont: 21, x: 0, y: HANDS })
  // Avatar.GRAB replies { item_noid: N } via send_reply_msg — N=frisbee's noid.
  const { calls, cb } = recorder([{ type: 'reply', item_noid: 30 }])
  const result = await dispatch(w, ACTION_GET, 21, {}, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.sends, [{ op: 'GRAB', to: NAIBOR_REF }])
  assert.equal(w.holding(17).noid, 30)
  assert.equal(w.holding(21), null)
})

// ── game state (gr_state owned by the behavior, not the bot layer) ──

test('DO on a die rolls it: die_do sends ROLL, relays the value, sets gr_state', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-die-1', name: 'Die',
      mods: [{ type: 'Die', noid: 40, x: 42, y: 140, orientation: 0, gr_state: 6, state: 6 }] } })
  // No real server here: the recorder MOCKS the ROLL reply, so the rolled
  // face is whatever we inject (the server's own RNG, Die.java's
  // rand.nextInt, is out of scope for this unit test). Die.java replies
  // ROLL_STATE only to the roller (ROLL$ goes to neighbors), so die_do must
  // apply the new gr_state itself off the reply. gr_state starts at 6.
  const { calls, cb } = recorder([{ type: 'reply', noid: 40, ROLL_STATE: 4 }])
  const result = await dispatch(w, ACTION_DO, 40, {}, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.sends, [{ op: 'ROLL', to: 'item-die-1' }])
  assert.equal(result.value, 4) // value relayed to the caller (rollDie) from ROLL_STATE
  // Model state is set FROM the relayed value (not a coincidental literal),
  // and it changed from the die's initial face (6).
  assert.equal(w.get(40).mod.gr_state, result.value)
  assert.notEqual(result.value, 6)
})

test('GET on own worn head dispatches REMOVE via head_get', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-head-cat', name: 'cat head',
      mods: [{ type: 'Head', noid: 60, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(60, 17, 0, HEAD)
  const { calls, cb } = recorder([{ type: 'reply', err: 1 }])
  const result = await dispatch(w, ACTION_GET, 60, {}, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.sends, [{ op: 'REMOVE', to: 'item-head-cat' }])
  assert.equal(w.holding(17).noid, 60)
})

test('GET at MYSELF with face limb redirects to head_get REMOVE', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-head-cat', name: 'cat head',
      mods: [{ type: 'Head', noid: 60, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(60, 17, 0, HEAD)
  const { calls, cb } = recorder([{ type: 'reply', err: 1 }])
  const result = await dispatch(w, ACTION_GET, 17, { pointedAtLimb: 3 }, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.sends, [{ op: 'REMOVE', to: 'item-head-cat' }])
  assert.equal(w.holding(17).noid, 60)
})

test('GET at MYSELF unpockets the named item (avatar_get its_me) — GET on the item, no REMOVE', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // A head sitting in my OWN pocket (slot 1). This is the case head_get
  // can't handle (it would send REMOVE and beep) — the canonical path is
  // GET pointed at myself, which sends GET on the item so the server
  // unpockets it (head GET → head_WEAR → generic_GET for own pocket).
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-head-sheriff', name: 'Sherif Head',
      mods: [{ type: 'Head', noid: 62, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(62, 17, 0, 1) // pocket slot 1
  const { calls, cb } = recorder([{ type: 'reply', noid: 62, err: 1 }])
  const result = await dispatch(w, ACTION_GET, 17, { item: 62 }, cb) // GET at self
  assert.ok(result.ok)
  assert.deepEqual(calls.walks, []) // no walk — it's in my pocket
  assert.deepEqual(calls.sends, [{ op: 'GET', to: 'item-head-sheriff' }]) // GET, not REMOVE
  assert.equal(w.holding(17).noid, 62) // head now in HANDS
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

test('DO on a plaque sends READ with page and decodes ascii reply', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-plaque-1', name: 'Plaque',
      mods: [{ type: 'Plaque', noid: 85, x: 56, y: 128, orientation: 0, gr_state: 0 }] } })
  // Reply carries ascii byte array (PETSCII) + nextpage
  const ascii = [72, 101, 108, 108, 111, 10, 87, 111, 114, 108, 100] // "Hello\nWorld"
  const { calls, cb } = recorder([{ type: 'reply', ascii, nextpage: 2 }])
  const result = await dispatch(w, ACTION_DO, 85, { page: 1 }, cb)
  assert.ok(result.ok)
  assert.deepEqual(calls.sends, [{ op: 'READ', to: 'item-plaque-1', page: 1 }])
  assert.equal(result.text, 'Hello\nWorld')
  assert.equal(result.page, 2) // next page cursor
})

test('DO on a pawn machine sends MUNCH and purges its contents on success', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // The machine sits at x=56 (bot's x=12 so it must walk adjacent first).
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-pawn-1', name: 'Pawn Machine',
      mods: [{ type: 'Pawn_machine', noid: 90, x: 56, y: 140, orientation: 0, gr_state: 0 }] } })
  // Synthetic contents: two items inside the machine (the items it will munch).
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-widget-1', name: 'Widget',
      mods: [{ type: 'Frisbee', noid: 91, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-widget-2', name: 'Widget2',
      mods: [{ type: 'Frisbee', noid: 92, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(91, 90, 0, 0)
  w._changeContainers(92, 90, 0, 1)
  assert.equal(w.contentsOf(90).length, 2)

  const { calls, cb } = recorder([
    { type: 'reply', MUNCH_SUCCESS: 1 }, // MUNCH (Pawn_machine.java: send_reply_msg, no err field)
  ])
  const result = await dispatch(w, ACTION_DO, 90, {}, cb)
  assert.ok(result.ok)
  assert.ok(calls.sends.some(s => s.op === 'MUNCH'))
  // Contents purged from world model — tokens arrive later via MAKE
  assert.equal(w.contentsOf(90).length, 0)
  assert.equal(w.get(91), undefined)
  assert.equal(w.get(92), undefined)
})

test('MUNCH$ plays PAWN_MUNCH for neighbors', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-pawn-2', name: 'Pawn Machine',
      mods: [{ type: 'Pawn_machine', noid: 95, x: 56, y: 140, orientation: 0, gr_state: 0 }] } })
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'MUNCH$', noid: 95 })
  assert.deepEqual(sounds, [{ name: 'PAWN_MUNCH', noid: 95 }])
})

test('OPEN$ plays EXIT_OPENING for neighbor actors', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-door-1', name: 'Door',
      mods: [{ type: 'Door', noid: 50, x: 120, y: 130, orientation: 0, gr_state: 0, open_flags: 0 }] },
  })
  const sounds = []
  const chores = []
  w.setClient({
    sound: (name, noid) => sounds.push({ name, noid }),
    chore: (act, noid) => chores.push({ act, noid }),
  })
  w.apply({ op: 'OPEN$', noid: 21, target: 50 })
  assert.deepEqual(sounds, [{ name: 'EXIT_OPENING', noid: 50 }])
  assert.equal(w.get(50).mod.open_flags, 3)
  assert.equal(w.get(50).mod.gr_state, 1)
  assert.deepEqual(chores, [{ act: 'hand_out', noid: 21 }, { act: 'hand_back', noid: 21 }])
})

test('OPEN$ skips inbound sound when the actor is me', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-door-2', name: 'Door',
      mods: [{ type: 'Door', noid: 51, x: 120, y: 130, orientation: 0, gr_state: 0, open_flags: 0 }] },
  })
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'OPEN$', noid: 17, target: 51 })
  assert.equal(sounds.length, 0)
  assert.equal(w.get(51).mod.open_flags, 3)
})

test('CLOSE$ plays EXIT_CLOSING for neighbor actors', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-door-3', name: 'Door',
      mods: [{ type: 'Door', noid: 52, x: 120, y: 130, orientation: 0, gr_state: 0, open_flags: 3 }] },
  })
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'CLOSE$', noid: 21, target: 52, open_flags: 0 })
  assert.deepEqual(sounds, [{ name: 'EXIT_CLOSING', noid: 52 }])
  assert.equal(w.get(52).mod.open_flags, 0)
})

test('OPENCONTAINER$ plays CONTAINER_OPENING for neighbor actors', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-bag-1', name: 'Bag',
      mods: [{ type: 'Bag', noid: 60, x: 80, y: 140, orientation: 0, gr_state: 0, open_flags: 0 }] },
  })
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'OPENCONTAINER$', noid: 21, cont: 60 }) // Naibor (not me)
  assert.deepEqual(sounds, [{ name: 'CONTAINER_OPENING', noid: 60 }])
  assert.equal(w.get(60).mod.open_flags, 3)
})

test('OPENCONTAINER$ skips inbound sound when the actor is me', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-bag-2', name: 'Bag',
      mods: [{ type: 'Bag', noid: 62, x: 80, y: 140, orientation: 0, gr_state: 0, open_flags: 0 }] },
  })
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'OPENCONTAINER$', noid: 17, cont: 62 }) // SageBot / me
  assert.equal(sounds.length, 0)
})

test('WALK$ dispatches avatar_WALK: startWalk then position update', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const walks = []
  w.setClient({ startWalk: (noid, x, y, how) => walks.push({ noid, x, y, how }) })
  w.apply({ op: 'WALK$', noid: 21, x: 40, y: 170, how: 1 })
  assert.deepEqual(walks, [{ noid: 21, x: 40, y: 170, how: 1 }])
  assert.equal(w.get(21).mod.x, 40)
  assert.equal(w.get(21).mod.y, 170)
})

test('POSTURE$ STAND_FRONT updates neighbor activity without chore', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const chores = []
  w.setClient({ chore: (act, noid) => chores.push({ act, noid }) })
  w.apply({ op: 'POSTURE$', noid: 21, new_posture: 146 })
  assert.equal(w.get(21).mod.activity, 146)
  assert.equal(chores.length, 0)
})

test('POSTURE$ wave plays transient chore for a neighbor', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.get(21).mod.activity = 254
  const chores = []
  w.setClient({ chore: (act, noid) => chores.push({ act, noid }) })
  w.apply({ op: 'POSTURE$', noid: 21, new_posture: 141 })
  assert.equal(w.get(21).mod.activity, 254) // unchanged — wave is choreography-only
  assert.deepEqual(chores, [{ act: 'wave', noid: 21 }])
})

function withHeldGun(w, avatarNoid = 21) {
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-gun-1', name: 'Gun',
      mods: [{ type: 'Gun', noid: 70, x: 0, y: HANDS, orientation: 0, gr_state: 0 }],
    },
  })
  w._changeContainers(70, avatarNoid, 0, HANDS)
}

test('ATTACK$ gun shot chore and victim get_shot on hit', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  withHeldGun(w, 21)
  const chores = []
  const sounds = []
  w.setClient({
    chore: (act, noid) => chores.push({ act, noid }),
    sound: (name, noid) => sounds.push({ name, noid }),
  })
  w.apply({ op: 'ATTACK$', noid: 21, ATTACK_TARGET: 17, ATTACK_DAMAGE: 2 })
  assert.deepEqual(chores, [
    { act: 'shoot1', noid: 21 },
    { act: 'shoot2', noid: 21 },
    { act: 'get_shot', noid: 17 },
  ])
  assert.deepEqual(sounds, [{ name: 'GUNSHOT', noid: 21 }])
})

test('ATTACK$ miss plays attacker chore only', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const chores = []
  w.setClient({ chore: (act, noid) => chores.push({ act, noid }) })
  w.apply({ op: 'ATTACK$', noid: 21, ATTACK_TARGET: 17, ATTACK_DAMAGE: 0 })
  assert.deepEqual(chores, [{ act: 'punch', noid: 21 }])
})

test('BASH$ plays attack chore for a neighbor', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  withHeldGun(w, 21)
  const chores = []
  const sounds = []
  w.setClient({
    chore: (act, noid) => chores.push({ act, noid }),
    sound: (name, noid) => sounds.push({ name, noid }),
  })
  w.apply({ op: 'BASH$', noid: 21, BASH_TARGET: 50, BASH_SUCCESS: 0 })
  assert.deepEqual(chores, [
    { act: 'shoot1', noid: 21 },
    { act: 'shoot2', noid: 21 },
  ])
  assert.deepEqual(sounds, [{ name: 'GUNSHOT', noid: 21 }])
})

test('SPEAK$ shows a word balloon', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const balloons = []
  w.setClient({ balloon: (text) => balloons.push(text) })
  w.apply({ op: 'SPEAK$', noid: 21, text: 'Hello, neighbor!' })
  assert.deepEqual(balloons, ['Hello, neighbor!'])
})

test('PLAY_$ resolves region sfx_number via from_noid', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'PLAY_$', noid: THE_REGION, from_noid: THE_REGION, sfx_number: 8 })
  assert.deepEqual(sounds, [{ name: 'teleport_arrival', noid: THE_REGION }])
})

test('OBJECTSPEAK_$ shows a word balloon', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const balloons = []
  w.setClient({ balloon: (text) => balloons.push(text) })
  w.apply({ op: 'OBJECTSPEAK_$', noid: THE_REGION, text: 'It is locked.', speaker: 1 })
  assert.deepEqual(balloons, ['It is locked.'])
})

test('DIG$ bend_over/DIGGING/bend_back for a neighbor avatar', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const chores = []
  const sounds = []
  w.setClient({
    chore: (act, noid) => chores.push({ act, noid }),
    sound: (name, noid) => sounds.push({ name, noid }),
  })
  w.apply({ op: 'DIG$', noid: 21 })
  assert.deepEqual(chores, [
    { act: 'bend_over', noid: 21 },
    { act: 'bend_back', noid: 21 },
  ])
  assert.deepEqual(sounds, [{ name: 'DIGGING', noid: 21 }])
})

test('TAKE$ hand_out/hand_back for a neighbor taking a dose', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const chores = []
  w.setClient({ chore: (act, noid) => chores.push({ act, noid }) })
  w.apply({ op: 'TAKE$', noid: 21, count: 2 })
  assert.deepEqual(chores, [
    { act: 'hand_out', noid: 21 },
    { act: 'hand_back', noid: 21 },
  ])
})

test('BUGOUT$ plays ESCAPE_DEVICE_ACTIVATES for a neighbor', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-escape-1', name: 'Escape_device',
      mods: [{ type: 'Escape_device', noid: 71, x: 0, y: HANDS, orientation: 0, gr_state: 0, charge: 1 }],
    },
  })
  w._changeContainers(71, 21, 0, HANDS)
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'BUGOUT$', noid: 21 })
  assert.deepEqual(sounds, [{ name: 'ESCAPE_DEVICE_ACTIVATES', noid: 71 }])
})

test('WISH$ plays MAGIC and shows WISH_MESSAGE balloon', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-lamp-1', name: 'Magic_lamp',
      mods: [{ type: 'Magic_lamp', noid: 72, x: 80, y: 140, orientation: 0, gr_state: 1 }],
    },
  })
  const sounds = []
  const balloons = []
  w.setClient({
    sound: (name, noid) => sounds.push({ name, noid }),
    balloon: (text) => balloons.push(text),
  })
  w.apply({ op: 'WISH$', noid: 72, WISH_MESSAGE: 'Very well, I\'ll see what I can do.' })
  assert.deepEqual(sounds, [{ name: 'MAGIC', noid: 72 }])
  assert.deepEqual(balloons, ['Very well, I\'ll see what I can do.'])
})

test('SIT$ moves avatar into seat container on sit down', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-chair-1', name: 'Chair',
      mods: [{ type: 'Chair', noid: 75, x: 90, y: 140, orientation: 0, gr_state: 0 }],
    },
  })
  w.apply({ op: 'SIT$', noid: 21, up_or_down: 1, cont: 75, slot: 2 })
  assert.equal(w.get(21).containerRef, 'item-chair-1')
  assert.equal(w.get(21).mod.y, 2)
})

test('ON$ on a flashlight updates gr_state and region lighting', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: {
      type: 'item', ref: 'item-flash-1', name: 'Flashlight',
      mods: [{ type: 'Flashlight', noid: 76, x: 60, y: 140, orientation: 0, gr_state: 0, on: 0 }],
    },
  })
  w.apply({ op: 'ON$', noid: 76 })
  assert.equal(w.get(76).mod.on, 1)
  assert.equal(w.get(76).mod.gr_state, 1)
  assert.equal(w.region.lighting, 1)
})

test('APPEARING_$ and WAITFOR_$ are choreography no-ops', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  let calls = 0
  w.setClient({
    chore: () => { calls++ },
    sound: () => { calls++ },
    balloon: () => { calls++ },
  })
  w.apply({ op: 'APPEARING_$', noid: THE_REGION, appearing: 21 })
  w.apply({ op: 'WAITFOR_$', noid: THE_REGION, who: 21 })
  assert.equal(calls, 0)
})

test('GET$ bend_over/bend_back for ground pickup by a neighbor', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const chores = []
  w.setClient({ chore: (act, noid) => chores.push({ act, noid }) })
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  assert.equal(w.holding(21).noid, 30)
  assert.deepEqual(chores, [
    { act: 'bend_over', noid: 21 },
    { act: 'bend_back', noid: 21 },
  ])
})

test('GET$ unpocket/stand for pocket retrieval by a neighbor', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  const chores = []
  w.setClient({ chore: (act, noid) => chores.push({ act, noid }) })
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 1 })
  assert.equal(w.holding(21).noid, 30)
  assert.deepEqual(chores, [
    { act: 'unpocket', noid: 21 },
    { act: 'stand', noid: 21 },
  ])
})

test('PUT$ bend_over/bend_back when dropping to the region', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  const chores = []
  w.setClient({ chore: (act, noid) => chores.push({ act, noid }) })
  w.apply({ op: 'PUT$', noid: 21, obj: 30, cont: 0, x: 88, y: 150, how: 0, orient: 1 })
  assert.equal(w.holding(21), null)
  assert.ok(w.inRegion(30))
  assert.deepEqual(chores, [
    { act: 'bend_over', noid: 21 },
    { act: 'bend_back', noid: 21 },
  ])
})

test('GRABFROM$ hand_out/hand_back when grabbing from another avatar', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  const chores = []
  w.setClient({ chore: (act, noid) => chores.push({ act, noid }) })
  w.apply({ op: 'GRABFROM$', noid: 17, avatar_noid: 21 })
  assert.equal(w.holding(17).noid, 30)
  assert.deepEqual(chores, [
    { act: 'hand_out', noid: 17 },
    { act: 'hand_back', noid: 17 },
  ])
})

test('THROW$ throw/hand_back and clears orientation LSB', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  w.get(30).mod.orientation = 3
  const chores = []
  w.setClient({ chore: (act, noid) => chores.push({ act, noid }) })
  w.apply({ op: 'THROW$', noid: 21, obj: 30, x: 100, y: 160, hit: 0 })
  assert.equal(w.holding(21), null)
  assert.equal(w.get(30).mod.orientation, 2)
  assert.deepEqual(chores, [
    { act: 'throw', noid: 21 },
    { act: 'hand_back', noid: 21 },
  ])
})

test('WEAR$ plays CLOTHES_DONNED for neighbor actors', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  const sounds = []
  const chores = []
  w.setClient({
    sound: (name, noid) => sounds.push({ name, noid }),
    chore: (act, noid) => chores.push({ act, noid }),
  })
  w.apply({ op: 'WEAR$', noid: 21 })
  assert.deepEqual(sounds, [{ name: 'CLOTHES_DONNED', noid: 21 }])
  assert.deepEqual(chores, [{ act: 'stand', noid: 21 }])
  const worn = w.inventory(21).find((o) => o.mod.y === HEAD)
  assert.equal(worn.noid, 30)
})

test('WEAR$ skips inbound sound when the actor is me', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 17, target: 30, how: 0 })
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'WEAR$', noid: 17 })
  assert.equal(sounds.length, 0)
  const worn = w.inventory(17).find((o) => o.mod.y === HEAD)
  assert.equal(worn.noid, 30)
})

test('REMOVE$ plays CLOTHES_DOFFED for neighbor actors', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'GET$', noid: 21, target: 30, how: 0 })
  w.apply({ op: 'WEAR$', noid: 21 })
  const sounds = []
  const chores = []
  w.setClient({
    sound: (name, noid) => sounds.push({ name, noid }),
    chore: (act, noid) => chores.push({ act, noid }),
  })
  w.apply({ op: 'REMOVE$', noid: 21, target: 30 })
  assert.deepEqual(sounds, [{ name: 'CLOTHES_DOFFED', noid: 21 }])
  assert.deepEqual(chores, [{ act: 'stand', noid: 21 }])
  assert.equal(w.holding(21).noid, 30)
})

test('FLUSH$ plays GARBAGE_FLUSH and purges can contents', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-trash-1', name: 'Garbage_can',
      mods: [{ type: 'Garbage_can', noid: 65, x: 80, y: 140, orientation: 0, gr_state: 0, open_flags: 3 }] } })
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-junk-1', name: 'Junk',
      mods: [{ type: 'Frisbee', noid: 66, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(66, 65, 0, 0)
  assert.equal(w.contentsOf(65).length, 1)
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'FLUSH$', noid: 65 })
  assert.deepEqual(sounds, [{ name: 'GARBAGE_FLUSH', noid: 65 }])
  assert.equal(w.contentsOf(65).length, 0)
  assert.equal(w.get(66), null)
})

test('DO on a garbage can sends FLUSH and plays GARBAGE_FLUSH', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-trash-2', name: 'Garbage_can',
      mods: [{ type: 'Garbage_can', noid: 75, x: 80, y: 140, orientation: 0, gr_state: 0, open_flags: 3 }] } })
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-junk-2', name: 'Junk',
      mods: [{ type: 'Frisbee', noid: 76, x: 0, y: 0, orientation: 0, gr_state: 0 }] } })
  w._changeContainers(76, 75, 0, 0)
  const spot = adjacentCoords(w, 75)
  w.me.mod.x = spot.x
  w.me.mod.y = spot.y
  const sounds = []
  const { calls, cb } = recorder([{ type: 'reply', err: 1 }])
  cb.sound = (name, noid) => sounds.push({ name, noid })
  const result = await dispatch(w, ACTION_DO, 75, {}, cb)
  assert.ok(result.ok)
  assert.equal(calls.sends[0].op, 'FLUSH')
  assert.deepEqual(sounds, [{ name: 'GARBAGE_FLUSH', noid: 75 }])
  assert.equal(w.contentsOf(75).length, 0)
})

test('DO on a bag plays CONTAINER_OPENING after a successful OPENCONTAINER reply', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({
    to: REGION_REF, op: 'make',
    obj: { type: 'item', ref: 'item-bag-3', name: 'Bag',
      mods: [{ type: 'Bag', noid: 70, x: 80, y: 140, orientation: 0, gr_state: 0, open_flags: 2 }] }, // closed, unlocked
  })
  const spot = adjacentCoords(w, 70)
  w.me.mod.x = spot.x
  w.me.mod.y = spot.y
  const sounds = []
  const { calls, cb } = recorder([{ type: 'reply', err: 1 }])
  cb.sound = (name, noid) => sounds.push({ name, noid })
  const result = await dispatch(w, ACTION_DO, 70, {}, cb)
  assert.ok(result.ok)
  assert.equal(calls.sends[0].op, 'OPENCONTAINER')
  assert.deepEqual(sounds, [{ name: 'CONTAINER_OPENING', noid: 70 }])
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
  const chores = []
  const { calls, cb } = recorder()
  cb.chore = (act, noid) => chores.push({ act, noid })
  // Stand adjacent first so the punt-if-not-adjacent check passes.
  w.me.mod.x = 16
  w.me.mod.y = 128
  const result = await dispatch(w, ACTION_DO, 80, {}, cb)
  assert.ok(result.ok)
  assert.equal(calls.sends[0].op, 'OPEN')
  assert.ok(w.get(80).mod.open_flags & 1)
  assert.equal(w.get(80).mod.gr_state, 1)
  assert.deepEqual(chores, [
    { act: 'hand_out', noid: 17 },
    { act: 'hand_back', noid: 17 },
  ])
  // DO again: now open → toggles closed.
  const again = await dispatch(w, ACTION_DO, 80, {}, cb)
  assert.ok(again.ok)
  assert.equal(calls.sends[1].op, 'CLOSE')
  assert.equal(w.get(80).mod.open_flags & 1, 0)
  assert.equal(w.get(80).mod.gr_state, 0)
  assert.deepEqual(chores.slice(2), [
    { act: 'hand_out', noid: 17 },
    { act: 'hand_back', noid: 17 },
  ])
})

// ── vendo machine ───────────────────────────────────────────────────

// Build a minimal vendo world: vendo_inside (noid 110) contains vendo_front
// (noid 111) and the current display item (coke at slot 1). vendo_front holds
// two inventory items: a coke at slot 0 and a pretzel at slot 2.
function makeVendo(world) {
  // vendo_inside: container of the whole unit
  world.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-vendo-inside', name: 'Vendo Inside',
      mods: [{ type: 'Vendo_inside', noid: 110, x: 150, y: 140 }] } })
  // vendo_front: contained by vendo_inside
  world.apply({ op: 'make', to: 'item-vendo-inside',
    obj: { type: 'item', ref: 'item-vendo-front', name: 'Vendo Front',
      mods: [{ type: 'Vendo_front', noid: 111, x: 0, y: 0, display_item: 0, item_price: 5 }] } })
  // Display item (coke at slot 0) currently in vendo_inside at slot 1
  world.apply({ op: 'make', to: 'item-vendo-inside',
    obj: { type: 'item', ref: 'item-coke-display', name: 'Coke',
      mods: [{ type: 'Coke', noid: 112, x: 0, y: 1 }] } })
  // Inventory items inside vendo_front: pretzel at slot 2
  world.apply({ op: 'make', to: 'item-vendo-front',
    obj: { type: 'item', ref: 'item-pretzel', name: 'Pretzel',
      mods: [{ type: 'Pretzel', noid: 113, x: 0, y: 2 }] } })
}

test('vendo_do VSELECT: swaps display item and updates price balloon', async () => {
  const w = new HabitatWorld()
  makeStorm(w)
  makeVendo(w)
  // Stand adjacent to the vendo front
  w.me.mod.x = 150; w.me.mod.y = 140
  const { calls, cb } = recorder([
    { type: 'reply', display_item: 2, price_lo: 8, price_hi: 0 }, // VSELECT reply
  ])
  const result = await dispatch(w, ACTION_DO, 111, {}, cb)
  assert.ok(result.ok)
  assert.equal(result.displayItem, 2)
  assert.equal(result.price, 8)

  // VSELECT was sent to the vendo_front
  assert.ok(calls.sends.some(s => s.op === 'VSELECT' && s.to === 'item-vendo-front'))

  // Old display item (coke, noid 112) moved back to vendo_front at slot 0
  assert.equal(w.get(112).containerRef, 'item-vendo-front')
  assert.equal(w.get(112).mod.y, 0)

  // New display item (pretzel, noid 113) moved to vendo_inside at slot 1
  assert.equal(w.get(113).containerRef, 'item-vendo-inside')
  assert.equal(w.get(113).mod.y, 1)

  // vendo_front fields updated
  assert.equal(w.get(111).mod.display_item, 2)
  assert.equal(w.get(111).mod.item_price, 8)
})

test('VSELECT$ delta: observer sees same container swap', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  makeVendo(w)
  w.apply({ op: 'VSELECT$', noid: 111, display_item: 2, price_lo: 8, price_hi: 0 })

  assert.equal(w.get(112).containerRef, 'item-vendo-front') // coke back in front at slot 0
  assert.equal(w.get(112).mod.y, 0)
  assert.equal(w.get(113).containerRef, 'item-vendo-inside') // pretzel now on display
  assert.equal(w.get(113).mod.y, 1)
  assert.equal(w.get(111).mod.display_item, 2)
  assert.equal(w.get(111).mod.item_price, 8)
})

test('VSELECT$ plays VENDO_CHANGING for observers', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  makeVendo(w)
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'VSELECT$', noid: 111, display_item: 2, price_lo: 8, price_hi: 0 })
  assert.deepEqual(sounds, [{ name: 'VENDO_CHANGING', noid: 111 }])
})

// ── payment deltas ──────────────────────────────────────────────────

test('PAY$ on coke machine plays coin-op sounds for observers', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-coke-machine-1', name: 'Coke Machine',
      mods: [{ type: 'Coke_machine', noid: 90, x: 100, y: 140, state: 0 }] } })
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'PAY$', noid: 90, amount_lo: 5, amount_hi: 0 })
  assert.deepEqual(sounds, [
    { name: 'COIN_DEPOSITED', noid: 90 },
    { name: 'COIN_ACCEPTED', noid: 90 },
    { name: 'STINGY_COKE_MACHINE', noid: 90 },
  ])
})

test('PAYTO$ debits payer token wad', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Put tokens in Naibor's hands (noid 21 = Naibor)
  w.apply({ op: 'make', to: NAIBOR_REF,
    obj: { type: 'item', ref: 'item-tokens-naibor', name: 'Tokens',
      mods: [{ type: 'Tokens', noid: 60, x: 0, y: HANDS, denom_lo: 10, denom_hi: 0 }] } })
  // Fortune machine
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-fortune-1', name: 'Fortune Machine',
      mods: [{ type: 'Fortune_machine', noid: 70, x: 120, y: 140, state: 0 }] } })
  w.apply({ op: 'PAYTO$', noid: 70, payer: 21, amount_lo: 2, amount_hi: 0 })
  const wad = w.holding(21)
  assert.equal((wad.mod.denom_hi || 0) * 256 + (wad.mod.denom_lo || 0), 8) // 10 - 2
})

test('PAYTO$ activates teleport booth display', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: NAIBOR_REF,
    obj: { type: 'item', ref: 'item-tokens-naibor2', name: 'Tokens',
      mods: [{ type: 'Tokens', noid: 61, x: 0, y: HANDS, denom_lo: 5, denom_hi: 0 }] } })
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-teleport-1', name: 'Teleport Booth',
      mods: [{ type: 'Teleport', noid: 71, x: 200, y: 140, state: 0 }] } })
  w.apply({ op: 'PAYTO$', noid: 71, payer: 21, amount_lo: 2, amount_hi: 0 })
  assert.equal(w.get(71).mod.state, 1) // TELEPORT_ACTIVE
  assert.equal((w.holding(21).mod.denom_hi || 0) * 256 + (w.holding(21).mod.denom_lo || 0), 3)
})

test('PAYTO$ on teleport plays TELEPORT_ACTIVATES for observers', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-teleport-2', name: 'Teleport Booth',
      mods: [{ type: 'Teleport', noid: 81, x: 200, y: 140, state: 0 }] } })
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'PAYTO$', noid: 81, payer: 21, amount_lo: 2, amount_hi: 0 })
  assert.deepEqual(sounds, [{ name: 'TELEPORT_ACTIVATES', noid: 81 }])
})

test('PAID$ debits payer and materialises tokens for recipient', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  // Naibor (noid 21) holds tokens to be debited
  w.apply({ op: 'make', to: NAIBOR_REF,
    obj: { type: 'item', ref: 'item-tokens-payer', name: 'Tokens',
      mods: [{ type: 'Tokens', noid: 62, x: 0, y: HANDS, denom_lo: 20, denom_hi: 0 }] } })
  // PAID$ targets recipient (SageBot, noid 17); payer is Naibor (noid 21)
  w.apply({ op: 'PAID$', noid: 17, payer: 21, amount_lo: 15, amount_hi: 0,
    container: ME_REF,
    object: { type: 'item', ref: 'item-tokens-recv', name: 'Tokens',
      mods: [{ type: 'Tokens', noid: 63, x: 0, y: HANDS, denom_lo: 15, denom_hi: 0 }] } })
  // Payer debited
  const payerWad = w.holding(21)
  assert.equal((payerWad.mod.denom_hi || 0) * 256 + (payerWad.mod.denom_lo || 0), 5)
  // New tokens materialised in recipient's container
  const recv = w.get(63)
  assert.ok(recv, 'received token wad should exist')
  assert.equal(recv.containerRef, ME_REF)
})

test('SELL$ debits buyer and materialises item in region', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-vendo-1', name: 'Vendo',
      mods: [{ type: 'Vendo_front', noid: 72, x: 150, y: 140, display_slot: 0 }] } })
  w.apply({ op: 'make', to: ME_REF,
    obj: { type: 'item', ref: 'item-tokens-buyer', name: 'Tokens',
      mods: [{ type: 'Tokens', noid: 64, x: 0, y: HANDS, denom_lo: 8, denom_hi: 0 }] } })
  w.apply({ op: 'SELL$', noid: 72, buyer: 17, item_price_lo: 3, item_price_hi: 0,
    object: { type: 'item', ref: 'item-coke-1', name: 'Coke',
      mods: [{ type: 'Coke', noid: 65, x: 120, y: 140 }] } })
  // Buyer's tokens debited
  const buyerWad = w.holding(17)
  assert.equal((buyerWad.mod.denom_hi || 0) * 256 + (buyerWad.mod.denom_lo || 0), 5)
  // Item materialised in region
  const coke = w.get(65)
  assert.ok(coke, 'sold item should exist in world model')
  assert.equal(coke.containerRef, REGION_REF)
})

test('SELL$ plays VENDO_DISPENSING for observers', () => {
  const w = new HabitatWorld()
  makeStorm(w)
  w.apply({ op: 'make', to: REGION_REF,
    obj: { type: 'item', ref: 'item-vendo-2', name: 'Vendo',
      mods: [{ type: 'Vendo_front', noid: 82, x: 150, y: 140, display_slot: 0 }] } })
  const sounds = []
  w.setClient({ sound: (name, noid) => sounds.push({ name, noid }) })
  w.apply({ op: 'SELL$', noid: 82, buyer: 17, item_price_lo: 3, item_price_hi: 0,
    object: { type: 'item', ref: 'item-coke-2', name: 'Coke',
      mods: [{ type: 'Coke', noid: 83, x: 120, y: 140 }] } })
  assert.deepEqual(sounds, [{ name: 'VENDO_DISPENSING', noid: 82 }])
})
