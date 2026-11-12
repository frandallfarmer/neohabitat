/* jshint esversion: 8 */

'use strict'

// Other avatars' worn and pocketed items arrive as ordinary `make`s
// addressed to that avatar's session ref (`to: user-randy-...`), and the
// avatar itself is a make addressed to the region. describeWorld used to
// list every non-avatar noid as a loose room object, skipping only Sage's
// own pockets, so a worn head read as sitting on the ground.
//
// These fixtures mirror that wire shape and the live world model
// (containerRef), including a GET$ that moves an item without updating
// the legacy `_container` tag.

const { test } = require('node:test')
const assert = require('node:assert')
const { HabitatWorld } = require('../../habiworld')
const awareness = require('../lib/sage/awareness')
const { executeAction } = require('../lib/sage/tools')

const REGION = 'context-plaza'
const SAGE_REF = 'user-sage-111'
const RANDY_REF = 'user-randy-8549707431955457184'
const BAG_REF = 'item-randybag-1'
const BOX_REF = 'item-box-1'

const RANDY_HEAD = 'item-randyhead-8549707431955457184'

function freshBot() {
  return {
    config: { username: 'Sage' },
    names: {},
    noids: {},
    avatars: {},
    history: {},
    orientation: 0,
    world: new HabitatWorld(),
  }
}

// The bits of processElkoMessage that awareness reads: world.apply plus
// the legacy noid / avatar / history tables. `_container` is stamped once,
// at make time, and never rewritten — same as habibot.js.
function ingest(bot, msg) {
  bot.world.apply(msg)
  if (msg.op !== 'make' || !msg.obj) return
  const obj = msg.obj
  bot.history[obj.ref] = msg
  if (!obj.mods || !obj.mods[0]) return
  obj._container = msg.to
  const noid = obj.mods[0].noid
  if (noid <= 255) bot.noids[noid] = obj
  if (msg.you) {
    bot.names.ME = obj.ref
    const split = obj.ref.split('-')
    bot.names.USER = `${split[0]}-${split[1]}`
  }
  if (obj.mods[0].type === 'Avatar') bot.avatars[obj.name] = obj
  if (obj.mods[0].type === 'Region') {
    bot.neighbors = obj.mods[0].neighbors
    bot.orientation = obj.mods[0].orientation || 0
  }
}

function make(bot, spec) {
  ingest(bot, {
    op: 'make',
    to: spec.to,
    you: !!spec.you,
    obj: {
      type: 'item',
      ref: spec.ref,
      name: spec.name,
      mods: [Object.assign({
        type: spec.type,
        noid: spec.noid,
        x: spec.x || 0,
        y: spec.y || 0,
      }, spec.mod || {})],
    },
  })
}

