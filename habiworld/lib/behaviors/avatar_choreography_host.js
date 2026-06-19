/* jshint esversion: 8 */

'use strict'

// Inbound choreography-only host messages: ATTACK$, BASH$, SPEAK$, PLAY_$.
// No object-table state — presentation via ctx.chore / ctx.sound / ctx.balloon.

const { byTypeName, classes: classTable } = require('../classes')
const { THE_REGION } = require('../constants')

function classSoundsFor(rec) {
  if (!rec?.type) return []
  const num = byTypeName[rec.type]
  const entry = num === undefined ? null : classTable[num]
  return entry?.sounds || []
}

function soundKeysForSfx(rec, sfxNumber) {
  if (sfxNumber == null) return []
  const table = classSoundsFor(rec)
  if (!table.length) return []
  const idx = sfxNumber & 0x7f
  const key = table[idx]
  if (!key) return []
  const keys = [key]
  if (sfxNumber >= 128) {
    const pw = table[idx + 1]
    if (pw) keys.push(pw)
  }
  return keys
}

function soundSourceRecord(world, noid) {
  if (noid === THE_REGION) return { type: 'Region', noid: THE_REGION }
  return world.get(noid)
}

function weaponChoreKind(weapon) {
  if (!weapon) return 'punch'
  const t = weapon.type
  if (t === 'Gun' || t === 'Stun_gun' || t === 'Fake_gun') return 'shoot'
  if (t === 'Knife' || t === 'Club') return 'knife'
  return 'punch'
}

function playAttackChore(ctx, attackerNoid) {
  const kind = weaponChoreKind(ctx.world.holding(attackerNoid))
  if (kind === 'shoot') {
    ctx.chore('shoot1', attackerNoid)
    ctx.sound('GUNSHOT', attackerNoid)
    ctx.chore('shoot2', attackerNoid)
  } else if (kind === 'knife') {
    ctx.chore('knife', attackerNoid)
  } else {
    ctx.chore('punch', attackerNoid)
  }
}

// avatar_ATTACK.m — neighbor weapon fire at an avatar; damage arrives separately.
function avatar_ATTACK(ctx) {
  const msg = ctx.args
  const attackerNoid = msg.noid ?? ctx.pointed.noid
  playAttackChore(ctx, attackerNoid)
  const damage = msg.ATTACK_DAMAGE
  const targetNoid = msg.ATTACK_TARGET
  if (damage && targetNoid != null) {
    const target = ctx.world.get(targetNoid)
    if (target?.type === 'Avatar') ctx.chore('get_shot', targetNoid)
  }
  return { ok: true }
}

// avatar_BASH.m — strike a non-avatar object; deletion arrives via GOAWAY_$ if any.
function avatar_BASH(ctx) {
  const msg = ctx.args
  const attackerNoid = msg.noid ?? ctx.pointed.noid
  playAttackChore(ctx, attackerNoid)
  return { ok: true }
}

// generic_SPEAK.m — word balloons (text on the wire).
function generic_SPEAK(ctx) {
  const text = ctx.args.text
  if (text) ctx.balloon(text)
  return { ok: true }
}

// generic_PLAY.bin — PLAY_$ resolves sfx_number against from_noid's class sound table.
function generic_PLAY(ctx) {
  const msg = ctx.args
  const sourceNoid = msg.from_noid != null ? msg.from_noid : ctx.pointed.noid
  const source = soundSourceRecord(ctx.world, sourceNoid)
  for (const key of soundKeysForSfx(source, msg.sfx_number)) {
    ctx.sound(key, sourceNoid)
  }
  return { ok: true }
}

module.exports = {
  avatar_ATTACK,
  avatar_BASH,
  generic_SPEAK,
  generic_PLAY,
  soundKeysForSfx,
  soundSourceRecord,
}