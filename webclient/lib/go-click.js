// Click-to-GO: pointer.m pick → dispatch(ACTION_GO) on the class verb table.

import { pickAt } from "../habirender/pick.mjs"

export async function handleRegionGoClick({
  world,
  dispatch,
  dispatchClient,
  ACTION_GO,
  pickState,
  canvasX,
  canvasY,
  scale = 1,
}) {
  if (!world?.me || !dispatchClient || !pickState?.layoutMap) {
    return { ok: false, reason: "not-ready" }
  }
  const pick = pickAt(
    pickState.layoutMap,
    pickState.objects,
    canvasX / scale,
    canvasY / scale,
  )
  if (!pick) return { ok: false, reason: "no-target" }
  if (pick.noid == null) return { ok: false, reason: "no-noid" }
  return dispatch(world, ACTION_GO, pick.noid, { x: pick.habitatX, y: pick.habitatY }, dispatchClient)
}