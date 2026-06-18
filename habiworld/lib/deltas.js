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

// v_spend for delta handlers: debit the token wad held by avatarNoid.
function debitTokens(world, avatarNoid, amount) {
  if (avatarNoid === undefined || !amount) return
  const wad = world.holding(avatarNoid)
  if (!wad || wad.type !== 'Tokens') return
  const denom = (wad.mod.denom_hi || 0) * 256 + (wad.mod.denom_lo || 0)
  const left = Math.max(0, denom - amount)
  wad.mod.denom_lo = left & 0xff
  wad.mod.denom_hi = (left >> 8) & 0xff
}

const DELTAS = {
  // ── movement ──────────────────────────────────────────────────────

  // Behaviors/avatar_WALK.m — client animates a walk to (x, y); the
  // final object-table state is simply the destination. y arrives with
  // the FOREGROUND_BIT (128) OR'd in, same as at make time; we store
  // it raw, matching the C64.
  'WALK$': {
    src: 'Behaviors/avatar_WALK.m',
    apply(world, msg) {
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.x = msg.x
      o.mod.y = msg.y
      world.emit('moved', o)
    },
  },

  // ── container changes ─────────────────────────────────────────────

  // Behaviors/avatar_GET_uppercase.m:40 — `changeContainers 0,
  // AVATAR_HAND, actor_noid`: the target item moves into the acting
  // avatar's HANDS slot at x=0. `how` (ground vs pocket) only selects
  // the bend-over vs reach-for-pocket chore.
  'GET$': {
    src: 'Behaviors/avatar_GET_uppercase.m',
    apply(world, msg) {
      world._changeContainers(msg.target, msg.noid, 0, HANDS)
    },
  },

  // Behaviors/avatar_PUT_uppercase.m — host dictates the item's new
  // orientation, then `v_change_containers` with (container, x, y).
  // cont=0 means the region (item dropped on the ground at x, y);
  // otherwise y is the destination slot.
  'PUT$': {
    src: 'Behaviors/avatar_PUT_uppercase.m',
    apply(world, msg) {
      const item = world.get(msg.obj)
      if (!item) return
      if (msg.orient !== undefined) item.mod.orientation = msg.orient
      world._changeContainers(msg.obj, msg.cont, msg.x, msg.y)
    },
  },

  // Avatar.java:559/601 — an avatar grabs the item out of another
  // avatar's HANDS. `avatar_noid` is the victim; the grabbed item is
  // whatever their HANDS slot holds; it lands in the actor's HANDS.
  'GRABFROM$': {
    src: 'Behaviors/avatar_GRABFROM.m',
    apply(world, msg) {
      const item = world.holding(msg.avatar_noid)
      if (!item) return
      world._changeContainers(item.noid, msg.noid, 0, HANDS)
    },
  },

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

  // ── item throw ────────────────────────────────────────────────────

  // Behaviors/avatar_THROW.m — actor throws the item in their HANDS.
  // changeContainers puts it on the ground at (x, y); orientation's LSB
  // is cleared (the "moving" bit used during the throw chore).
  // Wire: { noid: actor, obj: item, x, y, hit }
  'THROW$': {
    src: 'Behaviors/avatar_THROW.m',
    apply(world, msg) {
      const item = world.get(msg.obj)
      if (!item) return
      if (item.mod.orientation !== undefined) {
        item.mod.orientation = item.mod.orientation & ~1
      }
      world._changeContainers(msg.obj, THE_REGION, msg.x, msg.y)
    },
  },

  // ── head wear / remove ────────────────────────────────────────────

  // Behaviors/avatar_WEAR.m — `changeContainers 0, AVATAR_HEAD, actor_noid`:
  // the item in the actor's HANDS moves to their HEAD slot (slot 6).
  // Wire: { noid: actor }
  'WEAR$': {
    src: 'Behaviors/avatar_WEAR.m',
    apply(world, msg) {
      const item = world.holding(msg.noid)
      if (!item) return
      world._changeContainers(item.noid, msg.noid, 0, HEAD)
    },
  },

  // Behaviors/avatar_REMOVE.m — `changeContainers 0, AVATAR_HAND, actor_noid`:
  // the head item (target) moves from the HEAD slot back to the HANDS slot.
  // Wire: { noid: actor, target: head_item_noid }
  'REMOVE$': {
    src: 'Behaviors/avatar_REMOVE.m',
    apply(world, msg) {
      world._changeContainers(msg.target, msg.noid, 0, HANDS)
    },
  },

  // ── doors and containers ──────────────────────────────────────────

  // Openable.java / Behaviors/avatar_OPEN.m — sets open_flags = OPEN_BIT | UNLOCKED_BIT
  // on the door/gate (target). The C64 `putProp subject, DOOR_flags`.
  // Wire: { noid: actor, target: door_noid }
  'OPEN$': {
    src: 'Behaviors/avatar_OPEN.m / Openable.java',
    apply(world, msg) {
      const o = world.get(msg.target)
      if (!o) return
      o.mod.open_flags = OPEN_BIT | UNLOCKED_BIT
      world.emit('fieldChanged', o, null)
    },
  },

  // Openable.java / Behaviors/avatar_CLOSE.m — sets open_flags to the
  // host-supplied value (typically 0 = closed; UNLOCKED_BIT may survive).
  // Wire: { noid: actor, target: door_noid, open_flags: int }
  'CLOSE$': {
    src: 'Behaviors/avatar_CLOSE.m / Openable.java',
    apply(world, msg) {
      const o = world.get(msg.target)
      if (!o) return
      o.mod.open_flags = msg.open_flags || 0
      world.emit('fieldChanged', o, null)
    },
  },

  // Openable.java / Behaviors/avatar_OPENCONTAINER.m — sets OPEN_BIT|UNLOCKED_BIT
  // on the container. Contents arrive as separate make messages (elko sends
  // them asynchronously), so there's nothing to unpack here.
  // Wire: { noid: actor, cont: container_noid }
  'OPENCONTAINER$': {
    src: 'Behaviors/avatar_OPENCONTAINER.m / Openable.java',
    apply(world, msg) {
      const o = world.get(msg.cont)
      if (!o) return
      o.mod.open_flags = OPEN_BIT | UNLOCKED_BIT
      world.emit('fieldChanged', o, null)
    },
  },

  // Openable.java / Behaviors/avatar_CLOSECONTAINER.m — sets open_flags to
  // the supplied value, then purges the container's contents from the local
  // object table (matching C64 `chainTo v_purge_contents`). The server does
  // NOT send GOAWAY for each item; the client is responsible for the purge.
  // Wire: { noid: actor, cont: container_noid, open_flags: int }
  'CLOSECONTAINER$': {
    src: 'Behaviors/avatar_CLOSECONTAINER.m / Openable.java',
    apply(world, msg) {
      const o = world.get(msg.cont)
      if (!o) return
      o.mod.open_flags = msg.open_flags || 0
      world.emit('fieldChanged', o, null)
      world.contentsOf(msg.cont).forEach((item) => world._deleteByNoid(item.noid))
    },
  },

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

  // Fake_gun.java / Behaviors/fake_gun_RESET.m — gun resets to READY state
  // (gr_state 0). `state` in the wire is the gun's secondary state field.
  // Wire: { noid: fake_gun, state: int }
  'RESET$': {
    src: 'Behaviors/fake_gun_RESET.m / Fake_gun.java',
    apply(world, msg) {
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.gr_state = 0 // FAKE_GUN_READY
      world.emit('fieldChanged', o, null)
    },
  },

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

  // Sensor.java — sets gr_state to the scan result. The sensor object is
  // the actor (noid); scan_type is the result value.
  // Wire: { noid: sensor, scan_type: int }
  'SCAN$': {
    src: 'mods/Sensor.java',
    apply(world, msg) {
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.gr_state = msg.scan_type
      world.emit('fieldChanged', o, null)
    },
  },

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

  // Spray_can.java — updates the sprayee's custom[] appearance array.
  // Wire: { noid: spray_can, SPRAY_SPRAYEE: avatar_noid,
  //         SPRAY_CUSTOMIZE_0: int, SPRAY_CUSTOMIZE_1: int }
  'SPRAY$': {
    src: 'mods/Spray_can.java',
    apply(world, msg) {
      const sprayee = world.get(msg.SPRAY_SPRAYEE)
      if (!sprayee) return
      sprayee.mod.custom = [msg.SPRAY_CUSTOMIZE_0 || 0, msg.SPRAY_CUSTOMIZE_1 || 0]
      world.emit('fieldChanged', sprayee, null)
    },
  },

  // ── vendo item selection ──────────────────────────────────────────

  // Vendo_front.java / Behaviors/vendo_SELECT.m — someone cycled the display.
  // Wire: { noid: vendo_front, price_lo, price_hi, display_item }
  // Mirrors the same container swap vendo_do does: display window = slot 1 in
  // vendo_inside; inventory items live in vendo_front at their numbered slots.
  'VSELECT$': {
    src: 'mods/Vendo_front.java / Behaviors/vendo_SELECT.m',
    apply(world, msg) {
      const front = world.get(msg.noid)
      if (!front) return
      const newDisplayItem = msg.display_item
      if (newDisplayItem === undefined || newDisplayItem === 255) return
      const inside = world.getByRef(front.containerRef)
      if (inside) {
        const oldDisplay = world.inventory(inside.noid).find((o) => o.mod.y === 1)
        if (oldDisplay) world._changeContainers(oldDisplay.noid, front.noid, 0, front.mod.display_item || 0)
        const newDisplay = world.inventory(front.noid).find((o) => o.mod.y === newDisplayItem)
        if (newDisplay) world._changeContainers(newDisplay.noid, inside.noid, 0, 1)
      }
      front.mod.display_item = newDisplayItem
      front.mod.item_price = ((msg.price_hi || 0) << 8) | (msg.price_lo & 0xff)
      world.emit('fieldChanged', front, null)
    },
  },

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

  // Windup_toy.java — wind_level increments (cap 4).
  // Wire: { noid: windup_toy }
  'WIND$': {
    src: 'mods/Windup_toy.java',
    apply(world, msg) {
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.wind_level = Math.min(4, (o.mod.wind_level || 0) + 1)
      world.emit('fieldChanged', o, null)
    },
  },

  // ── token payments ────────────────────────────────────────────────

  // PAY$ — simple coin-op payment (Coke_machine, fare_box, etc.)
  // Wire: { noid: machine_noid, amount_lo, amount_hi }
  // C64: coke_machine_PAY.m / generic_PAY.m read BUYER from byte 0 of the
  // response vector (C64 binary protocol always prepended the actor's noid).
  // Neohabitat's JSON protocol does not include that byte, so the buyer is
  // unknown to observers — no token debit is possible here.
  'PAY$': {
    src: 'Behaviors/generic_PAY.m (buyer noid absent in neohabitat JSON wire)',
    apply(/* world, msg */) {},
  },

  // PAYTO$ — credit-card / coin-op payment with explicit payer (fortune
  // machine, teleport booth). Wire: { noid: machine_noid, payer, amount_lo,
  // amount_hi }. Also activates the teleport booth display.
  // C64: fortune_machine_PAY.m, teleport_PAY.m
  'PAYTO$': {
    src: 'mods/Fortune_machine.java / Teleport.java → Behaviors/teleport_PAY.m',
    apply(world, msg) {
      const amount = (msg.amount_lo || 0) + (msg.amount_hi || 0) * 256
      debitTokens(world, msg.payer, amount)
      const machine = world.get(msg.noid)
      if (machine && machine.type === 'Teleport') {
        machine.mod.state = 1 // TELEPORT_ACTIVE (teleport_PAY.m)
        world.emit('fieldChanged', machine, null)
      }
    },
  },

  // PAID$ — recipient gets tokens from a PAYTO: materialise the new wad and
  // debit the payer. Wire: { noid: recipient_avatar_noid, payer, amount_lo,
  // amount_hi, container: recipient_ref, object: <encoded Tokens item> }
  // C64: avatar_PAID.m — v_spend (payer) + v_unpack_contents_vector
  'PAID$': {
    src: 'Behaviors/avatar_PAID.m / Tokens.java',
    apply(world, msg) {
      const amount = (msg.amount_lo || 0) + (msg.amount_hi || 0) * 256
      debitTokens(world, msg.payer, amount)
      if (msg.object) world._makeObject(msg.object, msg.container || '', false)
    },
  },

  // SELL$ — vendo machine sold an item: materialise it in the region and
  // debit the buyer. Wire: { noid: vendo_noid, buyer, item_price_lo,
  // item_price_hi, object: <encoded item> }
  // C64: vendo_SELL.m — v_spend (buyer) + v_unpack_contents_vector → region
  'SELL$': {
    src: 'Behaviors/vendo_SELL.m / Vendo_front.java',
    apply(world, msg) {
      const price = (msg.item_price_lo || 0) + (msg.item_price_hi || 0) * 256
      debitTokens(world, msg.buyer, price)
      if (msg.object) world._makeObject(msg.object, world.region.ref, false)
    },
  },

  // ── choreography only (sound, animation, text) — deliberate no-ops ─

  // Avatar.java POSTURE — broadcast chore for gestures; activity field updates for facing.
  'POSTURE$': {
    src: 'Behaviors/avatar_POSTURE.m',
    apply(world, msg) {
      const posture = msg.new_posture
      if (posture == null) return
      const persistent = new Set([
        129, 132, 133, 143, 146, 157, 251, 252, 254, 255,
      ])
      if (!persistent.has(posture)) return
      const o = world.get(msg.noid)
      if (!o) return
      o.mod.activity = posture
      world.emit('stateChanged', o)
    },
  },
  'SPEAK$':      { choreography: true, src: 'word balloons' },
  'OBJECTSPEAK_$': { choreography: true, src: 'object word balloons' },
  'PLAY_$':      { choreography: true, src: 'sound effects' },
  'ATTACK$':     { choreography: true, src: 'Behaviors/avatar_ATTACK.m (anim; damage arrives via FIDDLE/CHANGE)' },
  'BASH$':       { choreography: true, src: 'Behaviors/avatar_BASH.m' },
  'FAKESHOOT$':  { choreography: true, src: 'mods/Gun (fake)' },
  'RUB$':        { choreography: true, src: 'mods/Magic_lamp (anim; effects arrive separately)' },
  'WISH$':       { choreography: true, src: 'mods (wish text)' },
  'WISH_MESSAGE':{ choreography: true, src: 'mods (wish text)' },
  // Avatar uses a drug/escape-device — decrement count is client-predicted
  // from the C64 but for observers the item count isn't visible; deletion
  // (if count hits 0) arrives via GOAWAY_$.
  'TAKE$':   { choreography: true, src: 'Behaviors/avatar_TAKE.m / Drugs.java' },
  'BUGOUT$': { choreography: true, src: 'Behaviors/avatar_BUGOUT.m / Escape_device.java' },
  // Animation-only ops: no object-table state changes.
  'DIG$':     { choreography: true, src: 'Behaviors/shovel_DIG.m / Shovel.java' },
  'MUNCH$':   { choreography: true, src: 'mods/Pawn_machine.java (eating anim; item removed via GOAWAY_$)' },
  'FLUSH$':   { choreography: true, src: 'mods/Garbage_can.java (lid anim)' },
  // ZAPTO$: teleporter boing animation for observers. The teleporting avatar
  // exits via a normal changeContext/delete sequence.
  'ZAPTO$':    { choreography: true, src: 'Teleporter.java (teleport anim)' },
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
