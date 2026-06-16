/* jshint esversion: 8 */

'use strict'

// resolve.js — turn a user-typed "name or noid" token into a habiworld
// record. Reads ONLY the habiworld world model (bot.world); it never
// touches habibots internals, so the text client stays a pure consumer
// of the public world state.
//
// Resolution order:
//   1. all-digits           → that exact noid
//   2. exact name (ci)      → the one record whose name matches
//   3. exact type (ci)      → the one record whose class type matches
//   4. substring of name    → unique substring hit
//   5. substring of type    → unique substring hit
// Ambiguous matches return { ambiguous: [...] } so the caller can ask the
// user to disambiguate by noid; a miss returns null.

// Everything visible in the region plus our own pockets — anything the
// user could plausibly name. We don't filter by container: a held torch
// and a ground rock are both legal targets for different verbs.
function candidates(world) {
  return [...world.objects.values()]
}

function lc(s) {
  return (s || '').toLowerCase()
}

// Resolve a token to a single record, or signal ambiguity / miss.
//   record         → resolved
//   {ambiguous}    → more than one equally-good match
//   null           → nothing matched
// Words that mean "my own avatar" — resolved from world.me, the self-noid
// habiworld latches on the `make … you:true`. Lets the player target
// themselves (e.g. DO me) without looking up their own noid.
const SELF_WORDS = new Set(['ME', 'SELF', 'I', 'MYSELF'])

function resolve(world, token) {
  if (!world || !token) return null
  const t = token.trim()
  if (t === '') return null

  if (SELF_WORDS.has(t.toUpperCase())) return world.me || null

  if (/^\d+$/.test(t)) {
    return world.get(Number(t))
  }

  const all = candidates(world)
  const needle = lc(t)

  const exactName = all.filter((o) => lc(o.name) === needle)
  if (exactName.length === 1) return exactName[0]
  if (exactName.length > 1) return { ambiguous: exactName }

  const exactType = all.filter((o) => lc(o.type) === needle)
  if (exactType.length === 1) return exactType[0]
  if (exactType.length > 1) return { ambiguous: exactType }

  const subName = all.filter((o) => lc(o.name).includes(needle))
  if (subName.length === 1) return subName[0]
  if (subName.length > 1) return { ambiguous: subName }

  const subType = all.filter((o) => lc(o.type).includes(needle))
  if (subType.length === 1) return subType[0]
  if (subType.length > 1) return { ambiguous: subType }

  return null
}

// Short label for prompts / ambiguity lists: `Name (Type, noid N)`.
function label(record) {
  if (!record) return '(nothing)'
  const name = record.name && record.name !== record.type
    ? `${record.name} ` : ''
  return `${name}[${record.type} noid ${record.noid}]`
}

module.exports = { resolve, label, candidates }
