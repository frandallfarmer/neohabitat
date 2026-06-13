/* jshint esversion: 8 */

'use strict'

// capture_to_fixture.js — turn a raw JSONL wire capture (from the bot's
// HABITAT_CAPTURE tap, habibots/lib/capture.js) into a segmented fixture
// that's easy to hand-write habiworld tests against.
//
//   node capture_to_fixture.js <capture.jsonl> [username] > fixture.json
//
// The output groups the stream into per-region "sessions". Each session:
//
//   {
//     context: "context-...",          // region ref (from the context make)
//     makeStorm: [ <make msg>, ... ],  // recv messages that build the region
//     exchanges: [                     // one per bot request, in order
//       { send: <req>, reply: <reply|null>, deltas: [ <ALLCAPS$ msg>, ... ] }
//     ]
//   }
//
// A makeStorm array feeds straight into world.apply() in a test's setup
// (like the existing inline makeStorm() helpers, but real and complete).
// Each exchange is the material for one behavior test: `send` is what the
// behavior must emit (assert calls.sends), `reply` is what to script into
// recorder([...]), and `deltas` are the broadcasts to apply and assert
// against world state.
//
// This does NOT write assertions — we hand-write those per class so each
// test documents the expected C64 semantics. It just slices the stream.

const fs = require('fs')

function readJsonl(path) {
  return fs.readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

// A delta op is a server broadcast that mutates client world state — by
// convention its op name ends in '$' (WALK$, OPENCONTAINER$, ROLL$, ...).
function isDelta(msg) {
  return typeof msg.op === 'string' && msg.op.endsWith('$')
}

function isMake(msg) {
  return msg.op === 'make' || msg.op === 'ready' || msg.op === 'delete'
}

function startsRegion(msg) {
  return msg.op === 'make' && msg.obj && msg.obj.type === 'context'
}

function segment(entries, user) {
  const sessions = []
  let cur = null

  // A pending request awaiting its reply. Habitat is single-request-in-
  // flight, so the next recv reply belongs to the most recent send.
  let pendingExchange = null

  const flushPending = () => {
    if (pendingExchange && cur) cur.exchanges.push(pendingExchange)
    pendingExchange = null
  }

  for (const e of entries) {
    if (user && e.user !== user) continue
    const m = e.msg

    if (e.dir === 'recv') {
      if (startsRegion(m)) {
        flushPending()
        cur = { context: m.obj.ref, makeStorm: [m], exchanges: [] }
        sessions.push(cur)
        continue
      }
      if (m.type === 'changeContext') {
        flushPending()
        cur = null
        continue
      }
      if (!cur) continue

      if (isMake(m) && !pendingExchange) {
        cur.makeStorm.push(m)
      } else if (m.type === 'reply') {
        if (pendingExchange) pendingExchange.reply = m
      } else if (isDelta(m)) {
        // A delta during an exchange is that request's result; a delta
        // with no pending request is an ambient world event — record it
        // as a zero-send exchange so it isn't lost.
        if (pendingExchange) pendingExchange.deltas.push(m)
        else cur.exchanges.push({ send: null, reply: null, deltas: [m] })
      }
    } else if (e.dir === 'send') {
      if (!cur) continue
      flushPending()
      pendingExchange = { send: m, reply: null, deltas: [] }
    }
  }
  flushPending()
  return sessions
}

function main() {
  const [path, user] = process.argv.slice(2)
  if (!path) {
    process.stderr.write('usage: capture_to_fixture.js <capture.jsonl> [username]\n')
    process.exit(2)
  }
  const sessions = segment(readJsonl(path), user)
  process.stdout.write(JSON.stringify(sessions, null, 2) + '\n')
}

if (require.main === module) main()

module.exports = { segment, isDelta, isMake, startsRegion }
