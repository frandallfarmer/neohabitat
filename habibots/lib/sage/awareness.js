/* jslint bitwise: true */
/* jshint esversion: 8 */

'use strict'

// awareness.js — synthesize "what's around me right now" from HabiBot's
// in-memory state.
//
// HabiBot already maintains noids/avatars/neighbors/realm by listening
// to the make/delete storm from elko. This module reshapes that raw
// state into something Claude can reason about — bucketed object lists,
// inventory (items whose container is the bot's own user-ref, populated
// by the _container tagging in habibot.js's processElkoMessage), and a
// human-readable scene description.
//
// Public:
//   objectsByType(bot)       → { sittable, openable, pickupable, other }
//   getInventory(bot)        → [{ ref, type, name, noid }] of items in pocket
//   describeWorld(bot)       → multiline string for the LLM prompt
//   currentRegionRef(bot)    → context-XX ref bot is in, or '' before entry
//   owningAvatar(bot, obj)   → avatar/ghost that contains obj, or null
//   carriedByOtherAvatar(bot, noid) → { owner, item } when someone else has it
//   directlyInRegion(bot, obj) → true when obj is loose in the region

// Container slot index for "the item the avatar is currently holding".
// Mirrors HANDS = 5 from
// src/main/java/org/made/neohabitat/Constants.java in elko. Pocket
// items' `mods[0].y` is the slot they're stored in, so we can tell at a
// glance which (if any) item is in the avatar's hands vs in numbered
// pocket slots.
const HANDS_SLOT = 5

// HEAD = 6 (Constants.java). A head in this slot is being worn. The same
// object in any other slot is just cargo — a spare head in a pocket is
// not "on the ground" and not on the avatar's shoulders.
const HEAD_SLOT = 6

// MAIL_SLOT = 4 (Constants.java). Every Avatar always has a Paper here;
// that paper is the mailbox. When new mail arrives for the bot, elko
// flips its gr_state from BLANK (0) to LETTER (2) and the avatar
// receives a "* You have MAIL in your pocket. *" OBJECTSPEAK_$ ping.
const MAIL_SLOT = 4

// Paper gr_state values (mods/Paper.java:34-37). Knowing the difference
// between a blank pocket page and an unread letter is the whole point
// of mail-awareness — otherwise sage can't see what just landed.
const PAPER_BLANK_STATE = 0
const PAPER_WRITTEN_STATE = 1
const PAPER_LETTER_STATE = 2
const PAPER_STATE_LABEL = {
  0: 'BLANK',
  1: 'WRITTEN',
  2: 'LETTER',
}

const SITTABLE_TYPES = new Set(['Seat', 'Couch', 'Chair', 'Bench', 'Hot_tub', 'Bed'])
const OPENABLE_TYPES = new Set(['Door', 'Bridge', 'Box', 'Bag', 'Chest', 'Trunk', 'Mailbox', 'Dropbox', 'Aquarium', 'Hot_tub'])
const PICKUPABLE_HINT_TYPES = new Set(['Book', 'Compass', 'Knick_knack', 'Plant', 'Magic_lamp', 'Magic_wand', 'Crystal_ball', 'Cookie', 'Coffee', 'Garbage_can', 'Token'])

// All non-region objects in the bot's noid table, bucketed by interaction
// affordance. Excludes Avatar/Ghost/Region — those have separate paths
// in awareness output (avatars listed by name, region as the header).
function objectsByType(bot) {
  const buckets = { sittable: [], openable: [], pickupable: [], other: [] }
  for (const noid in bot.noids) {
    const o = bot.noids[noid]
    if (!o || !o.mods || !o.mods[0]) continue
    const t = o.mods[0].type
    if (!t || t === 'Avatar' || t === 'Ghost' || t === 'Region') continue
    if (SITTABLE_TYPES.has(t)) buckets.sittable.push(o)
    else if (OPENABLE_TYPES.has(t)) buckets.openable.push(o)
    else if (PICKUPABLE_HINT_TYPES.has(t)) buckets.pickupable.push(o)
    else buckets.other.push(o)
  }
  return buckets
}

