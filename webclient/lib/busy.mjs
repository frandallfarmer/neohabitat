// busy.mjs — the C64-faithful "busy/wait cursor" state machine.
//
// Pure logic, no DOM / preact / world mutation, so it unit-tests under `node --test`
// and can later lift into habiworld for the bots/textclient (see DESIGN.md 7e notes).
// The view layer (cursor-view.js) draws the blink; live.js owns the preact signal and
// the wall-clock timers and feeds this module events.
//
// This reproduces Main/cursor.m's command-wait, not an invention:
//   • command_selected >= 0  → the cursor FREEZES and the selected icon BLINKS to black
//     (maintain_flashing, cursor.m:195). All keyboard / joystick input is ignored while
//     busy (keyboard.m:8-18 bails on command_selected, region_is_ready, custom_running).
//   • start_cursor_flashing (cursor.m:233) also starts throttle_running — the C64 already
//     imposed a post-command throttle. THROTTLE_MS is that throttle_duration.
//   • event_handler (comm_control.m:69) releases once the throttle expires and the reply
//     lands; animation_wait_bit / reply_wait_bit are the "world settling" interlock, whose
//     web analogs are the dispatch reply await + avatarMotion.whenIdle.
//
// On top of the faithful baseline we add the co-presence catch-up delays: a webclient acts
// instantly, but a co-present native C64 must load resources from floppy (~1s per object in
// an arriving contents vector; ~5s to load a newly-arrived avatar's head/hands/3 pockets).
// We hold the cursor that much longer so the C64 stays in lockstep and isn't overrun — but
// ONLY when someone else is present (shouldPace); solo play stays instant.

// ── tunable constants (calibrate against the C64 flash_rate / throttle_duration + VICE) ──
export const THROTTLE_MS = 250 // base post-command throttle (always on — faithful per-command)
export const OBJECT_LOAD_MS = 1000 // co-presence: per object in a make-storm I triggered
export const ARRIVAL_MS = 5000 // co-presence: hold on my own arrival (others load my avatar)
export const SETTLE_GAP_MS = 300 // a make-storm is "settled" after this quiet gap
export const BLINK_MS = 200 // icon↔black toggle rate (maintain_flashing flash_rate)

const GHOST_NOID = 255 // the singleton Ghost noid (Ghost.java); other observers ride it

// Should we apply the co-presence catch-up delays? Only when another avatar or ghost shares
// the region — there's no one to wait for when you're alone. Client-side we can't tell a
// native C64 from a modern client, so this is the conservative "anyone else present → pace"
// rule (a future bridge "C64 present" flag could refine it). Reads world; never mutates it.
export function shouldPace(world, meNoid = world && world.meNoid) {
  if (!world || typeof world.avatars !== "function") return false
  if (world.avatars().some((a) => a.noid !== meNoid)) return true
  // A Ghost record means other users are observing — unless I AM the ghost (it's me then).
  const ghost = typeof world.ghost === "function" ? world.ghost() : null
  return !!ghost && meNoid !== GHOST_NOID
}

// The busy state. Two overlapping notions of "busy", mirroring the C64:
//   • commandActive — a command of mine is in flight (command_selected >= 0). True from
//     armCommand() until releaseCommand(); makes that land in this window are "mine" and
//     extend the wait (the disk-load the co-present C64 is doing because of my action).
//   • busyUntil — a wall-clock deadline for the throttle tail, the make-storm catch-up, and
//     the arrival hold. isBusy stays true until now passes it.
// isBusy = commandActive || now < busyUntil. All methods take `now` (ms) so time is injected
// for tests; live.js passes Date.now().
export class BusyState {
  constructor() {
    this.commandActive = false
    this.busyUntil = 0
    this.lastMakeAt = 0 // when the most recent make landed (for the settle gap)
    this.sawMakeThisCommand = false
  }

  // A user command begins (pie verb / gesture / F-key / speak-verb / edge-walk). Freeze +
  // blink immediately; the wall-clock tail is set at release once we know reply/anim/storm.
  armCommand() {
    this.commandActive = true
    this.sawMakeThisCommand = false
    return this
  }

  // An inbound make / HEREIS_$ landed. Only meaningful while a command of mine is outstanding
  // — idle makes from others (someone grabbing an ATM coin) do NOT block my interface, exactly
  // like the C64. When paced, each object the co-present C64 must disk-load adds OBJECT_LOAD_MS.
  noteMake(now, paced) {
    if (!this.commandActive) return this
    this.sawMakeThisCommand = true
    this.lastMakeAt = now
    if (paced) this.busyUntil = Math.max(this.busyUntil, now) + OBJECT_LOAD_MS
    return this
  }

  // The command's reply + animation have completed and its make-storm has settled. End the
  // command-active freeze and set the throttle tail (always — faithful throttle_duration).
  releaseCommand(now) {
    this.commandActive = false
    this.busyUntil = Math.max(this.busyUntil, now + THROTTLE_MS)
    return this
  }

  // My own avatar just APPEARED in a region (APPEARING_$ for me): hold so co-present clients
  // can load my head/hands/pockets before I can act. Skipped when alone.
  armArrival(now, paced) {
    if (paced) this.busyUntil = Math.max(this.busyUntil, now + ARRIVAL_MS)
    return this
  }

  // Has my command's make-storm gone quiet? True once a command saw at least one make and the
  // last one was more than SETTLE_GAP_MS ago. (No makes at all → settled immediately.)
  stormSettled(now) {
    if (!this.sawMakeThisCommand) return true
    return now - this.lastMakeAt >= SETTLE_GAP_MS
  }

  // Cancel any pending command / wait — used on a region change (the C64 command_selected =
  // 0xff reset). The next APPEARING_$ re-arms the arrival hold for the new region.
  reset() {
    this.commandActive = false
    this.busyUntil = 0
    this.lastMakeAt = 0
    this.sawMakeThisCommand = false
    return this
  }

  isBusy(now) {
    return this.commandActive || now < this.busyUntil
  }

  // ms until the wall-clock tail expires (0 if already idle / still command-active). live.js
  // uses this to schedule the timer that flips the busy signal off.
  msUntilIdle(now) {
    if (this.commandActive) return 0
    return Math.max(0, this.busyUntil - now)
  }
}
