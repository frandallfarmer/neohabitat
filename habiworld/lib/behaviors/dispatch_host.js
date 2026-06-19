/* jshint esversion: 8 */

'use strict'

// Inbound host-message dispatch (class table slots 8+). Replaces the flat
// deltas.js path for migrated ops — see BEHAVIOR_MIGRATION_PLAN.md.

const behaviors = require('./index')
const { makeCtx } = require('./kernel')
const { behaviorNameFor } = require('./dispatch')
const { THE_REGION } = require('../constants')
const { soundSourceRecord } = require('./avatar_choreography_host')

/** Ops routed through class-table host behaviors instead of deltas.js. */
const MIGRATED_OPS = new Set([
  'WALK$',
  'POSTURE$',
  'GET$',
  'PUT$',
  'GRABFROM$',
  'THROW$',
  'WEAR$',
  'REMOVE$',
  'OPEN$',
  'CLOSE$',
  'OPENCONTAINER$',
  'CLOSECONTAINER$',
  'FLUSH$',
  'FAKESHOOT$',
  'RUB$',
  'ZAPTO$',
  'SCAN$',
  'SPRAY$',
  'MUNCH$',
  'RESET$',
  'WIND$',
  'EXPLODE$',
  'VSELECT$',
  'SELL$',
  'PAYTO$',
  'PAID$',
  'PAY$',
  'ATTACK$',
  'BASH$',
  'SPEAK$',
  'PLAY_$',
  'OBJECTSPEAK_$',
  'WISH$',
  'DIG$',
  'TAKE$',
  'BUGOUT$',
  'APPEARING_$',
  'WAITFOR_$',
])

// Ops whose wire noid does not match the class-table slot on that object (e.g. DIG$ on
// the avatar noid, not shovel slot 8). Resolved to a fixed behavior name.
const HOST_FIXED_BEHAVIORS = {
  DIG$: 'avatar_DIG',
  TAKE$: 'avatar_TAKE',
  BUGOUT$: 'avatar_BUGOUT',
  OBJECTSPEAK_$: 'generic_OBJECTSPEAK',
  APPEARING_$: 'region_APPEARING',
  WAITFOR_$: 'region_WAITFOR',
}

// Host message slot numbers (Constants.java) — class-table slot on msg.noid object.
const HOST_OP_SLOTS = {
  'WALK$': 8,
  'POSTURE$': 20,
  'GET$': 15,
  'GRABFROM$': 17,
  'PUT$': 22,
  'THROW$': 24,
  'WEAR$': 28,
  'REMOVE$': 29,
  'CLOSE$': 12,
  'OPEN$': 18,
  'OPENCONTAINER$': 19,
  'CLOSECONTAINER$': 13,
  'FLUSH$': 8,
  'FAKESHOOT$': 8,
  'RUB$': 9,
  'ZAPTO$': 10,
  'SCAN$': 8,
  'SPRAY$': 8,
  'MUNCH$': 8,
  'RESET$': 9,
  'WIND$': 8,
  'EXPLODE$': 8,
  'VSELECT$': 8,
  'SELL$': 9,
  'PAYTO$': 8,
  'PAID$': 30,
  'PAY$': 8,
  'ATTACK$': 9,
  'BASH$': 10,
  'SPEAK$': 14,
  'WISH$': 8,
}

const noopPresentationClient = () => ({
  send: async () => ({ err: 1 }),
  walkTo: async (x, y) => ({ x, y }),
})

function resolveHostDispatch(msg) {
  if (!msg?.op || !MIGRATED_OPS.has(msg.op)) return null
  if (msg.op === 'PLAY_$') {
    const pointedNoid = msg.from_noid != null ? msg.from_noid : msg.noid
    if (pointedNoid == null) return null
    return { pointedNoid, behavior: 'generic_PLAY' }
  }
  const fixed = HOST_FIXED_BEHAVIORS[msg.op]
  if (fixed) {
    let pointedNoid = msg.noid
    if (pointedNoid == null && (msg.op === 'OBJECTSPEAK_$' || msg.op === 'APPEARING_$' || msg.op === 'WAITFOR_$')) {
      pointedNoid = THE_REGION
    }
    if (pointedNoid == null) return null
    return { pointedNoid, behavior: fixed }
  }
  const slot = HOST_OP_SLOTS[msg.op]
  if (slot == null || msg.noid == null) return null
  return { pointedNoid: msg.noid, slot }
}

function pointedForHostDispatch(world, spec) {
  const rec = world.get(spec.pointedNoid)
  if (rec) return rec
  if (spec.behavior === 'generic_PLAY' || spec.behavior === 'generic_OBJECTSPEAK'
      || spec.behavior === 'region_APPEARING' || spec.behavior === 'region_WAITFOR') {
    return soundSourceRecord(world, spec.pointedNoid)
  }
  if (spec.pointedNoid === THE_REGION) {
    return { type: 'Region', noid: THE_REGION, mod: {} }
  }
  return null
}

function mergeClient(world, client) {
  return Object.assign({}, noopPresentationClient(), world._client || {}, client || {})
}

// Synchronous host dispatch — observer behaviors are sync so world.apply stays sync.
function dispatchHostSync(world, msg, client) {
  const spec = resolveHostDispatch(msg)
  if (!spec) return { ok: false, reason: 'unresolved-host-op' }
  const pointed = pointedForHostDispatch(world, spec)
  if (!pointed) return { ok: false, reason: 'no-pointed-object' }
  const name = spec.behavior || behaviorNameFor(pointed, spec.slot)
  if (!name) return { ok: false, reason: `no-such-slot:${spec.slot}` }
  const fn = behaviors[name]
  if (!fn) return { ok: false, reason: `unported:${name}` }
  const ctx = makeCtx(world, spec.slot, pointed, msg, mergeClient(world, client), null)
  return fn(ctx)
}

module.exports = {
  MIGRATED_OPS,
  HOST_OP_SLOTS,
  resolveHostDispatch,
  dispatchHostSync,
  noopPresentationClient,
}