// Items currently held by the bot. The container relationship is encoded
// by elko in the make message's `to` field (item-X belongs to whatever
// `to` says — user-ref means in-pocket, context-ref means lying on the
// ground, item-box-ref means inside an open container). habibot.js
// stashes that as o._container in processElkoMessage; we just filter.
//
// The bot's per-session full ref is `bot.names.ME` (e.g.
// "user-sagebot-1765655431951290340"). `bot.names.USER` is the trimmed
// "user-sagebot" form — fine for matching most things, but pocket items'
// _container is set to the FULL ref via `to` on the make message, so we
// have to match `names.ME` (or fall back to a prefix check on USER for
// pre-region-entry edge cases). Before any make has arrived for our
// avatar, both names are undefined and getInventory returns [] cleanly.
function getInventory(bot) {
  // Use the live world model so GET$/PUT$ deltas since region-entry are
  // reflected (fixes the "empty hands while holding a flashlight" bug
  // family — issues #545/#564). bot.world is always present (constructed
  // in HabiBot constructor); world.me is null until our make has arrived.
  if (!bot.world || !bot.world.me) return []
  const records = bot.world.inventory(bot.world.me.noid)
  const items = []
  for (const r of records) {
    if (r.type === 'Avatar' || r.type === 'Ghost') continue
    const item = {
      ref: r.ref,
      type: r.type,
      name: r.name,
      noid: r.noid,
      slot: r.mod.y,
      // Plain-language location so the LLM never has to decode raw slot
      // numbers: slot 5 is the one active hand, slot 4 is the mailbox,
      // everything else is dead storage you must pick_up before using.
      location: r.mod.y === HANDS_SLOT ? 'HANDS (currently held)'
        : r.mod.y === MAIL_SLOT ? 'mail-slot (mailbox)'
          : `pocket slot ${r.mod.y} (stored — pick_up to move into HANDS before use)`,
    }
    if (item.type === 'Tokens') {
      const lo = r.mod.denom_lo || 0
      const hi = r.mod.denom_hi || 0
      item.amount = lo + hi * 256
    }
    if (item.type === 'Paper') {
      item.grState = r.mod.gr_state || 0
      item.paperState = PAPER_STATE_LABEL[item.grState] || `state-${item.grState}`
    }
    items.push(item)
  }
  return items
}

// A single-glance summary of what the avatar is carrying and worth — the
// shape list_inventory should hand the LLM so it never confuses HANDS vs
// pocket storage, or bank money vs Tokens. Bank balance is account money
// (the ATM/bank uses it). Coin-op machines (Coke/Choke, etc.) do NOT spend
// the bank — they spend a Tokens item you are HOLDING IN HANDS.
function inventorySummary(bot) {
  const items = getInventory(bot)
  const held = items.find((i) => i.slot === HANDS_SLOT)
  const me = bot.world && bot.world.me
  return {
    hands: held ? `holding ${held.name} (${held.type}, noid ${held.noid})` : 'empty',
    bank_balance: me ? (me.mod.bankBalance || 0) : 0,
    bank_note: 'bank_balance is account money (ATM/bank). To pay a vending machine you must be HOLDING a Tokens item in HANDS — the bank balance does NOT work in machines.',
    items,
  }
}

// Screen-direction labels, clockwise: UP=0, RIGHT=1, DOWN=2, LEFT=3.
const SCREEN_DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT']
// Geographic compass labels indexed by neighbors array slot (MAP_NORTH=0, etc.)
const CARDINALS = ['NORTH', 'EAST', 'SOUTH', 'WEST']

function currentRegionRef(bot) {
  // The bot's region is the context ref; we don't track it as a single
  // string but it's always present in the names map under "context".
  // Failing that, look in the history for a Region-mod entry.
  for (const ref in bot.history) {
    const o = bot.history[ref]
    if (o && o.obj && o.obj.mods && o.obj.mods[0] && o.obj.mods[0].type === 'Region') {
      return ref
    }
  }
  return ''
}

