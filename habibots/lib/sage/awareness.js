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

// Container slot index for "the item the avatar is currently holding".
// Mirrors HANDS = 5 from
// src/main/java/org/made/neohabitat/Constants.java in elko. Pocket
// items' `mods[0].y` is the slot they're stored in, so we can tell at a
// glance which (if any) item is in the avatar's hands vs in numbered
// pocket slots.
const HANDS_SLOT = 5

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

// Multiline string for direct injection into Claude's prompt. Contains
// everything sage needs to reason about its environment in one go:
// region label + ref, exits with their target refs, avatars present
// (with noid + flag for which ones look like bots), what's in the
// bot's pockets, and what's interactable in the room.
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
  // can call open/sit/pick_up with valid arguments.
  const objs = objectsByType(bot)
  // Same matching as getInventory above — pocket items have _container
  // = the full session ref (names.ME), not the trimmed user-NAME form.
  const myFullRef = bot.names && bot.names.ME
  const myShortRef = bot.names && bot.names.USER
  const isMine = (o) =>
    o._container && (
      o._container === myFullRef ||
      (myShortRef && o._container.startsWith(myShortRef + '-'))
    )
  lines.push(`Interactable objects in this region:`)
  let any = false
  for (const cat of ['sittable', 'openable', 'pickupable', 'other']) {
    for (const o of objs[cat]) {
      // Skip items in our own pocket — they're listed above; describing
      // them here too is the exact bug we're fixing.
      if (isMine(o)) continue
      const m = o.mods[0]
      const namePart = o.name && o.name !== m.type ? ` "${o.name}"` : ''
      lines.push(`  - [${cat}] ${m.type}${namePart} (noid ${m.noid}, ref ${o.ref})`)
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
// that region OR can see / is carrying that kind of object. All lowercased
// so storage and retrieval agree on casing.
function currentContextKeys(bot) {
  const keys = new Set()
  const region = currentRegionRef(bot)
  if (region) keys.add(region.toLowerCase())
  const rn = regionName(bot)
  if (rn && rn !== '(unknown region)') keys.add(rn.toLowerCase())
  const objs = objectsByType(bot)
  for (const cat of ['sittable', 'openable', 'pickupable', 'other']) {
    for (const o of objs[cat]) {
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
  HANDS_SLOT,
  MAIL_SLOT,
  PAPER_BLANK_STATE,
  PAPER_WRITTEN_STATE,
  PAPER_LETTER_STATE,
}
