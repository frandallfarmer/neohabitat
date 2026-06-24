/* jshint esversion: 8 */

'use strict'

// Inbound choreography-only host messages — no object-table state.
// Presentation via ctx.chore / ctx.sound / ctx.balloon.

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
  if (text) {
    ctx.balloon(text, { speaker: ctx.pointed.noid, op: "SPEAK$" })
  }
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

// generic_OBJECTSPEAK — object/oracle word balloons (region channel).
function generic_OBJECTSPEAK(ctx) {
  const msg = ctx.args
  const text = msg.text
  if (text) {
    ctx.balloon(text, {
      speaker: msg.speaker,
      op: "OBJECTSPEAK_$",
      noQuip: msg.speaker == null,
    })
  }
  return { ok: true }
}

// shovel_DIG.m observer path — wire noid is the digging avatar, not the shovel.
function avatar_DIG(ctx) {
  const actor = ctx.args.noid ?? ctx.pointed.noid
  ctx.chore('bend_over', actor)
  ctx.sound('DIGGING', actor)
  ctx.chore('bend_back', actor)
  return { ok: true }
}

// avatar_TAKE.m — neighbor took a drug dose (effects arrive separately).
function avatar_TAKE(ctx) {
  const actor = ctx.args.noid ?? ctx.pointed.noid
  ctx.chore('hand_out', actor)
  ctx.chore('hand_back', actor)
  return { ok: true }
}

// escape_device_BUGOUT.m observer path — wire noid is the escaping avatar.
function avatar_BUGOUT(ctx) {
  const actor = ctx.args.noid ?? ctx.pointed.noid
  const dev = ctx.world.holding(actor)
  const soundNoid = dev?.type === 'Escape_device' ? dev.noid : actor
  ctx.sound('ESCAPE_DEVICE_ACTIVATES', soundNoid)
  return { ok: true }
}

// gr_state bit the server sets on an ARRIVING avatar's make (Region.I_AM_HERE clears it server-
// side and broadcasts APPEARING_$). Identical value to the C64's avatar_on_hold (equates.m 0x40),
// which render.m render-skips until APPEARING. Render-only: headless consumers (sagebot) ignore it.
const AVATAR_INVISIBLE = 0x40

// Region.java APPEARING_$ — the avatar (args.appearing) has caught up loading the region's
// contents vector. Clear its INVISIBLE / on-hold bit (C64 actions.m "OK!!! DRAW ME!") and notify
// so renderers repaint it — until now it was held (the make set the bit). The arriving avatar is
// the only one held; avatars already present in your make-storm never had the bit, so they drew
// immediately. (No-op for everything except the held avatar.)
function region_APPEARING(ctx) {
  const noid = ctx.args && ctx.args.appearing
  const av = noid != null ? ctx.world.get(noid) : null
  if (av && av.mod && (av.mod.gr_state & AVATAR_INVISIBLE)) {
    av.mod.gr_state &= ~AVATAR_INVISIBLE
    ctx.world.emit('stateChanged', av)
  }
  return { ok: true }
}

// Avatar.java WAITFOR_$ — pre-departure notification; delete follows separately.
function region_WAITFOR() {
  return { ok: true }
}

module.exports = {
  avatar_ATTACK,
  avatar_BASH,
  generic_SPEAK,
  generic_PLAY,
  generic_OBJECTSPEAK,
  avatar_DIG,
  avatar_TAKE,
  avatar_BUGOUT,
  region_APPEARING,
  region_WAITFOR,
  soundKeysForSfx,
  soundSourceRecord,
}