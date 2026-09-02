/* jshint esversion: 8 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { OracleOutbox } = require('../lib/oracle-outbox')

// Port 1 refuses immediately, so these exercise the in-memory fallback
// the outbox degrades to when mongo is unreachable — the same path a dev
// box without the docker stack takes.
const offline = () => new OracleOutbox('mongodb://127.0.0.1:1')

test('the first answer to a request is inserted', async () => {
  const box = offline()
  assert.strictEqual(await box.enqueue({ id: 'm1', recipient: 'randy', body: 'seek within' }), 'inserted')
})

// Two Oracles can both open a modal on the same message. Only the first
// may mail, even while the first is still queued and undelivered.
test('a second answer to the same request is refused, not queued twice', async () => {
  const box = offline()
  await box.enqueue({ id: 'm1', recipient: 'randy', body: 'first' })
  assert.strictEqual(await box.enqueue({ id: 'm1', recipient: 'randy', body: 'second' }), 'queued')
  assert.strictEqual((await box.pending()).length, 1)
  assert.strictEqual((await box.pending())[0].body, 'first')
})

test('an already-delivered request reports sent', async () => {
  const box = offline()
  await box.enqueue({ id: 'm1', recipient: 'randy', body: 'first' })
  await box.markSent('m1')
  assert.strictEqual(await box.enqueue({ id: 'm1', recipient: 'randy', body: 'second' }), 'sent')
  assert.deepStrictEqual(await box.pending(), [])
})

test('answers awaiting delivery come back oldest first', async () => {
  const box = offline()
  await box.enqueue({ id: 'm1', recipient: 'randy', body: 'one' })
  await box.enqueue({ id: 'm2', recipient: 'steve', body: 'two' })
  assert.deepStrictEqual((await box.pending()).map((e) => e._id), ['m1', 'm2'])
})

// A delivery failure must leave the answer queued so the next drain
// retries it — the operator should never have to retype a letter.
test('a failed delivery stays queued', async () => {
  const box = offline()
  await box.enqueue({ id: 'm1', recipient: 'randy', body: 'one' })
  await box.noteFailure('m1', 'the Oracle is not in-world yet')
  const pending = await box.pending()
  assert.strictEqual(pending.length, 1)
  assert.strictEqual(pending[0].lastError, 'the Oracle is not in-world yet')
  assert.strictEqual(pending[0].attempts, 1)
})

// The mail peek decides whether to re-enter the region. If mongo is
// unreachable it must read as "no mail" — an error must never turn into a
// storm of region entries, which is what trips the region's capacity limit.
test('the mail peek reads as empty when mongo is unreachable', async () => {
  const box = offline()
  assert.strictEqual(await box.queuedMailFor('oracle'), 0)
  assert.strictEqual(await box.queuedMailFor('anybody'), 0)
})