function regionName(bot) {
  const ref = currentRegionRef(bot)
  if (!ref) return '(unknown region)'
  const o = bot.history[ref]
  return (o && o.obj && o.obj.name) || ref
}

// The habiworld record for a legacy noid-table object, or the record
// itself when that's what the caller already has. Prefer this over the
// make-time `_container` tag: GET$/PUT$ update containerRef and slot,
// but processElkoMessage only stamps `_container` when the make arrives.
function worldRecord(bot, obj) {
  if (!obj) return null
  if (obj.mod && obj.containerRef !== undefined && obj.mods === undefined) return obj
  const world = bot.world
  if (!world) return null
  const noid = obj.noid != null ? obj.noid
    : (obj.mods && obj.mods[0] && obj.mods[0].noid)
  if (noid != null) {
    const byNoid = world.get(noid)
    if (byNoid) return byNoid
  }
  if (obj.ref) return world.getByRef(obj.ref)
  return null
}

// Look up an avatar/ghost by its session ref. A `user-...` container
// that isn't in the object table yet is still someone's pocket — return
// a stub so callers don't describe the item as loose in the room.
function avatarByRef(bot, ref) {
  if (!ref || typeof ref !== 'string') return null
  if (bot.world) {
    const rec = bot.world.getByRef(ref)
    if (rec && (rec.type === 'Avatar' || rec.type === 'Ghost')) return rec
  }
  if (bot.avatars) {
    for (const name in bot.avatars) {
      const av = bot.avatars[name]
      if (av && av.ref === ref) {
        return {
          type: 'Avatar',
          name,
          ref,
          noid: av.mods && av.mods[0] && av.mods[0].noid,
          mod: (av.mods && av.mods[0]) || {},
        }
      }
    }
  }
  if (ref.startsWith('user-')) {
    return { type: 'Avatar', name: ref, ref, noid: null, mod: {} }
  }
  return null
}

// The avatar (or ghost) that ultimately contains this object — worn,
// held, pocketed, or tucked inside something they are carrying. Null
// when the object is in the region or inside a container that is itself
// in the region (an open box on the floor). Walks the live container
// chain so a stale `_container` tag can't put Randy's head on the ground
// after he picks something up, or leave a dropped item in his pocket.
function owningAvatar(bot, obj) {
  const world = bot.world
  const record = worldRecord(bot, obj)
  const regionRef = (world && world.region && world.region.ref) || currentRegionRef(bot)
  if (record && world) {
    const seen = new Set()
    let cursor = record
    while (cursor && cursor.containerRef && cursor.containerRef !== regionRef) {
      if (cursor.ref && seen.has(cursor.ref)) break
      if (cursor.ref) seen.add(cursor.ref)
      const parent = world.getByRef(cursor.containerRef)
      if (!parent) return avatarByRef(bot, cursor.containerRef)
      if (parent.type === 'Avatar' || parent.type === 'Ghost') return parent
      cursor = parent
    }
    return null
  }
  const container = obj && (obj._container || obj.containerRef)
  if (!container || (regionRef && container === regionRef)) return null
  return avatarByRef(bot, container)
}

// { owner, item } when `noid` is worn, held, or carried by someone other
// than the bot — including when it's inside a bag they are carrying.
// Null for ground items, open containers in the room, and our own pockets.
function carriedByOtherAvatar(bot, noid) {
  const world = bot.world
  if (!world || noid == null) return null
  const item = world.get(noid)
  if (!item) return null
  const owner = owningAvatar(bot, item)
  if (!owner) return null
  const me = world.me
  if (me && owner.noid != null && owner.noid === me.noid) return null
  if (me && owner.ref && me.ref && owner.ref === me.ref) return null
  return { owner, item }
}

// True when the object sits directly in the region (floor, furniture,
// a door), not in a pocket and not inside a container. Uses the world
// model when it has the object so interact-ticks don't chase an item
// somebody already picked up.
function directlyInRegion(bot, obj) {
  const record = worldRecord(bot, obj)
  const world = bot.world
  if (record && world && world.region && world.region.ref) {
    return record.containerRef === world.region.ref
  }
  const regionRef = currentRegionRef(bot)
  return !!(obj && obj._container && regionRef && obj._container === regionRef)
}

