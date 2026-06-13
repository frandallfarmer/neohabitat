/* jshint esversion: 8 */

'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { segment } = require('../lib/tools/capture_to_fixture')

// Helpers to build capture entries the way habibots/lib/capture.js writes
// them: { t, dir, user, msg }.
let clock = 0
const recv = (msg, user = 'sagebot') => ({ t: String(clock++), dir: 'recv', user, msg })
const send = (msg, user = 'sagebot') => ({ t: String(clock++), dir: 'send', user, msg })

const ctxMake = (ref) => ({
  to: 'session', op: 'make',
  obj: { type: 'context', ref, name: ref, mods: [{ type: 'Region', neighbors: ['', '', '', ''] }] },
})
const itemMake = (ref, noid, type) => ({
  to: 'context-TEST', op: 'make',
  obj: { type: 'item', ref, name: type, mods: [{ type, noid, x: 40, y: 140 }] },
})

test('segment: one region with a make storm and a request/reply/delta exchange', () => {
  const entries = [
    recv(ctxMake('context-TEST')),
    recv(itemMake('item-die-1', 5, 'Die')),
    recv({ to: 'context-TEST', op: 'ready' }),
    send({ op: 'ROLL', to: 'item-die-1' }),
    recv({ type: 'reply', noid: 5, err: 1 }),
    recv({ op: 'ROLL$', noid: 5, new_value: 4 }),
  ]
  const sessions = segment(entries)
  assert.equal(sessions.length, 1)
  const s = sessions[0]
  assert.equal(s.context, 'context-TEST')
  assert.equal(s.makeStorm.length, 3) // context + item + ready
  assert.equal(s.exchanges.length, 1)
  assert.deepEqual(s.exchanges[0].send, { op: 'ROLL', to: 'item-die-1' })
  assert.equal(s.exchanges[0].reply.err, 1)
  assert.equal(s.exchanges[0].deltas.length, 1)
  assert.equal(s.exchanges[0].deltas[0].op, 'ROLL$')
})

test('segment: changeContext closes a session and a new make storm opens another', () => {
  const entries = [
    recv(ctxMake('context-TEST')),
    recv({ to: 'context-TEST', op: 'ready' }),
    recv({ type: 'changeContext', context: 'context-elsewhere', immediate: true }),
    recv(ctxMake('context-TEST2')),
    recv({ to: 'context-TEST2', op: 'ready' }),
  ]
  const sessions = segment(entries)
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].context, 'context-TEST')
  assert.equal(sessions[1].context, 'context-TEST2')
})

test('segment: a delta with no pending request becomes a zero-send exchange', () => {
  const entries = [
    recv(ctxMake('context-TEST')),
    recv({ to: 'context-TEST', op: 'ready' }),
    recv({ op: 'WALK$', noid: 21, x: 40, y: 170 }), // ambient neighbor walk
  ]
  const sessions = segment(entries)
  assert.equal(sessions[0].exchanges.length, 1)
  assert.equal(sessions[0].exchanges[0].send, null)
  assert.equal(sessions[0].exchanges[0].deltas[0].op, 'WALK$')
})

test('segment: filters to a single user when several bots interleave', () => {
  const entries = [
    recv(ctxMake('context-TEST'), 'sagebot'),
    recv(itemMake('item-die-1', 5, 'Die'), 'sagebot'),
    send({ op: 'SPEAK', to: 'ME', text: 'hi' }, 'elizabot'), // noise from another bot
    recv({ to: 'context-TEST', op: 'ready' }, 'sagebot'),
    send({ op: 'ROLL', to: 'item-die-1' }, 'sagebot'),
    recv({ type: 'reply', err: 1 }, 'sagebot'),
  ]
  const sessions = segment(entries, 'sagebot')
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].exchanges.length, 1)
  assert.equal(sessions[0].exchanges[0].send.op, 'ROLL')
})

test('segment: make messages after the first send are not folded into the storm', () => {
  // OPENCONTAINER$ streams contents as `make` AFTER the request — those
  // belong to the exchange's world effects, not the region make storm.
  const entries = [
    recv(ctxMake('context-TEST')),
    recv(itemMake('item-bag-1', 6, 'Bag')),
    recv({ to: 'context-TEST', op: 'ready' }),
    send({ op: 'OPEN', to: 'item-bag-1' }),
    recv({ type: 'reply', err: 1 }),
    recv({ op: 'OPENCONTAINER$', noid: 6, cont: 6 }),
  ]
  const sessions = segment(entries)
  assert.equal(sessions[0].makeStorm.length, 3) // context + bag + ready only
  assert.equal(sessions[0].exchanges.length, 1)
})
