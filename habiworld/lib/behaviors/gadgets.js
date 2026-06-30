/* jshint esversion: 8 */

'use strict'

// Gadgets and tools — ports of:
//   Behaviors/sensor_do.m / sensor_SCAN.m
//   Behaviors/garbage_can_do.m / garbage_can_FLUSH.m
//   Behaviors/spray_can_do.m / spray_can_SPRAY.m
//   Behaviors/shovel_rdo.m / shovel_DIG.m
//   Behaviors/hole_do.m
//   Behaviors/changomatic_rdo.m / changomatic_CHANGE.m
//   Behaviors/stun_gun_rdo.m
//   Behaviors/mailbox_get.m / mailbox_MAILARRIVED.m
//   Behaviors/generic_askOracle.m
//   Behaviors/generic_enterOrExit.m
//   Behaviors/generic_test.m

const { ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

// sensor_do.m: holding the sensor, MSG_SCAN; the reply says whether it
// detected anything (blinking image if so).
async function sensor_do(ctx) {
  const sensor = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== sensor.noid) return ctx.depends()
  ctx.sound('SENSOR_SCANNING', sensor.noid)
  ctx.newImage(sensor.noid, 1) // SENSOR_ON
  const reply = await ctx.send({ op: 'SCAN', to: sensor.ref })
  const detected = !!(reply && reply.err)
  ctx.sound(detected ? 'SENSOR_FOUND_IT' : 'SENSOR_DIDNT_FIND_IT', sensor.noid)
  ctx.newImage(sensor.noid, detected ? 2 : 0) // SENSOR_BLINKING / off
  return { ok: true, detected: detected }
}

// sensor_SCAN.m (host): neighbor scan — gr_state + sound (was deltas.js SCAN$).
function sensor_SCAN(ctx) {
  const world = ctx.world
  const sensor = ctx.pointed
  const scanType = ctx.args.scan_type
  const detected = scanType != null ? !!scanType : !!ctx.args.err
  if (scanType != null) {
    sensor.mod.gr_state = scanType
    world.emit('fieldChanged', sensor, null)
  }
  ctx.sound(detected ? 'SENSOR_FOUND_IT' : 'SENSOR_DIDNT_FIND_IT', sensor.noid)
  ctx.newImage(sensor.noid)
  return { ok: true }
}

// garbage_can_do.m: must be adjacent (punt to depends otherwise);
// MSG_FLUSH and locally purge the can's contents.
async function garbage_can_do(ctx) {
  if (!ctx.isAdjacent()) return ctx.depends()
  ctx.sound('GARBAGE_FLUSH', ctx.pointed.noid)
  await ctx.send({ op: 'FLUSH', to: ctx.pointed.ref })
  const world = ctx.world
  world.contentsOf(ctx.pointed.noid).forEach((o) => world._deleteByNoid(o.noid))
  return { ok: true }
}

// garbage_can_FLUSH.m (host): neighbor flushed the can — sound + purge locally.
// FLUSH$ is neighbor-only (Garbage_can.java send_neighbor_msg); no self-skip needed.
function garbage_can_FLUSH(ctx) {
  const world = ctx.world
  ctx.sound('GARBAGE_FLUSH', ctx.pointed.noid)
  world.contentsOf(ctx.pointed.noid).forEach((o) => world._deleteByNoid(o.noid))
  return { ok: true }
}

// spray_can_do.m: holding the can, respray my avatar's body pattern.
// The C64 passed which limb the cursor touched; bots pass args.limb
// (default 0). The reply carries the new customize bytes.
async function spray_can_do(ctx) {
  const can = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== can.noid) return ctx.beep('not-holding')
  ctx.sound('SPRAY', can.noid)
  const reply = await ctx.send({
    op: 'SPRAY', to: can.ref, limb: ctx.args.limb !== undefined ? ctx.args.limb : 0,
  })
  // Spray_can.java does NOT use `err`. It replies success/SPRAY_SUCCESS
  // (1 = landed) with the new customize bytes. Two reply shapes:
  //   guard failure: { success, custom_1, custom_2 }
  //   main path:     { SPRAY_SUCCESS, SPRAY_CUSTOMIZE_0, SPRAY_CUSTOMIZE_1 }
  // custom_1/SPRAY_CUSTOMIZE_0 → custom[0]; custom_2/SPRAY_CUSTOMIZE_1 → custom[1].
  const flag = reply.SPRAY_SUCCESS !== undefined ? reply.SPRAY_SUCCESS : reply.success
  if (!(flag === 1 || flag === true)) return ctx.beep('spray-failed')
  if (ctx.actor && Array.isArray(ctx.actor.mod.custom)) {
    const c0 = reply.SPRAY_CUSTOMIZE_0 !== undefined ? reply.SPRAY_CUSTOMIZE_0 : reply.custom_1
    const c1 = reply.SPRAY_CUSTOMIZE_1 !== undefined ? reply.SPRAY_CUSTOMIZE_1 : reply.custom_2
    if (c0 !== undefined) ctx.actor.mod.custom[0] = c0
    if (c1 !== undefined) ctx.actor.mod.custom[1] = c1
    ctx.world.emit('fieldChanged', ctx.actor, null)
    ctx.newImage(ctx.actor.noid)
  }
  return { ok: true }
}

