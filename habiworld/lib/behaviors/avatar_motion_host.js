/* jshint esversion: 8 */

'use strict'

// Behaviors/avatar_WALK.m and avatar_POSTURE.m — inbound host messages for
// neighbor avatar movement and posture changes.

// Avatar.java POSTURE — persistent facing/stance (activity field); transient
// gestures are choreography-only (wave, punch, …).
const PERSISTENT_POSTURES = new Set([
  129, // STAND
  132, 133, 157, // SIT_GROUND, SIT_CHAIR, SIT_FRONT
  143, 146, // stand_back, STAND_FRONT
  251, 252, // STAND_LEFT, STAND_RIGHT
  254, 255, // FACE_LEFT, FACE_RIGHT
])

// webclient/habirender/codec.js choreographyActions — AV_ACT index → name.
const CHOREOGRAPHY_ACTIONS = [
  'init', 'stand', 'walk', 'hand_back', 'sit_floor', 'sit_chair', 'bend_over',
  'bend_back', 'point', 'throw', 'get_shot', 'jump', 'punch', 'wave',
  'frown', 'stand_back', 'walk_front', 'walk_back', 'stand_front',
  'unpocket', 'gimme', 'knife', 'arm_get', 'hand_out', 'operate',
  'arm_back', 'shoot1', 'shoot2', 'nop', 'sit_front',
]

const FACE_BACK = 143
const STAND_FRONT = 146
const FACE_LEFT = 254
const FACE_RIGHT = 255
const STAND_LEFT = 251
const STAND_RIGHT = 252

// Mirror webclient/lib/avatar-chore.js choreographyNameFromAvAct.
function choreNameForPosture(avAct) {
  const a = avAct ?? 129
  if (a === FACE_BACK) return 'stand_back'
  if (a === STAND_FRONT) return 'stand_front'
  if (a === 157) return 'sit_front'
  if (a === FACE_LEFT || a === FACE_RIGHT || a === STAND_LEFT || a === STAND_RIGHT) {
    return 'stand'
  }
  const index = a & 0x7f
  if (index >= CHOREOGRAPHY_ACTIONS.length || index >= 123) return 'stand'
  const name = CHOREOGRAPHY_ACTIONS[index]
  return (name === 'init' || name === 'nop') ? 'stand' : name
}

// avatar_WALK.m — async host WALK$ (comm_control.m phantom_request → GetAction slot 8).
// getResponse WALK_TO_X/Y/HOW → chainTo v_start_walk; no instant position write on C64.
function avatar_WALK(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const o = world.get(msg.noid)
  if (!o) return { ok: false, reason: 'no-avatar' }
  const x = msg.x
  const y = msg.y
  const how = msg.how
  if (y === 0) return { ok: false, reason: 'walk-failed' }
  if (ctx.client.startWalk) ctx.client.startWalk(msg.noid, x, y, how)
  o.mod.x = x
  o.mod.y = y
  world.emit('moved', o)
  return { ok: true }
}

// avatar_POSTURE.m — POSTURE$ wire: { noid: actor, new_posture }
function avatar_POSTURE(ctx) {
  const world = ctx.world
  const msg = ctx.args
  const posture = msg.new_posture
  if (posture == null) return { ok: false, reason: 'no-posture' }
  if (PERSISTENT_POSTURES.has(posture)) {
    const o = world.get(msg.noid)
    if (!o) return { ok: false, reason: 'no-avatar' }
    o.mod.activity = posture
    world.emit('stateChanged', o)
  } else {
    const chore = choreNameForPosture(posture)
    if (chore && chore !== 'stand') ctx.chore(chore, msg.noid)
  }
  return { ok: true }
}

module.exports = { avatar_WALK, avatar_POSTURE }