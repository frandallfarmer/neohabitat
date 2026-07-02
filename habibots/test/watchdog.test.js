/* Session watchdog (resetSession + consecutive-reset give-up) — the recovery
   layer that keeps a bot from wedging silently on a dead session (the
   2026-07-02 SageBot lock-up). Exercises the logic directly on a HabiBot
   instance with a fake socket; no network. */
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const HabiBot = require('../habibot.js')

// A HabiBot wired to a fake, already-"connected" socket so resetSession runs
// its real path (destroy → would-be reconnect) without touching the network.
// server.write invokes its callback so real sendWithDelay/sendForReply/newRegion
// sends resolve — the integration tests below drive those actual code paths.
function fakeBot(maxResets) {
  const bot = new HabiBot('127.0.0.1', 9, 'testbot')
  bot.config.maxConsecutiveResets = maxResets || 5
  bot.config.shouldReconnect = false // don't schedule real reconnects in onDisconnect
  bot.connected = true
  let destroys = 0
  bot.server = {
    destroy: () => { destroys++; bot.connected = false },
    write: (data, enc, cb) => { if (typeof cb === 'function') cb() },
  }
  return { bot, destroys: () => destroys }
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms))

test('resetSession drops the socket, counts, and debounces while resetting', () => {
  const { bot, destroys } = fakeBot()
  bot.resetSession('reply:GET')
  assert.equal(bot._consecutiveResets, 1)
  assert.equal(destroys(), 1)
  assert.equal(bot._resetting, true)
  assert.equal(bot._resetHistory.length, 1)
  assert.equal(bot._resetHistory[0].reason, 'reply:GET')

  // Debounced: a second timeout mid-reset must NOT drop the socket again.
  bot.resetSession('reply:WALK')
  assert.equal(bot._consecutiveResets, 1, 'no increment while a reset is in flight')
  assert.equal(destroys(), 1, 'no second destroy')
})

test('_noteSuccess clears the consecutive-reset count', () => {
  const { bot } = fakeBot()
  bot.resetSession('transit:newRegion(0)')
  assert.equal(bot._consecutiveResets, 1)
  // Simulate reconnect completing so a new reset is allowed.
  bot._resetting = false
  bot.connected = true
  bot._noteSuccess()
  assert.equal(bot._consecutiveResets, 0)
  assert.ok(bot._lastSuccessAt <= Date.now())
})

test('gives up (process.exit) after maxConsecutiveResets with no success between', () => {
  const { bot, destroys } = fakeBot(3)
  const realExit = process.exit
  let exitCode = null
  process.exit = (code) => { exitCode = code; throw new Error('__exit__') }
  try {
    // Reset 1 and 2 succeed (each followed by a "reconnect"); 3rd trips the cap.
    for (let i = 0; i < 3; i++) {
      bot._resetting = false
      bot.connected = true
      try { bot.resetSession(`reply:OP${i}`) } catch (e) {
        if (e.message !== '__exit__') throw e
      }
    }
  } finally {
    process.exit = realExit
  }
  assert.equal(exitCode, 1, 'exited with code 1 on give-up')
  assert.equal(bot._consecutiveResets, 3)
  // The 3rd reset is the give-up: it must NOT have destroyed a socket
  // (it exits instead), so only the first two dropped sockets.
  assert.equal(destroys(), 2)
})

test('a success between resets prevents give-up (counter never reaches cap)', () => {
  const { bot } = fakeBot(3)
  const realExit = process.exit
  let exited = false
  process.exit = () => { exited = true; throw new Error('__exit__') }
  try {
    for (let i = 0; i < 6; i++) {
      bot._resetting = false
      bot.connected = true
      bot.resetSession(`reply:OP${i}`)
      assert.equal(bot._consecutiveResets, 1)
      bot._noteSuccess() // recovered each time
      assert.equal(bot._consecutiveResets, 0)
    }
  } finally {
    process.exit = realExit
  }
  assert.equal(exited, false, 'never gave up because every reset was followed by a success')
})

// ── integration: the real failure conditions actually drive recovery ──
// The tests above poke resetSession/_noteSuccess directly; these exercise
// the wiring — a stuck sendForReply / newRegion must reset, and a real
// reply / arrival must count as success.

test('sim failure: a reply that never arrives resets the session and rejects', async () => {
  const { bot, destroys } = fakeBot()
  let err = null
  // send resolves via fake write; no reply is ever delivered → timeout.
  await bot.sendForReply({ op: 'GET', to: 'item-x' }, 80).catch((e) => { err = e.message })
  assert.match(err, /timed out .* waiting for reply/)
  assert.equal(destroys(), 1, 'the stuck reply dropped the socket')
  assert.equal(bot._consecutiveResets, 1)
  assert.equal(bot._resetHistory[0].reason, 'reply:GET')
})

test('sim success: a delivered reply resolves and clears the reset count', async () => {
  const { bot, destroys } = fakeBot()
  bot._consecutiveResets = 2 // pretend we'd been resetting; a success must zero it
  const p = bot.sendForReply({ op: 'GET', to: 'item-x' }, 5000)
  await tick(700) // send() has a ~500ms pre-send delay; wait past it so
                  // _pendingReply is registered before we deliver the reply
  bot.processElkoMessage({ type: 'reply', ok: true, note: 'here you go' })
  const reply = await p
  assert.equal(reply.ok, true)
  assert.equal(bot._consecutiveResets, 0, '_noteSuccess zeroed the counter')
  assert.equal(destroys(), 0, 'no reset on a healthy round-trip')
})

test('sim failure: a transit whose arrival never comes resets and rejects', async () => {
  const { bot, destroys } = fakeBot()
  let err = null
  // NEWREGION send resolves; no enteredRegion is ever fired → transit timeout.
  // Timeout must exceed send()'s ~500ms pre-send delay (as it always does in
  // production: 15s timeout vs 500ms send) so the arrival waiter is attached
  // before the timer fires.
  await bot.newRegion(0, 750).catch((e) => { err = e.message })
  assert.match(err, /timed out .* waiting for enteredRegion/)
  assert.equal(destroys(), 1, 'the dead transit dropped the socket')
  assert.equal(bot._consecutiveResets, 1)
  assert.equal(bot._resetHistory[0].reason, 'transit:newRegion(0)')
})

test('sim success: a completed transit clears the reset count without a reset', async () => {
  const { bot, destroys } = fakeBot()
  bot._consecutiveResets = 2
  const p = bot.newRegion(0, 5000)
  // Fire the arrival the way an inbound you:true make would (different region
  // ref than start so the same-region silent-reconnect guard lets it through).
  bot.callbacks.enteredRegion.forEach((cb) => cb(bot, { to: 'context-elsewhere' }))
  await p
  assert.equal(bot._consecutiveResets, 0, 'arrival counted as success')
  assert.equal(destroys(), 0)
})

test('diagnostic snapshot carries the forensic fields', () => {
  const { bot } = fakeBot()
  bot._pendingReplyOp = 'GET'
  const snap = bot._diagnosticSnapshot()
  assert.equal(snap.bot, 'testbot')
  assert.equal(snap.awaitingReplyOp, 'GET')
  assert.equal(typeof snap.msSinceInbound, 'number')
  assert.equal(typeof snap.msSinceSuccess, 'number')
  assert.equal(typeof snap.consecutiveResets, 'number')
  assert.ok(Array.isArray(snap.exits))
})