// spray_can_SPRAY.m (host): a neighbor got resprayed — apply their new
// pattern bytes. Spray_can.java broadcasts SPRAY$ with SPRAY_SPRAYEE and
// SPRAY_CUSTOMIZE_0 / SPRAY_CUSTOMIZE_1 (→ custom[0] / custom[1]).
function spray_can_SPRAY(ctx) {
  const world = ctx.world
  ctx.sound('SPRAY', ctx.pointed.noid)
  const sprayee = world.get(ctx.args.SPRAY_SPRAYEE !== undefined
    ? ctx.args.SPRAY_SPRAYEE : ctx.args.sprayee)
  if (sprayee && Array.isArray(sprayee.mod.custom)) {
    const c0 = ctx.args.SPRAY_CUSTOMIZE_0 !== undefined ? ctx.args.SPRAY_CUSTOMIZE_0 : ctx.args.custom_0
    const c1 = ctx.args.SPRAY_CUSTOMIZE_1 !== undefined ? ctx.args.SPRAY_CUSTOMIZE_1 : ctx.args.custom_1
    if (c0 !== undefined) sprayee.mod.custom[0] = c0
    if (c1 !== undefined) sprayee.mod.custom[1] = c1
    world.emit('fieldChanged', sprayee, null)
    ctx.newImage(sprayee.noid)
  }
  return { ok: true }
}

// shovel_rdo.m: dig at the subject — walk to it, bend over, MSG_DIG.
// What the dig uncovers (if anything) arrives asynchronously.
// ctx.subject set by depends chain; args.target for direct calls.
async function shovel_rdo(ctx) {
  const shovel = ctx.pointed
  const target = ctx.args.target !== undefined ? ctx.world.get(ctx.args.target) : ctx.subject
  if (target) {
    const spot = ctx.gotoCoords(target.noid)
    if (spot) {
      await ctx.walkTo(spot.x, spot.y)
      await ctx.waitWalkAnimation()
    }
  }
  ctx.chore('bend_over')
  ctx.sound('DIGGING', shovel.noid)
  await ctx.send({ op: 'DIG', to: shovel.ref })
  ctx.chore('bend_back')
  return { ok: true }
}

// shovel_DIG.m (host): someone else dug — chores and sound only.
async function shovel_DIG(ctx) {
  ctx.sound('DIGGING', ctx.pointed.noid)
  return { ok: true }
}

// hole_do.m: poking a hole with a shovel in hand opens/closes it via
// the hole class's internal slot 8 (generic_adjacentOpenClose there);
// anything else falls through to depends.
async function hole_do(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.type !== 'Shovel') return ctx.depends()
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  return ctx.doAction(8) // hole's internal open/close slot
}

// changomatic_rdo.m: zap the subject — MSG_CHANGE; success returns the
// object's new orientation (turf repainting). Changomatic.java CHANGE binds the
// request param "targetNoid" (required) and replies "CHANGE_NEW_ORIENTATION" — the
// exact field names the C64 putArg CHANGE_TARGET / getResponse CHANGE_NEW_ORIENTATION
// map to. (Server precondition: only succeeds in your own turf / a neighbor building.)
async function changomatic_rdo(ctx) {
  const wand = ctx.pointed
  const target = ctx.subject
  if (!target) return ctx.beep('no-target')
  ctx.chore('shoot1')
  ctx.sound('CHANGOMATIC', wand.noid)
  const reply = await ctx.send({
    op: 'CHANGE', to: wand.ref, targetNoid: target.noid,
  })
  ctx.chore('shoot2')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  const orient = reply.CHANGE_NEW_ORIENTATION
  if (orient !== undefined) target.mod.orientation = orient
  ctx.newImage(target.noid)
  return { ok: true }
}

// changomatic_CHANGE.m (host): apply CHANGE_NEW_ORIENTATION to CHANGE_TARGET.
function changomatic_CHANGE(ctx) {
  const msg = ctx.args
  const targetNoid = msg.CHANGE_TARGET ?? msg.target
  const orient = msg.CHANGE_NEW_ORIENTATION ?? msg.orientation
  const target = ctx.world.get(targetNoid)
  if (target && orient !== undefined) {
    target.mod.orientation = orient
    ctx.world.emit('fieldChanged', target, null)
    ctx.newImage(target.noid)
  }
  ctx.sound('CHANGOMATIC', ctx.pointed.noid)
  return { ok: true }
}

