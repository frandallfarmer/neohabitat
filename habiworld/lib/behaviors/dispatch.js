/* jshint esversion: 8 */

'use strict'

// dispatch.js — the JS equivalent of GetAction (Main/database.m:204)
// plus the two re-entry mechanisms behaviors compose with:
//
//   doMyAction (action_head.i:310) — run another verb slot against the
//     same pointed object (every goToAnd* recipe invokes its own GO).
//
//   depends (Main/actions.m, vectored as v_depends) — the verb falls
//     through to reverse-DO on the in-hand item (or the avatar itself
//     if empty-handed), with the original pointed object passed along
//     as `subject`. This is what makes DO-on-the-ground throw the held
//     frisbee: ground.do = generic_depends → frisbee.rdo = generic_throw.

const behaviors = require('./index')
const { makeCtx } = require('./kernel')
const { ACTION_RDO } = require('../constants')

// Lazily required: classes.js is generated (lib/tools/parse_mud.js) and
// re-generated in place; the lazy require also keeps unit tests able to
// load the dispatcher before the table exists.
let table = null
function classTable() {
  if (!table) table = require('../classes')
  return table
}

// Server-only classes (Ghost, Bureaucrat, Sidewalk...) don't exist in
// new.mud. Rather than refuse all verbs on them, give them the profile
// shared by the majority of portable items.
const DEFAULT_ITEM_ACTIONS = [
  'generic_depends',      // do
  'illegal',              // reverse do
  'generic_goTo',         // go
  'generic_cease',        // stop
  'generic_goToAndGet',   // get
  'generic_goToAndDropAt',// put
  'generic_broadcast',    // talk
  'generic_destroy',      // destroy
]

// A behavior referenced by the table but not yet in the registry runs
// as a stub that fails loudly with the .m filename. BEHAVIORS.md
// proposed throwing; a flagged failure is kinder to bot loops while
// being just as visible in results and logs.
function unported(name) {
  return async () => ({ ok: false, reason: `unported:${name}` })
}

function classEntryFor(record) {
  const t = classTable()
  const classNumber = t.byTypeName[record.type]
  return classNumber === undefined ? null : t.classes[classNumber]
}

function behaviorNameFor(record, slot) {
  const entry = classEntryFor(record)
  const actions = entry ? entry.actions : DEFAULT_ITEM_ACTIONS
  return actions[slot] || null
}

const MAX_DEPTH = 8 // depends/doMyAction recursion guard

async function run(world, slot, pointed, args, client, parent) {
  const depth = parent ? parent.depth + 1 : 0
  if (depth > MAX_DEPTH) return { ok: false, reason: 'dispatch-depth-exceeded' }

  const name = behaviorNameFor(pointed, slot)
  if (!name) return { ok: false, reason: `no-such-slot:${slot}` }
  const fn = behaviors[name] || unported(name)

  const ctx = makeCtx(world, slot, pointed, args, client, parent)

  // doMyAction: another verb slot, same pointed object, same args
  // unless overridden.
  ctx.doAction = (verb, overrideArgs) =>
    run(world, verb, ctx.pointed,
      overrideArgs !== undefined ? overrideArgs : ctx.args, client, ctx)

  // depends: reverse-DO on the in-hand item (or the avatar), original
  // pointed becomes subject (handled by makeCtx's parent comparison).
  ctx.depends = () => {
    const next = ctx.inHand || ctx.actor
    if (!next) return ctx.beep('nothing-to-depend-on')
    if (ctx.verb === ACTION_RDO && ctx.pointed && next.noid === ctx.pointed.noid) {
      return ctx.beep('depends-loop') // rdo already ran on this object
    }
    return run(world, ACTION_RDO, next, ctx.args, client, ctx)
  }

  return fn(ctx)
}

// Public entry point: run a verb against an object in the world.
async function dispatch(world, verb, noid, args, client) {
  if (!world.me) return { ok: false, reason: 'not-in-region' }
  const pointed = world.get(noid)
  if (!pointed) return { ok: false, reason: 'no-such-object' }
  if (!client || typeof client.send !== 'function' || typeof client.walkTo !== 'function') {
    throw new Error('habiworld dispatch: client callbacks {send, walkTo} are required')
  }
  return run(world, verb, pointed, args, client, null)
}

module.exports = { dispatch, behaviorNameFor, DEFAULT_ITEM_ACTIONS }
