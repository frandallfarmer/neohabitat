/* jshint esversion: 8 */

'use strict'

// Container interaction family — ports of:
//   Behaviors/generic_goToAndPickFrom.m
//   Behaviors/generic_goToAndPickFromIfOpen.m
//   Behaviors/generic_goToAndPickFromOrGet.m
//   Behaviors/generic_goToAndDropInto.m
//   Behaviors/generic_goToAndDropIntoIfOpen.m
//   Behaviors/generic_adjacentOpenCloseContainer.m
//
// The C64's v_pick_from_container popped a selection UI over the
// container's contents and re-pointed at the chosen item. A bot names
// the item directly: args.itemNoid selects it; with no itemNoid the
// first item inside is taken. The MSG_GET then goes to the picked item,
// exactly as the original sent it to the re-pointed noid.

const {
  HANDS, ACTION_GO, OPEN_BIT, UNLOCKED_BIT,
} = require('../constants')
const { succeeded } = require('./kernel')

// v_pick_from_container, bot style: resolve which contained item is
// meant. Returns the record or null.
function pickFromContainer(ctx) {
  const contents = ctx.world.contentsOf(ctx.pointed.noid)
  if (!contents.length) return null
  if (ctx.args.itemNoid !== undefined) {
    return contents.find((o) => o.noid === ctx.args.itemNoid) || null
  }
  return contents[0]
}

// Shared body: walk to the container, pick an item, MSG_GET it into
// HANDS. `requireOpen` adds the IfOpen flags check; `orGet` falls back
// to GETting the container itself when it's closed (PickFromOrGet).
async function pickFrom(ctx, { requireOpen, orGet }) {
  if (ctx.inHand) return ctx.beep('hands-full')

  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  const open = !!((ctx.pointed.mod.open_flags || 0) & OPEN_BIT)
  if (requireOpen && !open) return ctx.beep('container-closed')

  let target = ctx.pointed // orGet: closed container → GET the container
  if (!orGet || open) {
    ctx.chore('bend_over')
    const item = pickFromContainer(ctx)
    if (!item) {
      ctx.chore('bend_back')
      return ctx.beep('container-empty')
    }
    target = item
  } else {
    ctx.chore('bend_over')
  }

  const reply = await ctx.send({ op: 'GET', to: target.ref })
  ctx.chore('bend_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.changeContainers(target.noid, ctx.actor.noid, 0, HANDS)
  return { ok: true }
}

async function generic_goToAndPickFrom(ctx) {
  return pickFrom(ctx, { requireOpen: false, orGet: false })
}

async function generic_goToAndPickFromIfOpen(ctx) {
  return pickFrom(ctx, { requireOpen: true, orGet: false })
}

async function generic_goToAndPickFromOrGet(ctx) {
  return pickFrom(ctx, { requireOpen: false, orGet: true })
}

// Shared body for the drop-into pair: walk to the container, PUT the
// held item into it (v_putInto with the container as destination —
// the server assigns the slot, echoed back in the reply's pos).
async function dropInto(ctx, { requireOpen }) {
  const item = ctx.inHand
  if (!item) return ctx.beep('hands-empty')
  if (item.noid === ctx.pointed.noid) return ctx.beep('drop-onto-self')

  const go = await ctx.doAction(ACTION_GO)
  if (!go.ok) return ctx.beep(go.reason)
  await ctx.waitWalkAnimation()

  if (requireOpen && !((ctx.pointed.mod.open_flags || 0) & OPEN_BIT)) {
    return ctx.beep('container-closed')
  }

  ctx.chore('bend_over')
  const result = await ctx.putInto(ctx.pointed.noid, 0, 0)
  ctx.chore('bend_back')
  return result
}

async function generic_goToAndDropInto(ctx) {
  return dropInto(ctx, { requireOpen: false })
}

async function generic_goToAndDropIntoIfOpen(ctx) {
  return dropInto(ctx, { requireOpen: true })
}

// generic_adjacentOpenCloseContainer — the DO of box/bag/chest/safe:
// a toggle like the door version, but with bend chores, container
// sounds, and a contents purge on close (closed containers are opaque;
// elko re-sends contents as makes when re-opened). Note: NO walk — the
// original punts to depends when not adjacent.
async function generic_adjacentOpenCloseContainer(ctx) {
  const cont = ctx.pointed
  const world = ctx.world
  if (cont.containerRef && cont.containerRef !== world.region.ref) {
    return ctx.beep('not-in-region')
  }
  if (!ctx.isAdjacent()) return ctx.depends() // v_punt_if_not_adjacent

  const inHand = ctx.inHand
  const haveKey = !!(inHand && inHand.type === 'Key' &&
    inHand.mod.key_number_hi === cont.mod.key_hi &&
    inHand.mod.key_number_lo === cont.mod.key_lo)

  const flags = cont.mod.open_flags || 0
  if (flags & OPEN_BIT) {
    // Open → close it, then purge the (now hidden) contents.
    ctx.chore('bend_over')
    const reply = await ctx.send({ op: 'CLOSECONTAINER', to: cont.ref })
    ctx.chore('bend_back')
    if (!succeeded(reply)) return ctx.beep('server-denied')
    ctx.sound('CONTAINER_CLOSING', cont.noid)
    cont.mod.open_flags = haveKey
      ? flags & ~(OPEN_BIT | UNLOCKED_BIT)
      : (flags & ~OPEN_BIT) | UNLOCKED_BIT
    ctx.newImage(cont.noid)
    world.contentsOf(cont.noid).forEach((o) => world._deleteByNoid(o.noid))
    return { ok: true }
  }

  if (!(flags & UNLOCKED_BIT) && !haveKey) {
    ctx.balloon("It's locked.")
    return { ok: false, reason: 'locked' }
  }
  ctx.chore('bend_over')
  const reply = await ctx.send({ op: 'OPENCONTAINER', to: cont.ref })
  ctx.chore('bend_back')
  if (!succeeded(reply)) return ctx.beep('server-denied')
  ctx.sound('CONTAINER_OPENING', cont.noid)
  cont.mod.open_flags = OPEN_BIT | UNLOCKED_BIT
  ctx.newImage(cont.noid)
  // The C64 unpacked a contents vector from the reply; elko sends the
  // contents as separate make messages instead — nothing to do here.
  return { ok: true }
}

module.exports = {
  generic_goToAndPickFrom,
  generic_goToAndPickFromIfOpen,
  generic_goToAndPickFromOrGet,
  generic_goToAndDropInto,
  generic_goToAndDropIntoIfOpen,
  generic_adjacentOpenCloseContainer,
}
