/* jshint esversion: 8 */

'use strict'

// Host-message slot delegates (action table slots 8+ on avatar and
// region). On the C64 these behaviors applied the state change a host
// message announced; in habiworld that work already lives in
// lib/deltas.js, keyed by wire op name. Each delegate hands its ctx
// args (the raw message fields) to the same delta handler, so the
// class table is truthful about slots 8+ without duplicating the
// mutation logic. When world.apply switches from the flat delta map to
// table dispatch, these become the real route.
//
// Not delegated here (left unported deliberately): avatar_DIE and
// avatar_REINCARNATE (the death sequence is Tier-4 choreography) and
// ask_for_help (a UI flow).

const { applyDelta } = require('../deltas')

// slot-behavior name → wire op consumed by deltas.js
const HOST_OPS = {
  avatar_WALK: 'WALK$',             // Behaviors/avatar_WALK.m
  avatar_ATTACK: 'ATTACK$',         // Behaviors/avatar_ATTACK.m
  avatar_BASH: 'BASH$',             // Behaviors/avatar_BASH.m
  generic_SPEAK: 'SPEAK$',          // Behaviors/generic_SPEAK.m (no state)
  avatar_GETM: 'GET$',              // Behaviors/avatar_GET_uppercase.m
  avatar_SITORGETUP: 'SIT$',        // Behaviors/avatar_SITORGETUP.m
  avatar_GRABFROM: 'GRABFROM$',     // Behaviors/avatar_GRABFROM.m
  avatar_POSTURE: 'POSTURE$',       // Behaviors/avatar_POSTURE.m
  avatar_PUTM: 'PUT$',              // Behaviors/avatar_PUT_uppercase.m
  avatar_THROW: 'THROW$',           // Behaviors/avatar_THROW.m
  avatar_WEAR: 'WEAR$',             // Behaviors/avatar_WEAR.m
  avatar_REMOVE: 'REMOVE$',         // Behaviors/avatar_REMOVE.m
  bottle_FILL: 'FILL$',             // Behaviors/bottle_FILL.m
  bottle_POUR: 'POUR$',             // Behaviors/bottle_POUR.m
}

const delegates = {}
for (const [name, op] of Object.entries(HOST_OPS)) {
  delegates[name] = async function hostMessageDelegate(ctx) {
    applyDelta(ctx.world, Object.assign({ op: op }, ctx.args))
    return { ok: true }
  }
  Object.defineProperty(delegates[name], 'name', { value: name })
}

module.exports = delegates
