/* jshint esversion: 8 */

'use strict'

// capture.js — an in-bot wire tap for building habiworld test fixtures.
//
// When HABITAT_CAPTURE is set to a file path, every message the bot sends
// to the server and every message it receives is appended to that file as
// one JSON object per line (JSONL). The result is a faithful, replayable
// record of a live session — exactly the input habiworld's tests want:
// the `make` storm becomes a region fixture, and each send/reply/delta
// triple becomes a behavior test (see habiworld/test/*.test.js).
//
// Capture is OFF unless the env var is present, so production bots pay
// nothing. To record a session:
//
//   HABITAT_CAPTURE=/tmp/test-region.jsonl node bots/sage.js ... --loglevel debug
//
// then drive the bot (e.g. Randy summons SageBot into the TEST region and
// exercises each item class). Convert the JSONL into a fixture with
// habiworld/lib/tools/capture_to_fixture.js.
//
// Each line is: { t, dir, user, msg }
//   t    — ISO timestamp (orders the stream, ties replies to requests)
//   dir  — 'send' (bot → server) or 'recv' (server → bot)
//   user — the bot's username (a capture may interleave several bots)
//   msg  — the exact wire object, post name/state substitution

const fs = require('fs')
const nodePath = require('path')

class Capture {
  constructor(path, user) {
    this.path = path
    this.user = user
    // Ensure the parent dir exists — the capture path is usually a
    // gitignored subdir (e.g. /habibots/capture/) that may not be created
    // yet on a fresh checkout or container.
    fs.mkdirSync(nodePath.dirname(path), { recursive: true })
    // Append (not truncate): a single capture run may span several bot
    // reconnects, and multiple bots may share one file. Each line is
    // self-describing via `dir`/`user`, so interleaving is fine.
    this.stream = fs.createWriteStream(path, { flags: 'a' })
  }

  // Build from the environment, or return null when capture is disabled.
  // Called once per bot at construction; a null return means every later
  // record() call is skipped at the callsite (`bot._capture && ...`).
  static fromEnv(user) {
    const path = process.env.HABITAT_CAPTURE
    if (!path) return null
    return new Capture(path, user)
  }

  record(dir, msg) {
    if (!this.stream) return
    const line = JSON.stringify({
      t: new Date().toISOString(),
      dir,
      user: this.user,
      msg,
    })
    this.stream.write(line + '\n')
  }

  close() {
    if (this.stream) {
      this.stream.end()
      this.stream = null
    }
  }
}

module.exports = { Capture }