// Immediate non-region container, or null when the object is loose in
// the region (or its container isn't in the model).
function immediateContainer(bot, obj) {
  const world = bot.world
  const record = worldRecord(bot, obj)
  const regionRef = (world && world.region && world.region.ref) || currentRegionRef(bot)
  if (record && world) {
    if (!record.containerRef || record.containerRef === regionRef) return null
    return world.getByRef(record.containerRef)
  }
  const container = obj && obj._container
  if (!container || container === regionRef) return null
  if (world && world.getByRef(container)) return world.getByRef(container)
  if (bot.noids) {
    for (const n in bot.noids) {
      const o = bot.noids[n]
      if (o && o.ref === container && o.mods && o.mods[0]) {
        return {
          type: o.mods[0].type,
          name: o.name || o.mods[0].type,
          ref: o.ref,
          noid: o.mods[0].noid,
          mod: o.mods[0],
        }
      }
    }
  }
  return null
}

function formatItem(record) {
  const namePart = record.name && record.name !== record.type ? ` "${record.name}"` : ''
  return `${record.type}${namePart} (noid ${record.noid}, ref ${record.ref})`
}

// Plain-language slot for somebody else's gear. y=6 is worn, y=5 is the
// one thing in their hand, y=4 is the paper/mail slot, everything else
// is a pocket.
function formatPossession(record) {
  const y = record.mod.y
  let verb = 'carrying'
  let slot = ` [pocket slot ${y}]`
  if (y === HEAD_SLOT) {
    verb = 'wearing'
    slot = ''
  } else if (y === HANDS_SLOT) {
    verb = 'holding'
    slot = ''
  } else if (y === MAIL_SLOT) {
    slot = ' [mail-slot]'
  }
  return `${verb} ${formatItem(record)}${slot}`
}

function possessionRank(record) {
  const y = record.mod.y
  if (y === HEAD_SLOT) return 0
  if (y === HANDS_SLOT) return 1
  return 2
}

// Lines describing what an avatar is wearing, holding, and carrying.
// Contents of something they have on them (an open bag) stay nested
// here so they never show up as loose room objects.
function holdingLines(bot, avatarNoid) {
  const lines = []
  if (!bot.world || avatarNoid == null) return lines
  const records = bot.world.inventory(avatarNoid)
    .filter((r) => r.type !== 'Avatar' && r.type !== 'Ghost')
    .sort((a, b) => possessionRank(a) - possessionRank(b) || (a.mod.y - b.mod.y) || (a.noid - b.noid))
  for (const record of records) {
    lines.push(`      ${formatPossession(record)}`)
    appendNestedContents(bot, lines, record, 0)
  }
  return lines
}

function appendNestedContents(bot, lines, record, depth) {
  if (!bot.world || depth > 4) return
  const kids = bot.world.contentsOf(record.noid)
    .filter((k) => k.type !== 'Avatar' && k.type !== 'Ghost')
    .sort((a, b) => a.noid - b.noid)
  for (const kid of kids) {
    lines.push(`${'  '.repeat(4 + depth)}containing ${formatItem(kid)}`)
    appendNestedContents(bot, lines, kid, depth + 1)
  }
}

