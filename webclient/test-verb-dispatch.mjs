// Node tests: unified verb dispatch paths (DO/GO/GET/PUT/TALK/rDO) + ME send resolution.
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const { HabitatWorld, constants, dispatch } = require("../habiworld/index.js")

const cursorArgsFromPick = (pick, args = {}) => {
  if (!pick) return { ...args }
  return {
    ...args,
    ...(args.x === undefined ? { x: pick.habitatX } : {}),
    ...(args.y === undefined ? { y: pick.habitatY } : {}),
  }
}

const {
  ACTION_DO,
  ACTION_RDO,
  ACTION_GO,
  ACTION_GET,
  ACTION_PUT,
  ACTION_TALK,
} = constants

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

const merged = cursorArgsFromPick({ habitatX: 40, habitatY: 100 }, { page: 1 })
assert(merged.page === 1 && merged.x === 40 && merged.y === 100, "pick merges cursor args")
const overridden = cursorArgsFromPick({ habitatX: 40, habitatY: 100 }, { x: 12 })
assert(overridden.x === 12 && overridden.y === 100, "explicit args override pick x")

const resolveOutbound = (msg, world) => {
  if (!msg || msg.to !== "ME") return msg
  const ref = world?.me?.ref
  if (!ref) throw new Error("avatar not in region")
  return { ...msg, to: ref }
}

const REGION_REF = "context-test"
const ME_REF = "user-test-1"

function makeStorm(world) {
  world.apply({
    to: "session", op: "make",
    obj: {
      type: "context", ref: REGION_REF, name: "Test",
      mods: [{ type: "Region", orientation: 0, neighbors: ["", "", "", ""], lighting: 0 }],
    },
  })
  world.apply({
    to: REGION_REF, op: "make", you: true,
    obj: {
      type: "user", ref: ME_REF, name: "Tester",
      mods: [{ type: "Avatar", noid: 17, x: 12, y: 142, orientation: 0, gr_state: 0 }],
    },
  })
  world.apply({
    to: REGION_REF, op: "make",
    obj: {
      type: "user", ref: "user-neighbor-2", name: "Neighbor",
      mods: [{ type: "Avatar", noid: 21, x: 100, y: 140, orientation: 0, gr_state: 0 }],
    },
  })
  world.apply({
    to: REGION_REF, op: "make",
    obj: {
      type: "item", ref: "item-frisbee-1", name: "Frisbee",
      mods: [{ type: "Frisbee", noid: 30, x: 60, y: 140, orientation: 0, gr_state: 0 }],
    },
  })
  world.apply({
    to: REGION_REF, op: "make",
    obj: {
      type: "item", ref: "item-street-1", name: "Street",
      mods: [{ type: "Street", noid: 50, x: 80, y: 160, orientation: 0, gr_state: 0 }],
    },
  })
}

function recorder(replies) {
  const calls = { walks: [], sends: [], waits: [] }
  const queue = replies ? [...replies] : null
  const world = new HabitatWorld()
  makeStorm(world)
  const client = {
    walkTo: async (x, y) => { calls.walks.push({ x, y }); return { x, y } },
    send: async (msg) => {
      calls.sends.push(resolveOutbound(msg, world))
      return queue ? queue.shift() : { type: "reply", err: 1 }
    },
    animationWait: async (ms) => { calls.waits.push(ms) },
    beep: () => {},
    boing: () => {},
  }
  return { world, calls, client }
}

const { world, calls, client } = recorder()
assert((await dispatch(world, ACTION_GO, 30, { x: 88, y: 120 }, client)).ok, "GO")
assert(calls.walks.length === 1, "GO walks")

calls.walks.length = 0
calls.sends.length = 0
assert((await dispatch(world, ACTION_GET, 30, {}, client)).ok, "GET")
assert(calls.sends.some((m) => m.op === "GET"), "GET sends GET")

calls.walks.length = 0
calls.sends.length = 0
world.apply({ op: "GET$", noid: 17, target: 30, how: 1 })
assert((await dispatch(world, ACTION_PUT, 21, {}, client)).ok, "PUT avatar")
assert(calls.sends.some((m) => m.op === "HAND"), "PUT at avatar sends HAND")

calls.walks.length = 0
calls.sends.length = 0
world.apply({ op: "GET$", noid: 17, target: 30, how: 1 })
assert((await dispatch(world, ACTION_DO, 50, { x: 120, y: 144 }, client)).ok, "DO street+throw")
assert(calls.sends[0]?.op === "THROW", "DO depends to throw")

calls.walks.length = 0
calls.sends.length = 0
assert((await dispatch(world, ACTION_TALK, 30, { text: "hi" }, client)).ok, "TALK")
assert(calls.sends[0]?.op === "SPEAK", "TALK sends SPEAK")
assert(calls.sends[0]?.to === ME_REF, "TALK resolves ME to avatar ref")

calls.walks.length = 0
calls.sends.length = 0
const rdo = await dispatch(world, ACTION_RDO, 17, {}, client)
assert(rdo.ok === false, "rDO on avatar is noEffect")
assert(calls.sends.length === 0, "rDO beeps without wire")

console.log("test-verb-dispatch: ok")