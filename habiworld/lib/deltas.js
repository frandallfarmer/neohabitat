/* jshint esversion: 8 */

'use strict'

// deltas.js — the host→client delta-op table.
//
// This is a port of the STATE EFFECTS of the original C64 client's
// asynchronous message handlers (sources/c64/Behaviors/*.m in the MADE
// repo), against the op set actually emitted by the neohabitat Java
// server (every send_neighbor_msg / send_broadcast_msg / fiddle /
// goaway call site).
//
// Design rule: each entry holds ONLY object-table mutations. Animation
// choreography (chores, sounds, cel timing) belongs to a renderer
// subscribing to HabitatWorld events, never here.
//
// Every op the server can send has a deliberate entry so nothing falls
// through silently:
//   apply(world, msg)  — ported state mutation, cites original source
//   choreography: true — intentionally no state effect (display/sound only)
//   todo: true         — known op, state effect not yet ported
//
// Wire shape note: ops built via new_neighbor_msg(noid, op) carry the
// acting object's noid in `noid`.

const {
  HANDS,
  HEAD,
  THE_REGION,
  OPEN_BIT,
  UNLOCKED_BIT,
  FIDDLE_FIELDS,
  FIDDLE_CONTAINED_OFFSET,
  FIDDLE_TOKEN_DENOM_OFFSET,
  FIDDLE_CUSTOMIZE_OFFSET,
} = require('./constants')