// Sage in a plaza with Pat (empty-handed) and Randy, who is wearing a
// head and carrying a bag, money, a godtool, and a paper pad. A book and
// a chair are loose in the room; a compass is inside an open crate.
function scene() {
  const bot = freshBot()
  make(bot, {
    to: 'session', ref: REGION, name: 'The Plaza', type: 'Region',
    mod: { orientation: 0, neighbors: ['context-north', '', '', ''] },
  })
  make(bot, {
    to: REGION, ref: SAGE_REF, name: 'Sage', type: 'Avatar', noid: 10, you: true,
    x: 20, y: 140,
  })
  make(bot, {
    to: SAGE_REF, ref: 'item-sageflash-1', name: "Sage's light", type: 'Flashlight',
    noid: 20, y: awareness.HANDS_SLOT,
  })
  make(bot, {
    to: SAGE_REF, ref: 'item-sagetokens-1', name: "Sage's money", type: 'Tokens',
    noid: 21, y: 0, mod: { denom_lo: 40 },
  })
  make(bot, {
    to: SAGE_REF, ref: 'item-sagepaper-1', name: "Sage's mail", type: 'Paper',
    noid: 22, y: awareness.MAIL_SLOT, mod: { gr_state: awareness.PAPER_LETTER_STATE },
  })
  make(bot, {
    to: REGION, ref: 'user-pat-1', name: 'Pat', type: 'Avatar', noid: 30, x: 80, y: 140,
  })
  make(bot, {
    to: REGION, ref: RANDY_REF, name: 'Randy', type: 'Avatar', noid: 31, x: 110, y: 140,
  })
  make(bot, {
    to: RANDY_REF, ref: RANDY_HEAD, name: "Randy's Head", type: 'Head',
    noid: 32, y: awareness.HEAD_SLOT, mod: { style: 151 },
  })
  make(bot, {
    to: RANDY_REF, ref: BAG_REF, name: "Randy's bag", type: 'Bag',
    noid: 33, y: 1,
  })
  make(bot, {
    to: RANDY_REF, ref: 'item-randytokens-1', name: "Randy's money", type: 'Tokens',
    noid: 34, y: 0, mod: { denom_lo: 10 },
  })
  make(bot, {
    to: RANDY_REF, ref: 'item-randypaper-1', name: "Randy's pad", type: 'Paper',
    noid: 35, y: awareness.MAIL_SLOT,
  })
  make(bot, {
    to: RANDY_REF, ref: 'item-god-1', name: 'a godtool', type: 'Knick_knack',
    noid: 36, y: awareness.HANDS_SLOT,
  })
  // Inside the bag Randy is carrying — not a room object.
  make(bot, {
    to: BAG_REF, ref: 'item-key-1', name: 'a key', type: 'Key', noid: 37, y: 0,
  })
  make(bot, {
    to: REGION, ref: 'item-book-1', name: 'a novel', type: 'Book',
    noid: 40, x: 60, y: 150,
  })
  make(bot, {
    to: REGION, ref: 'item-chair-1', name: 'a bench', type: 'Chair',
    noid: 41, x: 40, y: 130,
  })
  make(bot, {
    to: REGION, ref: BOX_REF, name: 'a crate', type: 'Box',
    noid: 42, x: 90, y: 140,
  })
  make(bot, {
    to: BOX_REF, ref: 'item-compass-1', name: 'a compass', type: 'Compass',
    noid: 43, y: 0,
  })
  return bot
}

function section(text, start, end) {
  const from = text.split(start)[1]
  assert.ok(from, `missing section ${start}`)
  return end ? from.split(end)[0] : from
}

function instrument(bot) {
  const calls = { getIntoHands: 0, performVerb: 0, wearItem: 0, removeItem: 0 }
  bot.getIntoHands = async () => { calls.getIntoHands++; return { ok: true } }
  bot.performVerb = async () => { calls.performVerb++; return { ok: true } }
  bot.wearItem = async () => { calls.wearItem++; return { ok: true, status: 'worn' } }
  bot.removeItem = async () => { calls.removeItem++; return { ok: true } }
  return calls
}

test("another avatar's worn, held, and pocketed items are theirs, not loose in the room", () => {
  const text = awareness.describeWorld(scene())
  const avatars = section(text, 'Avatars present:', 'In your pockets:')
  const randy = avatars.split('  - Randy (noid 31)')[1]
  assert.ok(randy, 'Randy should be listed')

  assert.match(avatars, /  - Pat \(noid 30\)\n  - Randy \(noid 31\)/)
  assert.match(randy, /wearing Head "Randy's Head" \(noid 32, ref item-randyhead-8549707431955457184\)/)
  assert.match(randy, /holding Knick_knack "a godtool" \(noid 36, ref item-god-1\)/)
  assert.match(randy, /carrying Tokens "Randy's money" \(noid 34, ref item-randytokens-1\) \[pocket slot 0\]/)
  assert.match(randy, /carrying Bag "Randy's bag" \(noid 33, ref item-randybag-1\) \[pocket slot 1\]/)
  assert.match(randy, /containing Key "a key" \(noid 37, ref item-key-1\)/)
  assert.match(randy, /carrying Paper "Randy's pad" \(noid 35, ref item-randypaper-1\) \[mail-slot\]/)

  const wearingAt = randy.indexOf('wearing')
  const holdingAt = randy.indexOf('holding')
  const carryingAt = randy.indexOf('carrying')
  assert.ok(wearingAt >= 0 && wearingAt < holdingAt && holdingAt < carryingAt)

  const bagAt = randy.indexOf("Randy's bag")
  const keyAt = randy.indexOf('a key')
  const paperAt = randy.indexOf("Randy's pad")
  assert.ok(bagAt < keyAt && keyAt < paperAt, 'a key in the bag stays under the bag')

  const interact = section(text, 'Interactable objects in this region:')
  for (const stray of ["Randy's Head", "Randy's bag", "Randy's money", "Randy's pad", 'a godtool', 'a key', RANDY_HEAD]) {
    assert.equal(interact.includes(stray), false, `${stray} listed as a room object`)
  }
})