// Multiline string for direct injection into Claude's prompt. Contains
// everything sage needs to reason about its environment in one go:
// region label + ref, exits with their target refs, avatars present
// (with noid + flag for which ones look like bots, and the gear each
// one is wearing / holding / carrying), what's in the bot's pockets,
// and what's actually interactable in the room.
function describeWorld(bot) {
  const ref = currentRegionRef(bot)
  const lines = []
  lines.push(`Region: ${regionName(bot)} (${ref || 'unknown'})`)

  // Exits labeled by screen position (UP/RIGHT/DOWN/LEFT), accounting for
  // orientation. neighbors[i] is a geographic slot; (i + orientation + 1) % 4
  // maps it to the screen direction where it visually appears.
  const orientation = bot.orientation || 0
  const exits = []
  for (let i = 0; i < SCREEN_DIRS.length; i++) {
    const target = bot.neighbors && bot.neighbors[i]
    if (target) {
      const screenDir = SCREEN_DIRS[(i + 5 - orientation) % 4]
      const compass = CARDINALS[i]
      exits.push(`${screenDir}(${compass})→${target}`)
    }
  }
  lines.push(`Exits: ${exits.length ? exits.join(', ') : 'none'}`)

  // Avatars present (excluding self) with noids — sage can use these to
  // pick a target for walk_to_avatar / give_to_avatar / touch_avatar.
  const myName = bot.config && bot.config.username
  const avatarLines = []
  for (const name in bot.avatars) {
    const av = bot.avatars[name]
    if (!av || !av.mods || !av.mods[0]) continue
    if (name === myName) continue
    const tag = looksLikeBotName(name) ? ' (bot)' : ''
    avatarLines.push(`  - ${name} (noid ${av.mods[0].noid})${tag}`)
    // Their worn / held / pocketed gear. These makes arrive addressed
    // to the avatar's session ref, so they live in the noid table, but
    // they are not objects in the room.
    avatarLines.push(...holdingLines(bot, av.mods[0].noid))
  }
  lines.push(`Avatars present:`)
  lines.push(...(avatarLines.length ? avatarLines : ['  (none)']))

  // Pockets — items whose _container is our user-ref. This is the new
  // self-awareness: previously sage couldn't distinguish its own knick-
  // knack from someone else's, leading to it commenting on every pocket
  // trinket in the room.
  // Pocket items list, with the HANDS slot called out specifically.
  // An avatar can hold exactly one item in HANDS (slot 5); everything
  // else lives in numbered pocket slots. The Habitat give-flow is
  // pick_up (item moves into HANDS) → give_to_avatar (HANDS contents
  // transfer to recipient). Telling Claude which slot each item sits
  // in turns the abstract recipe into a concrete plan.
  const inv = getInventory(bot)
  lines.push(`In your pockets:`)
  let inHandsName = null
  let unreadMail = false
  if (inv.length) {
    for (const item of inv) {
      const namePart = item.name && item.name !== item.type ? ` "${item.name}"` : ''
      let slotTag
      if (item.slot === HANDS_SLOT) {
        slotTag = ' [IN HANDS]'
      } else if (item.slot === MAIL_SLOT) {
        slotTag = ' [mail-slot]'
      } else {
        slotTag = ` [pocket slot ${item.slot}]`
      }
      const amountTag = item.type === 'Tokens' && typeof item.amount === 'number'
        ? ` — balance ${item.amount} tokens`
        : ''
      // Mail / paper annotation: callout if it's an unread letter (LETTER
      // state in the mail-slot), tag the state otherwise. Quiet for plain
      // BLANK paper.
      let paperTag = ''
      if (item.type === 'Paper') {
        if (item.grState === PAPER_LETTER_STATE) {
          paperTag = item.slot === MAIL_SLOT
            ? ' — UNREAD MAIL (READ it to see who wrote, then it advances)'
            : ' — open letter (LETTER state)'
          if (item.slot === MAIL_SLOT) unreadMail = true
        } else if (item.grState === PAPER_WRITTEN_STATE) {
          paperTag = ' — written paper'
        }
      }
      lines.push(`  - ${item.type}${namePart} (noid ${item.noid}, ref ${item.ref})${slotTag}${amountTag}${paperTag}`)
      if (item.slot === HANDS_SLOT) inHandsName = item.name || item.type
    }
    lines.push(inHandsName
      ? `  (currently holding ${inHandsName} — your HANDS slot is full)`
      : `  (HANDS slot is empty — you can pick_up another pocket item to give it away)`)
    if (unreadMail) {
      lines.push(`  *** You have unread mail in your mail-slot — react in character. ***`)
    }
  } else {
    lines.push('  (empty-handed)')
  }

  // Interactables in the room — by category, with refs+noids so Claude
  // can call open/sit/pick_up with valid arguments. Anything an avatar
  // is wearing or carrying (including the bot's own pockets, already
  // listed above) is omitted; those makes are addressed to a user-ref,
  // not the region. Items inside an open container that is itself in
  // the room stay here, tagged with that container, so a book in a box
  // doesn't read as a loose object and doesn't disappear either.
  const objs = objectsByType(bot)
  lines.push(`Interactable objects in this region:`)
  let any = false
  for (const cat of ['sittable', 'openable', 'pickupable', 'other']) {
    for (const o of objs[cat]) {
      if (owningAvatar(bot, o)) continue
      const m = o.mods[0]
      const namePart = o.name && o.name !== m.type ? ` "${o.name}"` : ''
      const parent = immediateContainer(bot, o)
      const inside = parent && parent.type !== 'Avatar' && parent.type !== 'Ghost' && parent.type !== 'Region'
        ? ` [inside ${formatItem(parent)}]`
        : ''
      lines.push(`  - [${cat}] ${m.type}${namePart} (noid ${m.noid}, ref ${o.ref})${inside}`)
      any = true
    }
  }
  if (!any) lines.push('  (nothing interactable nearby)')

  return lines.join('\n')
}

