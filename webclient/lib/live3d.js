// live3d.js — orchestrator for the 3D-native "diorama" client (POC).
//
// SEPARATE, ADDITIVE alternate client: it reuses the SHARED libraries read-only and renders through
// render3d/ (Three.js) instead of the 2D region view. The existing 2D client (live.js / live.html)
// is untouched. Data flow mirrors live.js:
//
//   websocketProxy → Transport → world.apply (habiworld: state + host behaviors) → scene.syncObjects
//                                └→ ctx.sound / dispatch (verbs)  ── same callback bag as 2D
//
// POC scope: one region, fixed camera, billboards on a real floor + back wall, click-to-walk,
// click-to-verb (GET / shift+GET=DO), original SID sound. No balloons/text/inventory/customize.

import * as THREE from "../vendor/three.module.js"
import { signal } from "@preact/signals"
import { Transport } from "./transport.js"
import { loadHabiworld } from "./habiworld.js"
import { worldToObjects } from "./world-adapter.js"
import { createAvatarMotion } from "./avatar-chore.js"
import { getSoundEngine, installFocusResume } from "./sound.js"
import { buildPresentationClient } from "./presentation.js"
import { buildDispatchClient } from "./world-client.js"
import { computeLayoutMap } from "../habirender/region.js"
import { findGroundObject } from "../habirender/pick.mjs"
import { createScene } from "../render3d/scene.js"

// Bare fetch paths (props/*.bin, bodies/*.bin, …) resolve under habirender/ — same shim as live.js
// so the shared decoders load their art unchanged.
const RENDER_BASE = "./habirender/"
const _fetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, init) => {
  if (typeof input === "string" && !/^([a-z][a-z0-9+.-]*:|\/|\.\/|\.\.\/)/i.test(input)) input = RENDER_BASE + input
  return _fetch(input, init)
}

const q = (k, d) => new URLSearchParams(location.search).get(k) ?? d
const qNum = (k, d) => { const v = Number(q(k, d)); return Number.isFinite(v) && v > 0 ? v : d }

// Same WS resolution as live.js (plain HTTP dev → ws://host:1987; HTTPS → wss://host/ws).
const WS_PROXY_PORT = 1987
const wsDefault = () => q("ws", location.protocol === "https:"
  ? `wss://${location.host}/ws`
  : `ws://${location.hostname}:${WS_PROXY_PORT}`)

const setStatus = (text) => { const el = document.getElementById("status3d"); if (el) el.textContent = text }

async function main() {
  const { HabitatWorld, classes, dispatch, constants } = await loadHabiworld()
  const { ACTION_GO, ACTION_GET, ACTION_DO, THE_REGION } = constants

  const world = new HabitatWorld()
  const avatarMotion = createAvatarMotion()

  // Sound: reused 100% unchanged. Failure is non-fatal (POC still renders silently).
  let hs = null
  try { hs = await getSoundEngine() } catch (e) { console.warn("[live3d] sound init failed:", e) }
  installFocusResume(() => hs)

  // Object table → layout map (the shared 2D layout engine composites avatars/props for us).
  const objects = signal([])
  const layoutSig = signal({})
  const refresh = () => {
    objects.value = worldToObjects(world)
    computeLayoutMap(objects.value, layoutSig, avatarMotion) // rebuild only on object-set change
  }
  for (const ev of ["added", "removed", "regionDescribed", "regionChanged",
                    "moved", "stateChanged", "fieldChanged", "containerChanged", "lighting"]) {
    world.on(ev, refresh)
  }

  // The habiworld presentation callback bag — sound/chore/posture/startWalk reused; balloons off.
  const presentation = buildPresentationClient({ hs, world, classes, avatarMotion, refresh, balloons: null })
  if (typeof world.setClient === "function") world.setClient(presentation)
  else world._client = presentation

  // The 3D scene.
  const canvas = document.getElementById("scene")
  const view = createScene(THREE, { canvas })
  const onResize = () => view.resize()
  window.addEventListener("resize", onResize)
  view.resize()

  let dispatchClient = null
  let commandBusy = false
  const runVerb = async (verb, noid, args) => {
    if (commandBusy || !dispatchClient || !world.me) return
    commandBusy = true
    try { await dispatch(world, verb, noid, args, dispatchClient) }
    catch (e) { console.warn("[live3d] verb failed:", e) }
    finally { commandBusy = false }
  }

  // Click the floor → GO there. Click a prop/avatar → GET (shift → DO).
  canvas.addEventListener("pointerdown", (ev) => {
    const pick = view.pickAt(ev)
    if (!pick) return
    // Floor GO targets the region's GROUND object (Street/Ground/GROUND_FLAT), like the 2D pick's
    // findGroundObject fallback: GO on the ground → generic_goToCursor walks to (x,y). (GO on your
    // OWN avatar is a sit/stand toggle; GO on the region noid 0 doesn't resolve — hence the ground.)
    if (pick.kind === "floor") {
      const ground = findGroundObject(objects.value)
      const groundNoid = ground?.mods?.[0]?.noid ?? THE_REGION
      runVerb(ACTION_GO, groundNoid, { x: pick.x, y: pick.y })
    } else if (pick.kind === "object") {
      runVerb(ev.shiftKey ? ACTION_DO : ACTION_GET, pick.noid, {})
    }
  })

  // Connect.
  const context = q("context", null) // null → server drops you at your last region
  const user = q("user", "test3d")
  const ws = wsDefault()
  let gotMsg = false
  const transport = new Transport({
    url: ws,
    baud: qNum("baud", 600),
    onOpen: () => { setStatus(`connected — entering as ${user}…`); transport.enterContext(context, user) },
    onClose: () => setStatus(gotMsg ? "disconnected" : "WebSocket closed with no data — is bridge_v2 up?"),
    onError: () => setStatus(`connection error — is the websocketProxy up at ${ws}?`),
    onMessage: (m) => {
      gotMsg = true
      world.apply(m)
      const rec = world.get(m.noid)
      if (m.op === "FIDDLE_$" && m.offset === 9) avatarMotion.noteServerFacing(m.noid)
      else avatarMotion.onOp(m, rec?.mod?.orientation ?? 0, rec?.mod?.activity ?? rec?.mod?.action ?? 129)
      if (world.region?.name) setStatus(`in ${world.region.name} — click floor to walk, click a prop to GET (shift=DO)`)
    },
  })
  dispatchClient = buildDispatchClient({ transport, presentation, world, requestTextInput: undefined })
  transport.connect()

  // Dev hook (opt-in via ?debug=1): expose the live model + view for console/automation probing.
  if (q("debug", null) === "1") {
    globalThis.__live3d = {
      world, view, avatarMotion, transport, dispatch, dispatchClient, constants, objects, layoutSig,
      // Resolve a pick at client (canvas) coords, without a real pointer event.
      pickAtXY: (clientX, clientY) => view.pickAt({ clientX, clientY }),
      // Force a GO to a habitat coord (bypasses picking) to isolate the walk pipeline.
      goTo: (x, y) => {
        const ground = findGroundObject(objects.value)
        return dispatch(world, ACTION_GO, ground?.mods?.[0]?.noid ?? THE_REGION, { x, y }, dispatchClient)
      },
    }
  }

  // Render loop: read current layouts (reactive to avatarMotion tick) → billboards → draw.
  const loop = () => {
    view.syncObjects(layoutSig.value, world)
    view.advanceFrames(performance.now())
    view.renderFrame()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  setStatus(`connecting to ${ws}…`)
}

main().catch((e) => { console.error(e); setStatus("failed to start: " + e.message) })