// stun_gun_rdo.m: fire at the subject — only avatars are valid targets;
// MSG_STUN, hit reaction on success.
// ctx.subject set by depends chain; args.target for direct calls.
async function stun_gun_rdo(ctx) {
  const gun = ctx.pointed
  const victim = ctx.args.target !== undefined
    ? ctx.world.get(ctx.args.target)
    : ctx.subject
  ctx.chore('shoot1')
  ctx.sound('STUN_GUN_FIRE', gun.noid)
  ctx.chore('shoot2')
  if (!victim || victim.type !== 'Avatar') {
    ctx.sound('STUN_GUN_MISS', gun.noid)
    return ctx.beep('no-such-avatar')
  }
  const reply = await ctx.send({ op: 'STUN', to: gun.ref, target: victim.noid })
  if (!succeeded(reply)) {
    ctx.sound('STUN_GUN_MISS', gun.noid)
    return ctx.beep('missed')
  }
  ctx.sound('STUN_GUN_HIT', gun.noid)
  ctx.newImage(victim.noid) // get_shot reaction
  return { ok: true }
}

// mailbox_get.m: empty-handed, walk to the mailbox, MSG_READMAIL —
// a letter lands in my hands (arrives as a make); the reply also says
// whether more mail is waiting (flag image).
async function mailbox_get(ctx) {
  if (ctx.inHand) return ctx.beep('hands-full')
  const box = ctx.pointed
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  ctx.chore('hand_out')
  const reply = await ctx.send({ op: 'READMAIL', to: box.ref })
  ctx.chore('hand_back')
  const moreMail = !!(reply && reply.moremail)
  box.mod.mail_arrived = moreMail ? 1 : 0
  ctx.newImage(box.noid)
  if (!succeeded(reply)) return ctx.beep('no-mail')
  ctx.sound('MAIL_OUT_OF_MAILBOX', box.noid)
  return { ok: true, moreMail: moreMail }
}

// mailbox_MAILARRIVED.m (host): flag goes up.
async function mailbox_MAILARRIVED(ctx) {
  ctx.pointed.mod.mail_arrived = 1
  ctx.newImage(ctx.pointed.noid)
  return { ok: true }
}

// generic_askOracle.m: send the typed question to the oracle
// (crystal ball / fountain). The answer comes back as object speech.
async function generic_askOracle(ctx) {
  if (!ctx.args.text) return ctx.beep('nothing-to-ask')
  // ASK has NO server reply — the oracle's answer arrives later as object speech
  // (HabitatMod.generic_ASK does object_say, never send_reply_msg). So do NOT await it:
  // ctx.send awaits a reply that never comes, hanging the caller forever (and, in the
  // webclient, the busy/wait cursor). Fire and move on; the C64 askOracle.m doesn't block.
  ctx.send({ op: 'ASK', to: ctx.pointed.ref, text: ctx.args.text }).catch(() => {})
  return { ok: true }
}

// generic_enterOrExit.m: walk to the per-class walk-offset spot adjacent
// to the object (same as adjacentCoords — get_object_walk_xy). Falls back
// to the C64 hardcoded +8/+2 if the class has no table entry.
// NOTE: The C64 sets bit 7 of y via `ora #0x80` to select the foreground
// rendering layer, but Elko JSON y values are raw screen pixels without
// that flag — do NOT apply | 0x80 here.
async function generic_enterOrExit(ctx) {
  const spot = ctx.adjacentCoords(ctx.pointed.noid)
  if (spot) {
    await ctx.walkTo(spot.x, spot.y)
  } else {
    await ctx.walkTo(ctx.pointed.mod.x + 8, ctx.pointed.mod.y + 2)
  }
  return { ok: true }
}

// generic_test.m: fires raw message number 1 at the object — a debug
// hook with no JSON op equivalent. Beep instead of inventing one.
async function generic_test(ctx) {
  return ctx.beep('debug-hook-not-ported')
}

// compass_do: neohabitat uses DIRECT (not C64's READ/MSG_READ). Compass.java
// replies { text: "WEST: <arrow>" } via send_reply_msg — no err field.
// PETSCII arrows: 124='|'=UP, 125='}'=DOWN, 126='~'=LEFT, 127=RIGHT.
const COMPASS_ARROWS = { 124: 'UP', 125: 'DOWN', 126: 'LEFT', 127: 'RIGHT' }
async function compass_do(ctx) {
  const compass = ctx.pointed
  if (!ctx.inHand || ctx.inHand.noid !== compass.noid) return ctx.depends()
  const reply = await ctx.send({ op: 'DIRECT', to: compass.ref })
  const text = (reply && reply.text) ? String(reply.text) : ''
  const arrow = text.charCodeAt(text.length - 1)
  const direction = COMPASS_ARROWS[arrow] || null
  ctx.balloon(text)
  return { ok: true, text, direction }
}

module.exports = {
  sensor_do,
  sensor_SCAN,
  garbage_can_do,
  garbage_can_FLUSH,
  spray_can_do,
  spray_can_SPRAY,
  shovel_rdo,
  shovel_DIG,
  hole_do,
  changomatic_rdo,
  changomatic_CHANGE,
  stun_gun_rdo,
  mailbox_get,
  mailbox_MAILARRIVED,
  generic_askOracle,
  generic_enterOrExit,
  generic_test,
  compass_do,
}
