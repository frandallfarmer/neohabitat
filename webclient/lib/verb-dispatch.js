// User-verb dispatch — pointer.m pick → habiworld dispatch(verb, noid, args).
//
// All C64 pie-menu verbs share one path (action_head.i slots 0–7):
//   DO(0) rDO(1) GO(2) GET(4) PUT(5) TALK(6)
// Cursor { x, y } from the renderer pick is merged into args for GO, PUT on
// ground, DO-on-surface, etc. (generic_goToCursor / generic_goToAndDropAt).

import { pickAt } from "../habirender/pick.mjs"

/** Merge habitat cursor coords from a pick into verb args (caller args win). */
export function cursorArgsFromPick(pick, args = {}) {
  if (!pick) return { ...args }
  return {
    ...args,
    ...(args.x === undefined ? { x: pick.habitatX } : {}),
    ...(args.y === undefined ? { y: pick.habitatY } : {}),
  }
}

export function pickRegionTarget(pickState, canvasX, canvasY, scale = 1) {
  if (!pickState?.layoutMap || !pickState?.objects) return null
  return pickAt(
    pickState.layoutMap,
    pickState.objects,
    canvasX / scale,
    canvasY / scale,
  )
}

/**
 * Dispatch any user-verb slot against a pointed object.
 * @param {number} verb — ACTION_DO | ACTION_RDO | ACTION_GO | ACTION_GET | ACTION_PUT | ACTION_TALK
 */
export async function dispatchVerb({
  world,
  dispatch,
  dispatchClient,
  verb,
  noid,
  args = {},
  pick = null,
}) {
  if (!world?.me || !dispatchClient) return { ok: false, reason: "not-ready" }
  if (noid == null) return { ok: false, reason: "no-noid" }
  return dispatch(world, verb, noid, cursorArgsFromPick(pick, args), dispatchClient)
}

/** Pick at canvas coords, then dispatch — used by click-to-GO and future pie menu. */
export async function dispatchVerbAtPick({
  world,
  dispatch,
  dispatchClient,
  verb,
  pickState,
  canvasX,
  canvasY,
  scale = 1,
  args = {},
}) {
  const pick = pickRegionTarget(pickState, canvasX, canvasY, scale)
  if (!pick) return { ok: false, reason: "no-target" }
  if (pick.noid == null) return { ok: false, reason: "no-noid" }
  return dispatchVerb({
    world,
    dispatch,
    dispatchClient,
    verb,
    noid: pick.noid,
    args,
    pick,
  })
}