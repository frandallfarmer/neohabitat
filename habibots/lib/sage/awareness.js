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
// The bot's user-ref is `this.names.USER` (set in processElkoMessage when
// elko sends the "you:true" make for our avatar — looks like
// "user-sagebot"). Before connect/region-entry, names.USER is undefined
// and getInventory returns [] cleanly.
function getInventory(bot) {
  const myRef = bot.names && bot.names.USER
  if (!myRef) return []
  const items = []
  for (const noid in bot.noids) {
    const o = bot.noids[noid]
    if (!o || !o.mods || !o.mods[0]) continue
    if (!o._container) continue
    if (o._container !== myRef) continue
    // Exclude the avatar itself — it's also "contained" by the user-ref
    // in some flows but it's not a pocket item.
    if (o.mods[0].type === 'Avatar' || o.mods[0].type === 'Ghost') continue
    items.push({
      ref: o.ref,
      type: o.mods[0].type,
      name: o.name || o.mods[0].type,
      noid: o.mods[0].noid,
    })
  }
  return items
}

// Cardinal-index → name. HabiBot stores neighbors as a 4-element array
// keyed by index 0..3 → NORTH/EAST/SOUTH/WEST.
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

  // Exits — index → cardinal → target context ref. neighbors[i] is "" if
  // there's no exit that direction.
  const exits = []
  for (let i = 0; i < CARDINALS.length; i++) {
    const target = bot.neighbors && bot.neighbors[i]
    if (target) exits.push(`${CARDINALS[i]}→${target}`)
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
  const inv = getInventory(bot)
  lines.push(`In your pockets:`)
  if (inv.length) {
    for (const item of inv) {
      const namePart = item.name && item.name !== item.type ? ` "${item.name}"` : ''
      lines.push(`  - ${item.type}${namePart} (noid ${item.noid}, ref ${item.ref})`)
    }
  } else {
    lines.push('  (empty-handed)')
  }

  // Interactables in the room — by category, with refs+noids so Claude
  // can call open/sit/pick_up with valid arguments.
  const objs = objectsByType(bot)
  lines.push(`Interactable objects in this region:`)
  let any = false
  for (const cat of ['sittable', 'openable', 'pickupable', 'other']) {
    for (const o of objs[cat]) {
      // Skip items in our own pocket — they're listed above; describing
      // them here too is the exact bug we're fixing.
      if (o._container && o._container === (bot.names && bot.names.USER)) continue
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

module.exports = {
  objectsByType,
  getInventory,
  describeWorld,
  currentRegionRef,
  regionName,
  looksLikeBotName,
}
