/* jshint esversion: 8 */

'use strict'

// world.js — HabitatWorld: a client-side mirror of region state.
//
// The elko server describes a region once (the "make storm" at region
// entry) and afterwards sends only small delta ops (WALK$, GET$, PUT$,
// FIDDLE_$, ...) exactly as the 1986 C64 client expected. The original
// client applied every delta to its object table; this class is the
// JavaScript equivalent of that table plus the apply logic.
//
// Deliberately dependency-free and renderer-free: a bot reads state via
// the query methods, a future all-JS client subscribes to the emitted
// events to drive choreography. Nothing in here knows about habibots,
// Claude, or the DOM.
//
// Original-source citations refer to the MADE repository
// (Museum-of-Art-and-Digital-Entertainment/habitat), path sources/c64/.

const EventEmitter = require('events')
const { applyDelta } = require('./deltas')
const { MAIL_SLOT, HANDS, HEAD, THE_REGION } = require('./constants')

class HabitatWorld extends EventEmitter {
  constructor() {
    super()
    this.clear()
  }

  // Reset all region-local state. Called on construction and on
  // changeContext — elko streams a fresh make storm after every region
  // transition, so nothing local survives one.
  clear() {
    this.objects = new Map() // noid → record
    this.refs = new Map()    // ref → noid
    this.region = {
      ref: '',
      name: '',
      orientation: 0,
      neighbors: ['', '', '', ''],
      lighting: 0,
      realm: '',
    }
    this.me = null // record of our own avatar (make arrives with you:true)
  }

  // Single entry point: apply one parsed elko JSON message. Session-level
  // messages (make/delete/changeContext) are handled here; everything
  // else is dispatched through the delta table. Unknown ops emit 'op'
  // but never throw — an unhandled message must not kill a client.
  apply(msg) {
    if (!msg || typeof msg !== 'object') return
    const op = msg.op

    if (msg.type === 'changeContext') {
      this.clear()
      this.emit('regionChanged', msg.context)
      this.emit('op', msg)
      return
    }

    if (op === 'make' || op === 'HEREIS_$') {
      // HEREIS_$ carries the object under `object` instead of `obj`
      // (legacy wire quirk; see habibot.js's identical special case).
      const obj = op === 'make' ? msg.obj : msg.object
      if (obj) this._makeObject(obj, msg.to, !!msg.you)
      this.emit('op', msg)
      return
    }

    if (op === 'delete') {
      this._deleteByRef(msg.to)
      this.emit('op', msg)
      return
    }

    applyDelta(this, msg)
    this.emit('op', msg)
  }

  // ── queries ──────────────────────────────────────────────────────

  get(noid) {
    return this.objects.get(noid) || null
  }

  getByRef(ref) {
    const noid = this.refs.get(ref)
    return noid === undefined ? null : this.objects.get(noid) || null
  }

  avatars() {
    return [...this.objects.values()].filter((o) => o.type === 'Avatar')
  }

  // Records contained by the given object (by noid). Contents are
  // derived by scan rather than maintained as slot arrays the way
  // Main/actions.m:767-787 does — same semantics, no desync risk, and
  // regions are small enough that the scan is free.
  contentsOf(noid) {
    const cont = this.objects.get(noid)
    if (!cont) return []
    return [...this.objects.values()].filter((o) => o.containerRef === cont.ref)
  }

  containerOf(noid) {
    const o = this.objects.get(noid)
    if (!o || !o.containerRef || o.containerRef === this.region.ref) return null
    return this.getByRef(o.containerRef)
  }

  inRegion(noid) {
    const o = this.objects.get(noid)
    return !!o && o.containerRef === this.region.ref
  }

  // Items in an avatar's pockets (including HANDS/HEAD/mail slots).
  inventory(avatarNoid) {
    return this.contentsOf(avatarNoid)
  }

  // The record in the avatar's HANDS slot, or null. For pocket items
  // mod.y is the container slot index (same dual-use as the C64
  // OBJECT_container_offset byte).
  holding(avatarNoid) {
    return this.inventory(avatarNoid).find((o) => o.mod.y === HANDS) || null
  }

  // ── internals (used by deltas.js too) ────────────────────────────

  _makeObject(obj, to, isMe) {
    if (!obj.mods || !obj.mods[0]) return
    const mod = obj.mods[0]

    if (mod.type === 'Region') {
      this.region.ref = obj.ref
      this.region.name = obj.name || obj.ref
      this.region.orientation = mod.orientation || 0
      this.region.neighbors = mod.neighbors || ['', '', '', '']
      this.region.lighting = mod.lighting || 0
      this.region.realm = mod.realm || ''
      this.emit('regionDescribed', this.region)
      return
    }

    const record = {
      noid: mod.noid,
      ref: obj.ref,
      name: obj.name || mod.type,
      type: mod.type,
      mod: mod, // live field store: x, y, orientation, gr_state, ...
      containerRef: to || '',
    }
    this.objects.set(mod.noid, record)
    this.refs.set(obj.ref, mod.noid)
    if (isMe) this.me = record
    this.emit('added', record)
  }

  _deleteByRef(ref) {
    const noid = this.refs.get(ref)
    if (noid === undefined) return
    this._deleteByNoid(noid)
  }

  _deleteByNoid(noid) {
    const record = this.objects.get(noid)
    if (!record) return
    // Deleting a container takes its contents with it (the C64's
    // delete_object purges contents). Without the cascade, an avatar
    // leaving the region orphans its pocket items: ghost records with
    // dangling containerRefs that bots keep trying to GET — the server
    // answers "target not found" and the action times out.
    this.contentsOf(noid).forEach((item) => this._deleteByNoid(item.noid))
    this.objects.delete(noid)
    this.refs.delete(record.ref)
    this.emit('removed', record)
  }

  // Port of change_containers (Main/actions.m:714-789), minus the C64
  // resource paging and render flags. The original writes:
  //   contained_by ← new container noid
  //   container_offset ← new slot-or-y
  //   x_position ← new x
  // and maintains contents lists (which we derive instead — see
  // contentsOf). Container noid 0 means the region.
  _changeContainers(itemNoid, containerNoid, x, y) {
    const item = this.objects.get(itemNoid)
    if (!item) return
    if (containerNoid === THE_REGION) {
      item.containerRef = this.region.ref
    } else {
      const cont = this.objects.get(containerNoid)
      if (!cont) return
      item.containerRef = cont.ref
    }
    item.mod.x = x
    item.mod.y = y
    this.emit('containerChanged', item)
  }
}

module.exports = { HabitatWorld, HANDS, HEAD, MAIL_SLOT, THE_REGION }
