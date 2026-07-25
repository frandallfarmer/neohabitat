// Node tests: the busy/wait-cursor state machine (lib/busy.mjs).
import {
  BusyState, shouldPace, paceCount, minWaitMs,
  BASE_WAIT_MS, PER_AVATAR_MS, OBJECT_LOAD_MS, ARRIVAL_MS, SETTLE_GAP_MS,
} from "./lib/busy.mjs"

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

// A minimal world stub for shouldPace/paceCount (only avatars()/ghost()/meNoid are read).
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

// ── paceCount: corporeal occupants incl. me; a lone ghost counts only as avatar #2 ──
{
  assert(paceCount(world({ avatars: [{ noid: 1 }], meNoid: 1 })) === 1, "alone → 1")
  assert(paceCount(world({ avatars: [{ noid: 1 }, { noid: 7 }], meNoid: 1 })) === 2, "two avatars → 2")
  assert(paceCount(world({ avatars: [{ noid: 1 }, { noid: 7 }, { noid: 9 }], meNoid: 1 })) === 3, "three avatars → 3")
  assert(paceCount(world({ avatars: [{ noid: 1 }], ghost: { noid: 255 }, meNoid: 1 })) === 2, "me + a lone ghost → 2 (ghost is avatar #2)")
  assert(paceCount(world({ avatars: [{ noid: 1 }, { noid: 7 }], ghost: { noid: 255 }, meNoid: 1 })) === 2, "ghost adds nothing once ≥2 real avatars")
  assert(paceCount(world({ avatars: [], ghost: { noid: 255 }, meNoid: 255 })) === 1, "I AM the ghost, empty room → 1 (no self-pace)")
  assert(paceCount(null) === 1, "no world → 1")
}

// ── minWaitMs: 2s base, +1s per additional avatar (the agreed progression table) ──
{
  assert(minWaitMs(1) === BASE_WAIT_MS, "1 avatar → 2s base")
  assert(minWaitMs(2) === BASE_WAIT_MS + PER_AVATAR_MS, "2 avatars → 3s")
  assert(minWaitMs(3) === BASE_WAIT_MS + 2 * PER_AVATAR_MS, "3 avatars → 4s")
  assert(minWaitMs(6) === BASE_WAIT_MS + 5 * PER_AVATAR_MS, "6 avatars → 7s")
}

// ── base per-command floor: minimum wait measured from ARM (BASE_WAIT_MS solo) ──
{
  const b = new BusyState()
  b.armCommand(1000)
  assert(b.isBusy(1000) === true, "command-active → busy immediately")
  b.releaseCommand(1000) // solo default = BASE_WAIT_MS, anchored at the arm time (1000)
  assert(b.commandActive === false, "release clears command-active")
  assert(b.isBusy(1000 + BASE_WAIT_MS - 1) === true, "held until the base floor (from arm)")
  assert(b.isBusy(1000 + BASE_WAIT_MS) === false, "idle once the base floor passes")
}
{
  // A command whose natural work already outran the floor gets NO extra hold.
  const b = new BusyState()
  b.armCommand(1000)
  b.releaseCommand(1000 + BASE_WAIT_MS + 500) // released well past the floor
  assert(b.isBusy(1000 + BASE_WAIT_MS + 500) === false, "no added hold when natural work outran the floor")
}
{
  // Population scaling: 3 avatars → base + 2×per-avatar minimum wait, from arm.
  const b = new BusyState()
  b.armCommand(1000)
  const wait = minWaitMs(3)
  b.releaseCommand(1000, wait)
  assert(b.isBusy(1000 + wait - 1) === true, "held until the scaled (4s) floor")
  assert(b.isBusy(1000 + wait) === false, "idle at the scaled floor")
}

// ── make-storm accrual: 1s per object, ONLY while a command is outstanding, ONLY when paced ──
{
  // Paced (someone else present): each make adds OBJECT_LOAD_MS.
  const b = new BusyState()
  b.armCommand(1000)
  b.noteMake(1000, true)
  b.noteMake(1000, true)
  b.noteMake(1000, true)
  b.releaseCommand(1000) // solo base floor (3000) < storm tail (4000) → storm dominates
  // three objects → ~3s of catch-up from t=1000, dominating the 2s base floor
  assert(b.isBusy(1000 + 3 * OBJECT_LOAD_MS - 1) === true, "3 objects ≈ 3s of hold")
  assert(b.isBusy(1000 + 3 * OBJECT_LOAD_MS) === false, "released after the storm drains")
}
{
  // Unpaced (alone): makes during a command do NOT accrue catch-up time; only the base floor.
  const b = new BusyState()
  b.armCommand(1000)
  b.noteMake(1000, false)
  b.noteMake(1000, false)
  b.releaseCommand(1000)
  assert(b.isBusy(1000 + BASE_WAIT_MS - 1) === true, "alone: held to the base floor")
  assert(b.isBusy(1000 + BASE_WAIT_MS) === false, "alone: no per-object hold, just the base floor")
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
  b.armCommand(1000)
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
  b.armCommand(1000)
  b.releaseCommand(1000) // base floor is far shorter than the arrival hold
  assert(b.isBusy(1000 + ARRIVAL_MS - 1) === true, "the longer (arrival) hold wins, not the base floor")
}

console.log("test-busy: ok")
