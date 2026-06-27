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
const { ACTION_RDO, ACTION_GO, ACTION_TALK } = require('../constants')

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

  // moveOb subject, pointed + issue_nested_command: re-dispatch a verb
  // against a different object (head_do → DO my avatar, avatar_do →
  // DO the held item, ...). The current pointed becomes subject.
  ctx.doActionOn = (verb, record, overrideArgs) =>
    run(world, verb, record,
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

  // Nested dispatches (doAction/depends) just run — the outermost behavior
  // owns the post-walk wait (or already issued waitWalkAnimation).
  if (parent) return fn(ctx)

  // Top-level dispatch: the C64 follows `doMyAction ACTION_GO` with
  // `waitWhile animation_wait_bit`. A standalone GO (e.g. the open/close
  // tool's walk step, or walk_to_object) has no in-habiworld caller to do
  // that, so wait out any walk animation the behavior left unconsumed —
  // the same 0–8s distance-scaled pause the goToAnd* recipes get inline.
  // Behaviors that already called waitWalkAnimation leave millis = null, so
  // this never double-waits.
  const result = await fn(ctx)
  if (ctx._walkState.millis !== null) await ctx.waitWalkAnimation()
  return result
}

// Public entry point: run a verb against an object in the world.
async function dispatch(world, verb, noid, args, client) {
  if (!world.me) return { ok: false, reason: 'not-in-region' }
  // actions.m:272-294 — a ghost has no avatar and may issue ONLY GO (which, in-region, is a
  // no-op: ctx.walkTo rts early; only region-edge transit actually moves a ghost). Every other
  // verb beeps locally — no server round-trip. Deghost (F1) is a separate path (performFnKey
  // slot 9), not a class verb. See GHOST_MODE.md.
  if (world.amGhost && verb !== ACTION_GO) {
    if (client && client.beep) client.beep('ghost-cant')
    return { ok: false, reason: 'ghost-no-verb' }
  }
  // actions.m:280-300 — seated state is resolved in the command dispatcher, before the verb runs.
  // The order is exact: TALK is checked FIRST (`cpy #COMMAND_TALK; beq skip_facing`) so speaking
  // is ALWAYS allowed while seated and runs on its actual target. Otherwise, while Im_sitting
  // (≡ "contained" by a seat): GO is retargeted to the seat you're in (OBJECT_contained_by) — it
  // runs the seat's GO = generic_goToFurniture get-up (stand, container back to region, NO walk;
  // the cursor target is discarded, and goXY would go_fail on Im_sitting anyway) — and every other
  // command beeps. Floor-sitting does NOT set Im_sitting (avatar_go.m never inc's it) and stays
  // region-contained, so it isn't caught here — a floor-sit GO walks normally.
  const me = world.me
  if (verb !== ACTION_TALK && me.containerRef && world.region && me.containerRef !== world.region.ref) {
    if (verb !== ACTION_GO) {
      if (client && client.beep) client.beep('sitting')
      return { ok: false, reason: 'sitting-go-only' }
    }
    const seat = world.getByRef(me.containerRef)
    if (seat) noid = seat.noid
  }
  const pointed = world.get(noid)
  if (!pointed) return { ok: false, reason: 'no-such-object' }
  if (!client || typeof client.send !== 'function' || typeof client.walkTo !== 'function') {
    throw new Error('habiworld dispatch: client callbacks {send, walkTo} are required')
  }
  return run(world, verb, pointed, args, client, null)
}

// keyboard.m que_gesture: a Ctrl+# gesture is do_a_gesture on the actor (self), not a
// class verb slot — run it directly with the AV_ACT value in args.gesture.
async function performGesture(world, gestureValue, client) {
  if (!world.me) return { ok: false, reason: 'not-in-region' }
  if (!client || typeof client.send !== 'function') {
    throw new Error('habiworld performGesture: client.send is required')
  }
  // A ghost has no body to pose (server POSTURE is illegal when amAGhost) — beep, don't send.
  if (world.amGhost) {
    if (client.beep) client.beep('ghost-cant')
    return { ok: false, reason: 'ghost-no-gesture' }
  }
  const ctx = makeCtx(world, null, world.me, { gesture: gestureValue }, client, null)
  return behaviors.do_gesture(ctx)
}

// keyboard.m que_gesture → Region action slots 9–16 (the F-keys). beta.mud's Region table
// is C64 ground truth (the generated new.mud table is stale and disagrees), so route the
// F-key directly rather than through the class verb slots:
//   F1(9) toggle_ghost_mode        — corporeality toggle (DISCORPORATE / CORPORATE)
//   F2(10) toggle_walking_music    — local-only client feature; skipped
//   F3(11) F4(12) F5(13) F8(16) fn_key_pressed → FNKEY to me (host balloons the result)
//   F6(14) change_player_color     — local-only palette; skipped
//   F7(15) ask_for_help → HELP to the object under the cursor (pointedNoid)
async function performFnKey(world, slot, pointedNoid, client) {
  if (!world.me) return { ok: false, reason: 'not-in-region' }
  if (!client || typeof client.send !== 'function') {
    throw new Error('habiworld performFnKey: client.send is required')
  }
  // F1 toggle_ghost_mode is the ONE F-key a ghost may use (it's how you come back to life).
  if (slot === 9) {
    const ctx = makeCtx(world, null, world.me, {}, client, null)
    return behaviors.toggle_ghost_mode(ctx)
  }
  // Every other F-key acts through the avatar — the server rejects FNKEY / HELP while a ghost,
  // so beep locally instead of round-tripping (GHOST_MODE.md).
  if (world.amGhost) {
    if (client.beep) client.beep('ghost-cant')
    return { ok: false, reason: 'ghost-no-fnkey' }
  }
  if (slot === 15) {
    const pointed = pointedNoid != null ? world.get(pointedNoid) : null
    const ctx = makeCtx(world, null, pointed, {}, client, null)
    return behaviors.ask_for_help(ctx)
  }
  if (slot === 11 || slot === 12 || slot === 13 || slot === 16) {
    const ctx = makeCtx(world, null, world.me, { key: slot, target: pointedNoid ?? 0 }, client, null)
    return behaviors.fn_key_pressed(ctx)
  }
  return { ok: false, reason: `fnkey-unhandled:${slot}` } // F2 / F6 not wired
}

module.exports = { dispatch, performGesture, performFnKey, behaviorNameFor, DEFAULT_ITEM_ACTIONS }
