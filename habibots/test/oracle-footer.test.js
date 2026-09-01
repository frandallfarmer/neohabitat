/* jshint esversion: 8 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { askerFromFooter, askerFromMessage } = require('../lib/oracle-footer')

// These must stay in lockstep with formatOracleFooter in
// bridge_v2/bridge/oracle.go and its tests in oracle_test.go.
test('reads the ref and name the relay stamps', () => {
  assert.deepStrictEqual(askerFromFooter('user-randy · Randy'), { userRef: 'user-randy', name: 'Randy' })
})

test('a display name with spaces survives', () => {
  assert.deepStrictEqual(
    askerFromFooter('user-phil_collins · Phil Collins'),
    { userRef: 'user-phil_collins', name: 'Phil Collins' })
})

// The name is free-form, which is exactly why it is last.
test('a display name containing the separator round-trips', () => {
  assert.deepStrictEqual(
    askerFromFooter('user-phil_collins · Phil · Collins'),
    { userRef: 'user-phil_collins', name: 'Phil · Collins' })
})

test('non-oracle messages are rejected rather than half-parsed', () => {
  assert.strictEqual(askerFromFooter(null), null)
  assert.strictEqual(askerFromFooter(''), null)
  assert.strictEqual(askerFromFooter('some other bot footer'), null)
  assert.strictEqual(askerFromFooter('Randy · asked something'), null, 'must require the user- prefix')
  assert.strictEqual(askerFromFooter('user- · Randy'), null, 'a bare prefix is not a ref')
  assert.strictEqual(askerFromFooter('user-randy · '), null, 'a missing name is not answerable')
})

test('reads the first embed of a discord.js message', () => {
  const msg = { embeds: [{ footer: { text: 'user-randy · Randy' } }] }
  assert.deepStrictEqual(askerFromMessage(msg), { userRef: 'user-randy', name: 'Randy' })
  assert.strictEqual(askerFromMessage({ embeds: [] }), null)
  assert.strictEqual(askerFromMessage({}), null)
  assert.strictEqual(askerFromMessage({ embeds: [{}] }), null, 'plain-content posts are not requests')
})
