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

function generic_ON(ctx) {
  const o = ctx.pointed
  o.mod.on = 1
  if (o.type === 'Flashlight' || o.type === 'Floor_lamp') {
    o.mod.gr_state = 1
    ctx.changeLight(1)
  }
  ctx.world.emit('fieldChanged', o, null)
  ctx.newImage(o.noid)
  ctx.sound('SWITCHED_ON', o.noid)
  return { ok: true }
}

function generic_OFF(ctx) {
  const o = ctx.pointed
  o.mod.on = 0
  if (o.type === 'Flashlight' || o.type === 'Floor_lamp') {
    o.mod.gr_state = 0
    ctx.changeLight(-1)
  }
  ctx.world.emit('fieldChanged', o, null)
  ctx.newImage(o.noid)
  ctx.sound('SWITCHED_OFF', o.noid)
  return { ok: true }
}

function generic_ONLIGHT(ctx) {
  const o = ctx.pointed
  ctx.sound('SWITCH_CLICK', o.noid)
  o.mod.on = 1
  o.mod.gr_state = 1
  ctx.changeLight(1)
  ctx.world.emit('fieldChanged', o, null)
  ctx.newImage(o.noid)
  return { ok: true }
}

function generic_OFFLIGHT(ctx) {
  const o = ctx.pointed
  ctx.sound('SWITCH_CLICK', o.noid)
  o.mod.on = 0
  o.mod.gr_state = 0
  ctx.changeLight(-1)
  ctx.world.emit('fieldChanged', o, null)
  ctx.newImage(o.noid)
  return { ok: true }
}

// generic_CHANGESTATE_uppercase.m (new.mud name generic_CHANGESTATE):
// host pushes a new graphic state.
function generic_CHANGESTATE(ctx) {
  const state = ctx.args.state ?? ctx.args.new_state
  if (state !== undefined) {
    ctx.pointed.mod.gr_state = state
    ctx.world.emit('fieldChanged', ctx.pointed, null)
  }
  ctx.newImage(ctx.pointed.noid, ctx.pointed.mod.gr_state)
  return { ok: true }
}

// ── reading and mass ────────────────────────────────────────────────

// Server sends ascii: int[] (PETSCII bytes) + nextpage; decode to string.
function decodeRead(reply) {
  const bytes = Array.isArray(reply.ascii) ? reply.ascii : []
  if (bytes.length === 0 && reply.text != null) return String(reply.text)
  let text = ''
  for (const b of bytes) {
    if (b >= 32 && b <= 127) text += String.fromCharCode(b)
    else if (b === 10) text += '\n'
    else text += ' '
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\s+$/, '')
}

// generic_read.m: DO on a held paper/note/etc. reads it — MSG_READ (no
// page arg on the wire per the C64 source), balloon the returned text.
// Not held → depends.
async function generic_read(ctx) {
  const inHand = ctx.inHand
  if (!inHand || inHand.noid !== ctx.pointed.noid) return ctx.depends()
  if (ctx.readText) return ctx.readText(ctx.pointed.noid) // graphical: modal text display
  const reply = await ctx.send({ op: 'READ', to: ctx.pointed.ref })
  if (!reply) return ctx.beep('server-denied')
  const text = decodeRead(reply)
  ctx.balloon(text)
  return { ok: true, text }
}

// plaque_do.m: DO on a wall-mounted plaque — same as book_do but no
// in-hand check (plaques cannot be picked up).
async function plaque_do(ctx) {
  const plaque = ctx.pointed
  if (ctx.readText) return ctx.readText(plaque.noid) // graphical: modal text display
  const page = ctx.args.page !== undefined ? ctx.args.page
    : (plaque.mod.current_page !== undefined ? plaque.mod.current_page + 1 : 1)
  const reply = await ctx.send({ op: 'READ', to: plaque.ref, page })
  if (!reply) return ctx.beep('server-denied')
  if (reply.nextpage !== undefined) plaque.mod.current_page = reply.nextpage
  else plaque.mod.current_page = page
  const text = decodeRead(reply)
  ctx.balloon(text)
  return { ok: true, text, page: plaque.mod.current_page }
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
  decodeRead,
  generic_read,
  plaque_do,
  generic_getMass,
}
