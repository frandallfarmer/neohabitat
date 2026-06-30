// Node tests: the busy/wait-cursor state machine (lib/busy.mjs).
import {
  BusyState, shouldPace,
  THROTTLE_MS, OBJECT_LOAD_MS, ARRIVAL_MS, SETTLE_GAP_MS,
} from "./lib/busy.mjs"

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

// A minimal world stub for shouldPace (only avatars()/ghost()/meNoid are read).
const world = ({ avatars = [], ghost = null, meNoid = 1 }) => ({
  meNoid,
  avatars: () => avatars,
  ghost: () => ghost,
})

// ── shouldPace: pace only when someone else (avatar or ghost) shares the region ──
{
  assert(shouldPace(world({ avatars: [{ noid: 1 }], meNoid: 1 })) === false, "alone (just me) → no pace")
  assert(shouldPace(world({ avatars: [{ noid: 1 }, { noid: 7 }], meNoid: 1 })) === true, "another avatar → pace")
  assert(shouldPace(world({ avatars: [{ noid: 1 }], ghost: { noid: 255 }, meNoid: 1 })) === true, "a ghost (other observers) → pace")
  assert(shouldPace(world({ avatars: [], ghost: { noid: 255 }, meNoid: 255 })) === false, "I AM the ghost, region empty → no pace")
  assert(shouldPace(null) === false, "no world → no pace")
}

// ── base throttle: ALWAYS applied at release, even alone (faithful throttle_duration) ──
{
  const b = new BusyState()
  b.armCommand()
  assert(b.isBusy(1000) === true, "command-active → busy immediately")
  b.releaseCommand(1000)
  assert(b.commandActive === false, "release clears command-active")
  assert(b.isBusy(1000) === true, "throttle tail keeps it busy at release")
  assert(b.isBusy(1000 + THROTTLE_MS - 1) === true, "still busy just before throttle expires")
  assert(b.isBusy(1000 + THROTTLE_MS) === false, "idle once throttle expires")
  assert(b.msUntilIdle(1000) === THROTTLE_MS, "msUntilIdle = THROTTLE_MS right after release")
}

// ── make-storm accrual: 1s per object, ONLY while a command is outstanding, ONLY when paced ──
{
  // Paced (someone else present): each make adds OBJECT_LOAD_MS.
  const b = new BusyState()
  b.armCommand()
  b.noteMake(1000, true)
  b.noteMake(1000, true)
  b.noteMake(1000, true)
  b.releaseCommand(1000)
  // three objects → ~3s of catch-up, dominating the base throttle
  assert(b.isBusy(1000 + 3 * OBJECT_LOAD_MS - 1) === true, "3 objects ≈ 3s of hold")
  assert(b.isBusy(1000 + 3 * OBJECT_LOAD_MS + THROTTLE_MS) === false, "released after the storm drains")
}
{
  // Unpaced (alone): makes during a command do NOT accrue catch-up time; only base throttle.
  const b = new BusyState()
  b.armCommand()
  b.noteMake(1000, false)
  b.noteMake(1000, false)
  b.releaseCommand(1000)
  assert(b.isBusy(1000 + THROTTLE_MS) === false, "alone: no per-object hold, just throttle")
}
{
  // Idle makes (no command outstanding) are inert — the ATM-coin case: another user's action
  // streams makes to me but must NOT freeze my interface.
  const b = new BusyState()
  b.noteMake(1000, true)
  b.noteMake(1000, true)
  assert(b.isBusy(1000) === false, "makes with no outstanding command never arm busy")
  assert(b.busyUntil === 0, "idle makes leave busyUntil untouched")
}

// ── storm settle: quiet gap after the last make ──
{
  const b = new BusyState()
  b.armCommand()
  assert(b.stormSettled(1000) === true, "no makes yet → settled")
  b.noteMake(1000, true)
  assert(b.stormSettled(1000) === false, "just saw a make → not settled")
  assert(b.stormSettled(1000 + SETTLE_GAP_MS - 1) === false, "still within the gap")
  assert(b.stormSettled(1000 + SETTLE_GAP_MS) === true, "settled after the quiet gap")
}

// ── arrival hold: ARRIVAL_MS floor when paced, nothing when alone ──
{
  const b = new BusyState()
  b.armArrival(1000, true)
  assert(b.isBusy(1000 + ARRIVAL_MS - 1) === true, "arrival holds for ~ARRIVAL_MS")
  assert(b.isBusy(1000 + ARRIVAL_MS) === false, "arrival hold ends after ARRIVAL_MS")

  const solo = new BusyState()
  solo.armArrival(1000, false)
  assert(solo.isBusy(1000) === false, "arrival alone → no hold")
}

// ── busyUntil only ever grows (max), so overlapping sources don't shorten the wait ──
{
  const b = new BusyState()
  b.armArrival(1000, true) // until 1000 + ARRIVAL_MS
  b.armCommand()
  b.releaseCommand(1000) // throttle tail is far shorter than the arrival hold
  assert(b.isBusy(1000 + ARRIVAL_MS - 1) === true, "the longer (arrival) hold wins, not the throttle")
}

console.log("test-busy: ok")
