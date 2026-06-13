/* jshint esversion: 8 */

'use strict'

// Device / switchable family — ports of:
//   Behaviors/generic_switch.m         (DO a held on/off device)
//   Behaviors/flashlight_do.m          (same, plus room light level)
//   Behaviors/floor_lamp_do.m          (lamp: not held — adjacent)
//   Behaviors/generic_ON.m / generic_OFF.m         (host messages)
//   Behaviors/generic_ONLIGHT.m / generic_OFFLIGHT.m (host messages)
//   Behaviors/generic_CHANGESTATE_uppercase.m       (host message)
//   Behaviors/generic_read.m
//   Behaviors/generic_getMass.m
//   Behaviors/key_do.m

const { HANDS, ACTION_GO } = require('../constants')
const { succeeded } = require('./kernel')

// Shared toggle: flip the device's `on` field via MSG_ON/MSG_OFF, apply
// locally on a success reply. `affectsLight` adds the room light-level
// bump (flashlights and lamps light the region).
async function switchToggle(ctx, device, affectsLight) {
  const newState = (device.mod.on || 0) ? 0 : 1
  ctx.sound(newState ? 'SWITCHED_ON' : 'SWITCHED_OFF', device.noid)
  const reply = await ctx.send({ op: newState ? 'ON' : 'OFF', to: device.ref })
  if (!succeeded(reply)) return ctx.beep('server-denied')
  device.mod.on = newState
  ctx.newImage(device.noid)
  if (affectsLight) ctx.changeLight(newState ? 1 : -1)
  return { ok: true }
}

// generic_switch.m: DO toggles the device — but only while holding it;
// otherwise the verb falls through to depends.
async function generic_switch(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.depends()
  return switchToggle(ctx, ctx.pointed, false)
}

// flashlight_do.m: identical shape with SWITCH_CLICK and the light bump.
async function flashlight_do(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.depends()
  ctx.sound('SWITCH_CLICK', ctx.pointed.noid)
  return switchToggle(ctx, ctx.pointed, true)
}

// floor_lamp_do.m: a lamp stands in the room — walk up to it, then
// toggle (punt to depends if the walk leaves us short, per
// v_punt_if_not_adjacent).
async function floor_lamp_do(ctx) {
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  if (!ctx.isAdjacent()) return ctx.depends()
  ctx.sound('SWITCH_CLICK', ctx.pointed.noid)
  return switchToggle(ctx, ctx.pointed, true)
}

// ── host-message handlers (slots 8+; the server announces a device
// changed state). In host dispatch the "actor" registers point at the
// receiving object — our ctx.pointed. ─────────────────────────────────

async function generic_ON(ctx) {
  ctx.pointed.mod.on = 1
  ctx.newImage(ctx.pointed.noid)
  ctx.sound('SWITCHED_ON', ctx.pointed.noid)
  return { ok: true }
}

async function generic_OFF(ctx) {
  ctx.pointed.mod.on = 0
  ctx.newImage(ctx.pointed.noid)
  ctx.sound('SWITCHED_OFF', ctx.pointed.noid)
  return { ok: true }
}

async function generic_ONLIGHT(ctx) {
  ctx.sound('SWITCH_CLICK', ctx.pointed.noid)
  ctx.pointed.mod.on = 1
  ctx.newImage(ctx.pointed.noid)
  ctx.changeLight(1)
  return { ok: true }
}

async function generic_OFFLIGHT(ctx) {
  ctx.sound('SWITCH_CLICK', ctx.pointed.noid)
  ctx.pointed.mod.on = 0
  ctx.newImage(ctx.pointed.noid)
  ctx.changeLight(-1)
  return { ok: true }
}

// generic_CHANGESTATE_uppercase.m (new.mud name generic_CHANGESTATE):
// host pushes a new graphic state.
async function generic_CHANGESTATE(ctx) {
  if (ctx.args.new_state !== undefined) ctx.pointed.mod.gr_state = ctx.args.new_state
  else if (ctx.args.state !== undefined) ctx.pointed.mod.gr_state = ctx.args.state
  ctx.newImage(ctx.pointed.noid, ctx.pointed.mod.gr_state)
  return { ok: true }
}

// ── reading and mass ────────────────────────────────────────────────

// generic_read.m: DO on a held paper/book/etc. reads it — MSG_READ,
// balloon the returned text. Not held → depends.
async function generic_read(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.depends()
  const reply = await ctx.send({ op: 'READ', to: ctx.pointed.ref })
  if (!reply) return ctx.beep('server-denied')
  const text = reply.text !== undefined
    ? (Array.isArray(reply.text) ? reply.text.join('\n') : reply.text)
    : ''
  ctx.balloon(text)
  return { ok: true, text: text }
}

// generic_getMass.m: like goToAndGet, but heavy objects (mass != 0)
// refuse — furniture you can shove but not pocket.
async function generic_getMass(ctx) {
  if (ctx.inHand) return ctx.beep('hands-full')
  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()
  if (ctx.pointed.mod.mass) return ctx.beep('too-heavy')
  ctx.chore('bend_over')
  const reply = await ctx.send({ op: 'GET', to: ctx.pointed.ref })
  ctx.chore('bend_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.changeContainers(ctx.pointed.noid, ctx.actor.noid, 0, HANDS)
  return { ok: true }
}

module.exports = {
  generic_switch,
  flashlight_do,
  floor_lamp_do,
  generic_ON,
  generic_OFF,
  generic_ONLIGHT,
  generic_OFFLIGHT,
  generic_CHANGESTATE,
  generic_read,
  generic_getMass,
}
