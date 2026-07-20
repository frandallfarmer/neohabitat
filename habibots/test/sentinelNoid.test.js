/* Sentinel-noid guard — elko stamps a still-ghost avatar and its pocket
   contents (Head, Paper, Tokens) with backend-only UNASSIGNED_NOID (256),
   then broadcasts APPEARING_$ appearing=256 on the ghost's I_AM_HERE. The
   noid table must never index those makes: last-write-wins left the Tokens
   ("Money for X") at slot 256, and the hatchery welcomebot greeted new
   users' wallets. Noids are one byte on the C64 wire; >255 never names a
   real region slot. */
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const HabiBot = require('../habibot.js')

function makeMsg(to, ref, name, modType, noid) {
  return {
    op: 'make',
    to: to,
    obj: { type: 'item', ref: ref, name: name, mods: [{ type: modType, noid: noid }] },
  }
}

test('UNASSIGNED_NOID (256) makes are never indexed in the noid table', () => {
  const bot = new HabiBot('127.0.0.1', 9, 'testbot')
  // The new-user burst as elko sends it: avatar then contents, all noid 256.
  bot.processElkoMessage(makeMsg('context-hatchery', 'user-lostworld-1', 'LOSTWORLD', 'Avatar', 256))
  bot.processElkoMessage(makeMsg('user-lostworld-1', 'item-head.1-1', 'Default head for LOSTWORLD', 'Head', 256))
  bot.processElkoMessage(makeMsg('user-lostworld-1', 'item-paper.1-1', 'Paper for LOSTWORLD', 'Paper', 256))
  bot.processElkoMessage(makeMsg('user-lostworld-1', 'item-tokens.1-1', 'Money for LOSTWORLD', 'Tokens', 256))

  assert.equal(bot.getNoid(256), null, 'sentinel slot must resolve to null, not the Tokens')
  assert.ok(!(256 in bot.noids))
  // The avatar is still tracked by name, just not by (nonexistent) noid.
  assert.equal(bot.avatars['LOSTWORLD'].ref, 'user-lostworld-1')
})

test('real one-byte noids are still indexed, including the Ghost at 255', () => {
  const bot = new HabiBot('127.0.0.1', 9, 'testbot')
  bot.processElkoMessage(makeMsg('context-hatchery', 'user-lostworld-2', 'LOSTWORLD', 'Avatar', 27))
  bot.processElkoMessage(makeMsg('context-hatchery', 'i-ghost-1', 'Ghost', 'Ghost', 255))

  assert.equal(bot.getNoid(27).name, 'LOSTWORLD')
  assert.equal(bot.getNoid(255).name, 'Ghost')
})
