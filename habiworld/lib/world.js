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
const { MIGRATED_OPS, dispatchHostSync } = require('./behaviors/dispatch_host')
const { MAIL_SLOT, HANDS, HEAD, THE_REGION, GHOST_NOID } = require('./constants')

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
      // The walkable depth band. Avatars stand at y = 128 + depth (128 is
      // the foreground/layer bit); get_object_walk_xy clamps walk targets
      // into [0, depth]. Drives wall-vs-floor adjacency math.
      depth: 0,
    }
    // Our own identity is a NOID (the C64 me_noid), not a record — region (0) and ghost (255)
    // are "irregular" sentinel noids, and the object for our noid can arrive LATE (the server
    // sends the corporeality reply before the new body's make: the deghost avatar make follows
    // its reply, and a freshly-created ghost is announced ~1s later via announceGhostLater).
    // `me` is a getter over this noid so a late make is adopted automatically once it lands.
    this.meNoid = null
    this._client = null // presentation + I/O callbacks (sound, chore, send, walkTo)
  }

  // Register client callbacks for behavior presentation and outbound dispatch.
  // See behaviors/kernel.js and BEHAVIOR_MIGRATION_PLAN.md Phase 5.
  setClient(client) {
    this._client = client || null
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
      // HEREIS_$ carries the object under `object` (not `obj`) and the destination
      // container under `container` (not `to`) — e.g. the Paper.GET pocket "infinite pad"
      // mints a fresh sheet via HEREIS_$ into the avatar. Using `to` would drop it into
      // the wrong container and the pad would never refill.
      const obj = op === 'make' ? msg.obj : msg.object
      const container = op === 'make' ? msg.to : (msg.container ?? msg.to)
      if (obj) this._makeObject(obj, container, !!msg.you)
      this.emit('op', msg)
      return
    }

    if (op === 'delete') {
      this._deleteByRef(msg.to)
      this.emit('op', msg)
      return
    }

    if (MIGRATED_OPS.has(op)) {
      dispatchHostSync(this, msg)
    }
    this.emit('op', msg)
  }

  // ── queries ──────────────────────────────────────────────────────

  // Our own object, resolved from meNoid. Null during the brief window after a corporeality
  // change when meNoid is set but the new body's make hasn't arrived yet (see meNoid above).
  get me() {
    return this.meNoid != null ? (this.objects.get(this.meNoid) || null) : null
  }

  // Am I an observer (a ghost)? On the C64 a ghosted user IS ghost_noid (255) — there is one
  // singleton Ghost per region representing all observers, and the user's own avatar is
  // "forgotten" client-side (Ghost.java). meNoid is authoritative even before the eye's make
  // lands; the record check is a belt-and-suspenders fallback.
  get amGhost() {
    if (this.meNoid === GHOST_NOID) return true
    const me = this.me
    return !!me && (me.type === 'Ghost' || !!(me.mod && me.mod.amAGhost))
  }

  // The region's singleton ghost record (noid 255), or null. CORPORATE (deghost) is sent to
  // this object's ref.
  ghost() {
    return this.objects.get(GHOST_NOID) || null
  }

  // Remove an object (and cascade its contents) by noid. toggle_ghost_mode deletes its OWN
  // stale body locally: the server's GOAWAY_$ for it is a *neighbor* message (never sent to
  // the actor), exactly as the C64 toggle_ghost_mode.m calls v_delete_object on me_noid.
  removeNoid(noid) {
    this._deleteByNoid(noid)
  }

  // Re-point identity at a noid (toggle_ghost_mode: me_noid ← newNoid after corporeality
  // change). The new body / removed body arrive via the normal make / GOAWAY broadcast, so
  // this only swaps which record we consider "me". No-op (returns null) if not yet present.
  setMeByNoid(noid) {
    this.meNoid = noid // authoritative now; the body's make may still be in flight
    const rec = this.objects.get(noid) || null
    if (rec) this.emit('stateChanged', rec)
    return rec
  }

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
      this.region.depth = mod.depth || 0
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
    // Entering already a ghost (persisted, or forced on a full-region arrival): our own make
    // is the Avatar carrying amAGhost (elko marks the User object "you"), but its noid is
    // UNASSIGNED — the avatar isn't in the region — and the C64 identity of a ghost is the
    // singleton eye (ghost_noid 255), NOT the avatar. Adopt 255 and DON'T add the stray body
    // (otherwise it renders and the client looks corporeal). The eye arrives as a normal region
    // make (or ~1s later when we're the first ghost) and `me` resolves to it. See GHOST_MODE.md.
    if (isMe && mod.type === 'Avatar' && mod.amAGhost) {
      this.meNoid = GHOST_NOID
      return
    }
    this.objects.set(mod.noid, record)
    this.refs.set(obj.ref, mod.noid)
    if (isMe) this.meNoid = mod.noid
    // A make whose noid is the identity we're already waiting on (a late deghost body or the
    // ~1s-delayed ghost eye) resolves `me` automatically via the getter; emit so the client
    // re-renders now that our body exists.
    this.emit('added', record)
    if (mod.noid === this.meNoid) this.emit('stateChanged', record)
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

  // Set an object's gr_state (display/animation state). The canonical
  // counterpart to a ROLL$/CHANGESTATE$ delta (deltas.js applies those for
  // OTHER players' objects); behaviors call this for our OWN object when the
  // new state arrives in a request reply rather than a broadcast — e.g.
  // die_do reads ROLL_STATE from the ROLL reply (Behaviors/die_do.m).
  _changeState(noid, state) {
    const o = this.objects.get(noid)
    if (!o) return
    o.mod.gr_state = state
    this.emit('stateChanged', o)
  }
}

module.exports = { HabitatWorld, HANDS, HEAD, MAIL_SLOT, THE_REGION }