// Same heuristic sage.js uses to filter out other bots from greeting
// loops; duplicated here so awareness can flag bot-avatars in the
// scene description without sage having to import its own helper.
const KNOWN_BOT_SUBSTRINGS = ['bot', 'eliza', 'phil', 'devil', 'tonybanks', 'connector', 'welcome', 'sage']
function looksLikeBotName(name) {
  if (!name) return false
  const n = name.toLowerCase()
  return KNOWN_BOT_SUBSTRINGS.some((s) => n.includes(s))
}

// Resolve an object's elko type from its ref by scanning the noid table.
// Object refs (item-foo-123) aren't keyed in bot.noids — that table is
// keyed by noid — so we walk it once. Used to key a procedural lesson on
// the KIND of object an action touched (a lesson about a Magic_lamp should
// apply to any Magic_lamp, not just the one instance). Returns '' if the
// ref isn't (or is no longer) present.
function typeForRef(bot, ref) {
  if (!ref) return ''
  for (const noid in bot.noids) {
    const o = bot.noids[noid]
    if (o && o.ref === ref && o.mods && o.mods[0] && o.mods[0].type) {
      return o.mods[0].type
    }
  }
  return ''
}

// The set of context keys describing "where sage is right now", for
// matching against procedural memory (memory.proceduresFor). A lesson is
// keyed to a region name or an object type; we surface it when sage is in
// that region, can see that kind of object in the room (including inside
// an open container), or is carrying one. Another avatar's pockets do
// not count — a head on Randy is not a Head lying in the region. All
// lowercased so storage and retrieval agree on casing.
function currentContextKeys(bot) {
  const keys = new Set()
  const region = currentRegionRef(bot)
  if (region) keys.add(region.toLowerCase())
  const rn = regionName(bot)
  if (rn && rn !== '(unknown region)') keys.add(rn.toLowerCase())
  const objs = objectsByType(bot)
  for (const cat of ['sittable', 'openable', 'pickupable', 'other']) {
    for (const o of objs[cat]) {
      // Another avatar's pockets are not "the kind of thing in the room".
      // Our own inventory is added below, from the live world model.
      if (owningAvatar(bot, o)) continue
      const t = o.mods && o.mods[0] && o.mods[0].type
      if (t) keys.add(t.toLowerCase())
    }
  }
  for (const it of getInventory(bot)) {
    if (it.type) keys.add(it.type.toLowerCase())
  }
  return [...keys]
}

module.exports = {
  objectsByType,
  getInventory,
  inventorySummary,
  describeWorld,
  currentRegionRef,
  regionName,
  typeForRef,
  currentContextKeys,
  looksLikeBotName,
  owningAvatar,
  carriedByOtherAvatar,
  directlyInRegion,
  HANDS_SLOT,
  HEAD_SLOT,
  MAIL_SLOT,
  PAPER_BLANK_STATE,
  PAPER_WRITTEN_STATE,
  PAPER_LETTER_STATE,
}