const DELTAS = {
  // WALK$ / POSTURE$ — migrated to lib/behaviors/avatar_motion_host.js
  // via dispatch_host.js.

  // GET$ / PUT$ / GRABFROM$ / THROW$ / WEAR$ / REMOVE$ — migrated to
  // lib/behaviors/avatar_inventory_host.js via dispatch_host.js.

  // ── field pokes ───────────────────────────────────────────────────

  // HabitatMod.java compose_fiddle_msg — poke `target` object's field
  // at C64 struct `offset` with `value` (int, or array when
  // argCount > 1). The C64 wrote the byte(s) straight into the object
  // block; we translate offsets to the JSON mod field names.
  'FIDDLE_$': {
    src: 'HabitatMod.java:2203 (compose_fiddle_msg)',
    apply(world, msg) {
      const o = world.get(msg.target)
      if (!o) return
      const values = Array.isArray(msg.value) ? msg.value : [msg.value]
      if (msg.offset === FIDDLE_TOKEN_DENOM_OFFSET) {
        // Two-byte little-endian token denomination (Tokens mod keeps
        // it split, mirroring the C64 layout).
        o.mod.denom_lo = values[0] || 0
        o.mod.denom_hi = values[1] || 0
      } else if (msg.offset === FIDDLE_CUSTOMIZE_OFFSET) {
        o.mod.custom = values
      } else if (msg.offset === FIDDLE_CONTAINED_OFFSET) {
        world._changeContainers(msg.target, values[0], o.mod.x, o.mod.y)
      } else if (FIDDLE_FIELDS[msg.offset]) {
        o.mod[FIDDLE_FIELDS[msg.offset]] = values[0]
      }
      world.emit('fieldChanged', o, msg.offset)
    },
  },

  // HabitatMod.java — region lighting adjustment (flashlights moving
  // in/out of opaque containers, switches).
  'CHANGELIGHT_$': {
    src: 'HabitatMod.java (send_broadcast_msg CHANGELIGHT_$)',
    apply(world, msg) {
      world.region.lighting += msg.adjustment || 0
      world.emit('lighting', world.region.lighting)
    },
  },

  // ── object lifecycle ──────────────────────────────────────────────

  // HabitatMod.java send_goaway_msg — remove the object at `target`
  // from the region (despawn, destroy, vendo restock, ghost exit...).
  'GOAWAY_$': {
    src: 'HabitatMod.java (send_goaway_msg)',
    apply(world, msg) {
      world._deleteByNoid(msg.target)
    },
  },

  // ── doors and containers ──────────────────────────────────────────

  // OPEN$ / CLOSE$ — migrated to lib/behaviors/avatar_door_host.js via dispatch_host.js

  // OPENCONTAINER$ / CLOSECONTAINER$ — migrated to lib/behaviors/avatar_container_host.js
  // via dispatch_host.js (BEHAVIOR_MIGRATION_PLAN.md Phase 2b).

  // ── orientation change ────────────────────────────────────────────

  // Changomatic.java / Behaviors/changomatic_CHANGE.m — sets orientation
  // on the target object to the host-dictated value.
  // Wire: { noid: changomatic, CHANGE_TARGET: target_noid, CHANGE_NEW_ORIENTATION: int }
  'CHANGE$': {
    src: 'Behaviors/changomatic_CHANGE.m / Changomatic.java',
    apply(world, msg) {
      const o = world.get(msg.CHANGE_TARGET)
      if (!o) return
      o.mod.orientation = msg.CHANGE_NEW_ORIENTATION
      world.emit('fieldChanged', o, null)
    },
  },

  // ── sex changer ───────────────────────────────────────────────────

  // Sex_changer.java — toggles bit 8 (0x100) of the avatar's orientation,
  // which encodes the body-type (male/female) flag. The machine's noid is
  // `noid`; AVATAR_NOID is the avatar being changed.
  // Wire: { noid: machine, AVATAR_NOID: avatar_noid }
  'SEXCHANGE$': {
    src: 'mods/Sex_changer.java',
    apply(world, msg) {
      const o = world.get(msg.AVATAR_NOID)
      if (!o) return
      o.mod.orientation = ((o.mod.orientation || 0) ^ 0x100)
      world.emit('fieldChanged', o, null)
    },
  },

  // ── game piece roll ───────────────────────────────────────────────

  // Game_piece.java / Die.java / Behaviors/die_ROLL.m — sets gr_state to
  // the roll result (face up). `newImage actor_noid` in C64 re-renders.
  // Wire: { noid: die/game_piece, state: int }
  'ROLL$': {
    src: 'Behaviors/die_ROLL.m / Game_piece.java',
    apply(world, msg) {
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.gr_state = msg.state
      world.emit('fieldChanged', o, null)
    },
  },

  // ── fake gun reset ────────────────────────────────────────────────

  // RESET$ — migrated to lib/behaviors/machines.js fake_gun_RESET via dispatch_host.js

  // ── bottle fill / pour ────────────────────────────────────────────

  // Bottle.java / Behaviors/avatar_FILL.m — sets filled=1 and gr_state=1
  // on the bottle (noid is the bottle). AVATAR_NOID is the acting avatar.
  // Wire: { noid: bottle, AVATAR_NOID: actor }
  'FILL$': {
    src: 'Behaviors/avatar_FILL.m / Bottle.java',
    apply(world, msg) {
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.filled = 1
      o.mod.gr_state = 1
      world.emit('fieldChanged', o, null)
    },
  },

  // Bottle.java / Behaviors/avatar_POUR.m — sets filled=0 and gr_state=0.
  // Wire: { noid: bottle, AVATAR_NOID: actor }
  'POUR$': {
    src: 'Behaviors/avatar_POUR.m / Bottle.java',
    apply(world, msg) {
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.filled = 0
      o.mod.gr_state = 0
      world.emit('fieldChanged', o, null)
    },
  },

  // ── sensor scan ───────────────────────────────────────────────────

  // SCAN$ — migrated to lib/behaviors/gadgets.js sensor_SCAN via dispatch_host.js

  // ── device on/off ─────────────────────────────────────────────────

  // Toggle.java:generic_ON / generic_OFF — sets mod.on and, for
  // Flashlight/Floor_lamp, also gr_state and region lighting.
  // Wire: { noid: toggle_object }  (no extra fields)
  'ON$': {
    src: 'Toggle.java:generic_ON',
    apply(world, msg) {
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.on = 1
      if (o.type === 'Flashlight' || o.type === 'Floor_lamp') {
        o.mod.gr_state = 1
        world.region.lighting = (world.region.lighting || 0) + 1
        world.emit('lighting', world.region.lighting)
      }
      world.emit('fieldChanged', o, null)
    },
  },
  'OFF$': {
    src: 'Toggle.java:generic_OFF',
    apply(world, msg) {
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.on = 0
      if (o.type === 'Flashlight' || o.type === 'Floor_lamp') {
        o.mod.gr_state = 0
        world.region.lighting = (world.region.lighting || 0) - 1
        world.emit('lighting', world.region.lighting)
      }
      world.emit('fieldChanged', o, null)
    },
  },

  // ── avatar sits / stands ──────────────────────────────────────────

  // Avatar.java:SITORSTAND — tracks sitting state via containerRef.
  // Sitting moves the avatar into the seat's slot (containerRef = seat);
  // standing returns them to the region. The Y coordinate is overloaded:
  // for sitting it's the slot index; for standing it's the floor Y.
  // Wire: { noid: avatar, up_or_down: 1=SIT_DOWN/0=STAND_UP, cont: seat_noid, slot: int }
  'SIT$': {
    src: 'Behaviors/avatar_SITORGETUP.m / Avatar.java',
    apply(world, msg) {
      const avatar = world.get(msg.noid)
      if (!avatar) return
      if (msg.up_or_down) { // SIT_DOWN
        world._changeContainers(msg.noid, msg.cont, 0, msg.slot || 0)
      } else { // STAND_UP
        const seat = world.get(msg.cont)
        const x = seat ? seat.mod.x : (avatar.mod.x || 80)
        const y = seat ? (seat.mod.y | 0x80) : 144
        world._changeContainers(msg.noid, 0 /* THE_REGION */, x, y)
      }
    },
  },

  // ── avatar spray-painted ──────────────────────────────────────────

  // SPRAY$ — migrated to lib/behaviors/gadgets.js spray_can_SPRAY via dispatch_host.js

  // ── vendo item selection ──────────────────────────────────────────

  // VSELECT$ — migrated to lib/behaviors/machines.js vendo_SELECT via dispatch_host.js

  // ── item dropped by avatar (out of band) ─────────────────────────

  // Avatar.java:drop_object_in_hand — broadcasts when the server forces
  // an avatar to drop what they're holding (region change, death, etc.).
  // Wire: { object_noid: int, container_noid: int, x: int, y: int }
  'CHANGE_CONTAINERS_$': {
    src: 'Avatar.java:drop_object_in_hand',
    apply(world, msg) {
      world._changeContainers(msg.object_noid, msg.container_noid, msg.x, msg.y)
    },
  },

  // ── windup toy wound ─────────────────────────────────────────────

  // WIND$ — migrated to lib/behaviors/consumables.js windup_toy_WIND via dispatch_host.js

  // ── token payments ────────────────────────────────────────────────

  // PAY$ — migrated to lib/behaviors/machines.js generic_PAY via dispatch_host.js
  // (Coke_machine; wire has amount only — no payer for observer debit)

  // PAYTO$ — migrated to lib/behaviors/machines.js generic_PAY / teleport_PAY
  // via dispatch_host.js

  // PAID$ — migrated to lib/behaviors/items.js avatar_PAID via dispatch_host.js

  // SELL$ — migrated to lib/behaviors/machines.js vendo_SELL via dispatch_host.js

  // ── choreography only (sound, animation, text) — deliberate no-ops ─

  'SPEAK$':      { choreography: true, src: 'word balloons' },
  'OBJECTSPEAK_$': { choreography: true, src: 'object word balloons' },
  'PLAY_$':      { choreography: true, src: 'sound effects' },
  'ATTACK$':     { choreography: true, src: 'Behaviors/avatar_ATTACK.m (anim; damage arrives via FIDDLE/CHANGE)' },
  'BASH$':       { choreography: true, src: 'Behaviors/avatar_BASH.m' },
  // FAKESHOOT$ / RUB$ — migrated to lib/behaviors/machines.js via dispatch_host.js
  'WISH$':       { choreography: true, src: 'mods (wish text)' },
  'WISH_MESSAGE':{ choreography: true, src: 'mods (wish text)' },
  // Avatar uses a drug/escape-device — decrement count is client-predicted
  // from the C64 but for observers the item count isn't visible; deletion
  // (if count hits 0) arrives via GOAWAY_$.
  'TAKE$':   { choreography: true, src: 'Behaviors/avatar_TAKE.m / Drugs.java' },
  'BUGOUT$': { choreography: true, src: 'Behaviors/avatar_BUGOUT.m / Escape_device.java' },
  // Animation-only ops: no object-table state changes.
  'DIG$':     { choreography: true, src: 'Behaviors/shovel_DIG.m / Shovel.java' },
  // MUNCH$ / FLUSH$ / ZAPTO$ / EXPLODE$ — migrated via dispatch_host.js
  // APPEARING_$: broadcast when an avatar enters. Their object arrives via
  // a separate make message; this is just an arrival notification.
  'APPEARING_$': { choreography: true, src: 'mods/Region.java (avatar arrival notification)' },
  // WAITFOR_$: the acting avatar is about to leave. Actual deletion arrives
  // via a separate delete message.
  'WAITFOR_$':   { choreography: true, src: 'mods/Avatar.java (pre-departure notification)' },
}

// Apply one delta op to the world. Unknown ops are emitted (by the
// caller) but never throw; todo entries emit 'unhandledDelta' so a
// shadow-mode consumer can count what it's missing.
function applyDelta(world, msg) {
  const entry = DELTAS[msg.op]
  if (!entry) return
  if (entry.apply) {
    entry.apply(world, msg)
  } else if (entry.todo) {
    world.emit('unhandledDelta', msg)
  }
  // choreography entries: nothing to do — state is unaffected.
}

module.exports = { DELTAS, applyDelta }
