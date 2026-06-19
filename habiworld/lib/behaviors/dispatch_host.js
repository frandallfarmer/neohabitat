/* jshint esversion: 8 */

'use strict'

// Inbound host-message dispatch (class table slots 8+). Replaces the flat
// deltas.js path for migrated ops — see BEHAVIOR_MIGRATION_PLAN.md.

const behaviors = require('./index')
const { makeCtx } = require('./kernel')
const { behaviorNameFor } = require('./dispatch')

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
])

// Host message slot numbers (Constants.java) — class-table slot on msg.noid object.
// Ops where the server puts an avatar noid on the wire (DIG$, TAKE$, BUGOUT$) stay in
// deltas.js until pointed-object resolution is extended.
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
}

const noopPresentationClient = () => ({
  send: async () => ({ err: 1 }),
  walkTo: async (x, y) => ({ x, y }),
})

function resolveHostDispatch(msg) {
  if (!msg?.op || !MIGRATED_OPS.has(msg.op)) return null
  const slot = HOST_OP_SLOTS[msg.op]
  if (slot == null || msg.noid == null) return null
  return { pointedNoid: msg.noid, slot }
}

function mergeClient(world, client) {
  return Object.assign({}, noopPresentationClient(), world._client || {}, client || {})
}

// Synchronous host dispatch — observer behaviors are sync so world.apply stays sync.
function dispatchHostSync(world, msg, client) {
  const spec = resolveHostDispatch(msg)
  if (!spec) return { ok: false, reason: 'unresolved-host-op' }
  const pointed = world.get(spec.pointedNoid)
  if (!pointed) return { ok: false, reason: 'no-pointed-object' }
  const name = behaviorNameFor(pointed, spec.slot)
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