test('ground items stay loose, and open-container contents stay tagged inside the container', () => {
  const text = awareness.describeWorld(scene())
  const interact = section(text, 'Interactable objects in this region:')
  const book = interact.split('\n').find((line) => line.includes('item-book-1'))
  const chair = interact.split('\n').find((line) => line.includes('item-chair-1'))
  const box = interact.split('\n').find((line) => line.includes(BOX_REF) && line.includes('[openable]'))
  const compass = interact.split('\n').find((line) => line.includes('item-compass-1'))

  assert.match(book, /\[pickupable\] Book "a novel" \(noid 40, ref item-book-1\)$/)
  assert.match(chair, /\[sittable\] Chair "a bench" \(noid 41, ref item-chair-1\)$/)
  assert.match(box, /\[openable\] Box "a crate" \(noid 42, ref item-box-1\)$/)
  assert.match(compass, /\[pickupable\] Compass "a compass" \(noid 43, ref item-compass-1\) \[inside Box "a crate" \(noid 42, ref item-box-1\)\]/)
})

test("Sage's own pockets are unchanged and are not repeated as room objects", () => {
  const text = awareness.describeWorld(scene())
  const pockets = section(text, 'In your pockets:', 'Interactable objects in this region:')
  assert.match(pockets, /Flashlight "Sage's light" \(noid 20, ref item-sageflash-1\) \[IN HANDS\]/)
  assert.match(pockets, /Tokens "Sage's money" \(noid 21, ref item-sagetokens-1\) \[pocket slot 0\] — balance 40 tokens/)
  assert.match(pockets, /Paper "Sage's mail" \(noid 22, ref item-sagepaper-1\) \[mail-slot\] — UNREAD MAIL/)
  assert.match(pockets, /currently holding Sage's light/)
  assert.match(pockets, /You have unread mail/)
  assert.equal(pockets.includes('Randy'), false)

  const interact = section(text, 'Interactable objects in this region:')
  assert.equal(interact.includes("Sage's light"), false)
  assert.equal(interact.includes("Sage's money"), false)
  assert.equal(interact.includes("Sage's mail"), false)

  // Self is not listed as another avatar present.
  const avatars = section(text, 'Avatars present:', 'In your pockets:')
  assert.equal(avatars.includes('Sage'), false)
})

test('context keys include the room and our inventory, not another avatar\'s gear', () => {
  const keys = new Set(awareness.currentContextKeys(scene()))
  for (const key of ['context-plaza', 'the plaza', 'book', 'box', 'compass', 'chair', 'flashlight', 'tokens', 'paper']) {
    assert.ok(keys.has(key), `expected context key ${key}`)
  }
  for (const key of ['head', 'bag', 'key', 'knick_knack']) {
    assert.equal(keys.has(key), false, `${key} is only on Randy`)
  }
})

test('a GET$ onto another avatar leaves the legacy _container stale but the description follows the world model', () => {
  const bot = scene()
  const book = bot.noids[40]
  assert.equal(book._container, REGION)
  assert.equal(awareness.directlyInRegion(bot, book), true)

  bot.world.apply({ op: 'GET$', noid: 31, target: 40, how: 0 })

  assert.equal(book._container, REGION, 'make-time _container is not rewritten by GET$')
  assert.equal(awareness.directlyInRegion(bot, book), false)
  const text = awareness.describeWorld(bot)
  const interact = section(text, 'Interactable objects in this region:')
  assert.equal(interact.includes('item-book-1'), false)
  const randy = section(text, 'Avatars present:', 'In your pockets:').split('  - Randy (noid 31)')[1]
  assert.match(randy, /holding Book "a novel" \(noid 40, ref item-book-1\)/)

  const keys = new Set(awareness.currentContextKeys(bot))
  assert.equal(keys.has('book'), false)
  assert.ok(keys.has('chair'))
})

test('a GET$ into our own hands moves the item into pockets, not the room list', () => {
  const bot = scene()
  const book = bot.noids[40]
  bot.world.apply({ op: 'GET$', noid: 10, target: 40, how: 0 })
  assert.equal(book._container, REGION)

  const text = awareness.describeWorld(bot)
  const interact = section(text, 'Interactable objects in this region:')
  assert.equal(interact.includes('item-book-1'), false)
  assert.match(interact, /Chair "a bench"/)
  const pockets = section(text, 'In your pockets:', 'Interactable objects in this region:')
  assert.match(pockets, /Book "a novel" \(noid 40, ref item-book-1\) \[IN HANDS\]/)
  assert.match(pockets, /Flashlight "Sage's light"/)
  // Randy's head is still his, not something we just "found" on the floor.
  assert.equal(interact.includes("Randy's Head"), false)
  assert.match(section(text, 'Avatars present:', 'In your pockets:'), /wearing Head "Randy's Head"/)
})

test('pick_up and walk_to_object refuse another avatar\'s gear and still accept the floor and an open crate', async () => {
  const bot = scene()
  const calls = instrument(bot)

  const head = await executeAction(
    { name: 'pick_up', input: { ref: RANDY_HEAD, noid: 32 } }, bot, {})
  assert.equal(head.ok, false)
  assert.match(head.error, /Randy is wearing Head "Randy's Head"/)
  assert.equal(calls.getIntoHands, 0)

  const godtool = await executeAction(
    { name: 'pick_up', input: { ref: 'item-god-1', noid: 36 } }, bot, {})
  assert.equal(godtool.ok, false)
  assert.match(godtool.error, /Randy is holding Knick_knack "a godtool"/)
  assert.match(godtool.error, /grab_from_avatar\(31\)/)

  const bag = await executeAction(
    { name: 'pick_up', input: { ref: BAG_REF, noid: 33 } }, bot, {})
  assert.equal(bag.ok, false)
  assert.match(bag.error, /Randy is carrying Bag "Randy's bag"/)

  const key = await executeAction(
    { name: 'pick_up', input: { ref: 'item-key-1', noid: 37 } }, bot, {})
  assert.equal(key.ok, false)
  assert.match(key.error, /Randy is carrying Key "a key"/)
  assert.equal(calls.getIntoHands, 0)

  const book = await executeAction(
    { name: 'pick_up', input: { ref: 'item-book-1', noid: 40 } }, bot, {})
  assert.equal(book.ok, true)
  const compass = await executeAction(
    { name: 'pick_up', input: { ref: 'item-compass-1', noid: 43 } }, bot, {})
  assert.equal(compass.ok, true)
  const ownTokens = await executeAction(
    { name: 'pick_up', input: { ref: 'item-sagetokens-1', noid: 21 } }, bot, {})
  assert.equal(ownTokens.ok, true)
  assert.equal(calls.getIntoHands, 3)

  const walkHead = await executeAction(
    { name: 'walk_to_object', input: { noid: 32 } }, bot, {})
  assert.equal(walkHead.ok, false)
  assert.match(walkHead.error, /Randy is wearing Head "Randy's Head"/)
  assert.match(walkHead.error, /walk_to_avatar/)
  assert.equal(calls.performVerb, 0)

  const walkKey = await executeAction(
    { name: 'walk_to_object', input: { noid: 37 } }, bot, {})
  assert.equal(walkKey.ok, false)
  assert.equal(calls.performVerb, 0)

  const walkBook = await executeAction(
    { name: 'walk_to_object', input: { noid: 40 } }, bot, {})
  assert.equal(walkBook.ok, true)
  const walkCompass = await executeAction(
    { name: 'walk_to_object', input: { noid: 43 } }, bot, {})
  assert.equal(walkCompass.ok, true)
  const sit = await executeAction(
    { name: 'sit_down', input: { noid: 41 } }, bot, {})
  assert.equal(sit.ok, true)

  const openBag = await executeAction(
    { name: 'open', input: { noid: 33 } }, bot, {})
  assert.equal(openBag.ok, false)
  assert.match(openBag.error, /Randy is carrying Bag "Randy's bag"/)

  const wear = await executeAction(
    { name: 'wear_item', input: { ref: RANDY_HEAD } }, bot, {})
  assert.equal(wear.ok, false)
  assert.match(wear.error, /Randy is wearing/)
  assert.equal(calls.wearItem, 0)

  // open of the bag must not have walked, and the successful walks/sits
  // are the only performVerb calls: book, compass, sit.
  assert.equal(calls.performVerb, 3)
})
