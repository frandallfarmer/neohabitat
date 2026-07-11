// render3d-adapter.js — the 3D renderer adapter for the shared app-shell (lib/app-shell.js).
//
// Supplies the same hooks the 2D adapter does, but backed by the Three.js diorama (render3d/). The
// shell owns ALL UI behavior; this only renders the region and maps coordinates. The region view is
// a 960×384 canvas — the 2D region's 320×128 at scale 3 — so the reused RegionCursor overlay, the
// balloon panel, the edge chevrons, and fit-to-viewport all line up dimensionally with the 2D client.

import { h } from "preact"
import htm from "htm"
import { useRef, useEffect } from "preact/hooks"
import { signal } from "@preact/signals"
import * as THREE from "../vendor/three.module.js"
import { computeLayoutMap } from "../habirender/region.js"
import { pickAt as pick2D, heldItemOf } from "../habirender/pick.mjs"
import { RegionCursor } from "./cursor-view.js"
import { createScene } from "../render3d/scene.js"
import { sideNeighborRef } from "../render3d/neighbors.js"
import { DEFAULT_PROJECTION, DEFAULT_REGION_DEPTH } from "../render3d/project.js"

const html = htm.bind(h)
const REGION_W = 320, REGION_H = 128, SCALE = 3
const CANVAS_W = REGION_W * SCALE, CANVAS_H = REGION_H * SCALE // 960×384
const DEPTH_SCALE = DEFAULT_PROJECTION.depthScale // world Z per habitat depth-unit (scene default)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function make3DAdapter() {
  // The live scene/canvas, set by RegionView3D on mount so the coordinate hooks below can reach it.
  const sceneRef = { view: null, canvas: null }
  const _v = new THREE.Vector3()

  // Project a FLOOR world point (wx lateral 0..320, wz depth ≤0 receding) to region-canvas coords
  // (cx 0..REGION_W, cy 0..REGION_H) via the live camera. `behind` = the point is behind the camera.
  const floorToRegionCanvas = (view, wx, wz) => {
    _v.set(wx, 0, wz).project(view.camera)
    return { cx: (_v.x * 0.5 + 0.5) * REGION_W, cy: (1 - (_v.y * 0.5 + 0.5)) * REGION_H, behind: _v.z > 1 }
  }

  // The region slot: mounts the Three scene, drives the render loop, populates pickState, and
  // overlays the shared modal cursor (RegionCursor) — the same one the 2D client uses.
  const RegionView3D = ({ objects, avatarMotion, pickState, world, regionInput }) => {
    const canvasRef = useRef(null)
    const latest = useRef({ objects, avatarMotion, world })
    latest.current = { objects, avatarMotion, world }
    const layoutSig = useRef(null)
    if (!layoutSig.current) layoutSig.current = signal({})
    // Bumped once the scene mounts and on every reframe (resize) so the render recomputes the edge
    // wedges against the live camera. Read in the render body → this component re-renders on change.
    const readySig = useRef(null)
    if (!readySig.current) readySig.current = signal(0)

    // Recompute the composited layout when the object set changes (the per-avatar layout effects then
    // update it every avatarMotion tick — the loop reads the reactive value).
    useEffect(() => { computeLayoutMap(objects, layoutSig.current, avatarMotion) }, [objects, avatarMotion])

    useEffect(() => {
      const canvas = canvasRef.current
      // Neighbor-region previews are ON by default; ?neighbors=0 (or off/false/no) disables them.
      // A hook for iterating — e.g. swapping in future "corner" renders for the perpendicular case.
      const nb = new URLSearchParams(location.search).get("neighbors")
      const showNeighbors = !["0", "off", "false", "no"].includes((nb || "").toLowerCase())
      const view = createScene(THREE, { canvas, neighbors: showNeighbors })
      sceneRef.view = view; sceneRef.canvas = canvas
      view.resize()
      readySig.current.value++ // scene mounted → recompute edge wedges
      if (new URLSearchParams(location.search).has("debug")) {
        window.__scene3d = view; window.__pickState3d = pickState; window.__pick2D = pick2D
      }
      const onResize = () => { view.resize(); readySig.current.value++ }
      window.addEventListener("resize", onResize)
      let raf = 0, errs = 0, lastCamZ = null
      const loop = () => {
        const { objects, world } = latest.current
        try {
          if (objects && world) {
            const lm = layoutSig.current.value
            pickState.layoutMap = lm      // kept in sync for the shell / keyboard-target picks
            pickState.objects = objects
            view.syncObjects(lm, world, objects)
          }
          view.advanceFrames(performance.now())
          view.renderFrame()
          // Recompute the edge wedges whenever the camera reframes — resize, or the region depth
          // change that syncObjects applies here (setRegionDepth → placeCamera). The wedge geometry is
          // projected in the render, so a re-render must follow the reframe. camZ captures both.
          const cz = view.camera.position.z
          if (cz !== lastCamZ) { lastCamZ = cz; readySig.current.value++ }
          errs = 0
        } catch (e) { if (errs++ < 3) console.error("[render3d] frame failed:", e) }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener("resize", onResize)
        try { view.dispose() } catch (_) { /* */ }
        sceneRef.view = null; sceneRef.canvas = null
      }
    }, [])

    // Perspective edge affordances: wedge polygons over the BLACK margins adjacent to the floor's
    // projected edges — a left/right triangle beside each slanted floor edge and a front-lip strip
    // below the near edge. Clicking one runs the shell's walk-off-edge (regionInput.onEdge). They sit
    // ABOVE the cursor overlay, but only the filled polygons capture clicks (pointer-events), so an
    // in-region floor click falls through the transparent SVG to the cursor beneath. readySig makes
    // this recompute once the scene mounts / reframes (the camera frames to the current aspect).
    readySig.current.value // subscribe
    const view = sceneRef.view
    const depth = world?.region?.depth ?? DEFAULT_REGION_DEPTH
    // Only offer an exit on a side that actually HAS a neighbor (else the transit won't resolve).
    const nbrs = world?.region?.neighbors, ori = world?.region?.orientation ?? 0
    const has = { left: !!sideNeighborRef(nbrs, ori, "left"), right: !!sideNeighborRef(nbrs, ori, "right"), down: !!sideNeighborRef(nbrs, ori, "down") }
    let wedges = null
    if (view?.camera && regionInput?.onEdge && regionInput.enabled) {
      const P = (wx, wz) => { const p = floorToRegionCanvas(view, wx, wz); return [Math.round(p.cx * SCALE), Math.round(p.cy * SCALE)] }
      const wallZ = depth * DEPTH_SCALE, wallH = REGION_H - depth
      // Wall-top corners (world y = wallH at the back plane). The side wedges run the FULL height of the
      // current region's left/right silhouette (floor margin + back wall), so mousing anywhere down the
      // side edge — including over the neighbor-preview wall — highlights it as a transit target. A
      // wall-area click un-projects past the far edge → edgeCoord clamps it to the region-depth edge.
      const Pw = (wx) => { _v.set(wx, wallH, -wallZ).project(view.camera); return [Math.round((_v.x * 0.5 + 0.5) * CANVAS_W), Math.round((1 - (_v.y * 0.5 + 0.5)) * CANVAS_H)] }
      const nL = P(0, 0), nR = P(REGION_W, 0), fL = P(0, -wallZ), fR = P(REGION_W, -wallZ)
      const WL = Pw(0), WR = Pw(REGION_W)
      const poly = (pts) => pts.map((p) => p.join(",")).join(" ")
      // Two panes per side — the floor-margin wedge and the wall box above it — grouped so mousing
      // either highlights BOTH (the neighbor floor+wall reads as one linked transit selection).
      wedges = {
        has,
        leftFloor: poly([[0, fL[1]], fL, nL, [0, nL[1]]]),
        leftWall: poly([[0, 0], WL, fL, [0, fL[1]]]),
        rightFloor: poly([[CANVAS_W, fR[1]], fR, nR, [CANVAS_W, nR[1]]]),
        rightWall: poly([[CANVAS_W, 0], WR, fR, [CANVAS_W, fR[1]]]),
        down: poly([nL, nR, [CANVAS_W, CANVAS_H], [0, CANVAS_H]]),
        // Glyphs sit UP toward the horizon end of each wedge and OUT toward the screen edge.
        gl: [Math.max(16, fL[0] * 0.14), fL[1] + (CANVAS_H - fL[1]) * 0.30],
        gr: [Math.min(CANVAS_W - 16, fR[0] + (CANVAS_W - fR[0]) * 0.86), fR[1] + (CANVAS_H - fR[1]) * 0.30],
        // Front-lip glyph only when the near edge is actually on-screen (else the floor fills to the
        // bottom and there's no visible front edge to walk off).
        gd: nL[1] < CANVAS_H - 8 ? [CANVAS_W / 2, (nL[1] + CANVAS_H) / 2] : null,
      }
    }
    const Cursor = regionInput?.Cursor
    return html`
      <div style="position: relative; width: ${CANVAS_W}px; height: ${CANVAS_H}px; background: #2c2c31;">
        <canvas ref=${canvasRef} width=${CANVAS_W} height=${CANVAS_H}
                style="display:block; width:${CANVAS_W}px; height:${CANVAS_H}px; image-rendering:pixelated;"></canvas>
        ${Cursor && regionInput.enabled
          ? html`<${Cursor} width=${REGION_W} height=${REGION_H}
                    onCommand=${regionInput.onCommand} onMove=${regionInput.onMove}
                    onBounds=${regionInput.onBounds} enabled=${regionInput.enabled}
                    busy=${regionInput.busy} busyIcon=${regionInput.busyIcon}
                    cursorWarp=${regionInput.cursorWarp} />`
          : null}
        ${wedges ? html`
          <svg viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" width=${CANVAS_W} height=${CANVAS_H}
               style="position:absolute; left:0; top:0; overflow:hidden; pointer-events:none; z-index:10001;">
            ${wedges.has.left ? html`<g class="edge-side" onClick=${regionInput.onEdge("left")}><title>Walk off the left edge</title>
              <polygon class="edge-wedge" points=${wedges.leftFloor}/>
              <polygon class="edge-wedge" points=${wedges.leftWall}/>
            </g>` : null}
            ${wedges.has.right ? html`<g class="edge-side" onClick=${regionInput.onEdge("right")}><title>Walk off the right edge</title>
              <polygon class="edge-wedge" points=${wedges.rightFloor}/>
              <polygon class="edge-wedge" points=${wedges.rightWall}/>
            </g>` : null}
            ${wedges.has.down ? html`<g class="edge-side" onClick=${regionInput.onEdge("down")}><title>Walk off the front edge</title>
              <polygon class="edge-wedge" points=${wedges.down}/>
            </g>` : null}
            ${wedges.has.left ? html`<text class="edge-wedge-glyph" x=${wedges.gl[0]} y=${wedges.gl[1]}>◀</text>` : null}
            ${wedges.has.right ? html`<text class="edge-wedge-glyph" x=${wedges.gr[0]} y=${wedges.gr[1]}>▶</text>` : null}
            ${wedges.has.down && wedges.gd ? html`<text class="edge-wedge-glyph" x=${wedges.gd[0]} y=${wedges.gd[1]}>▼</text>` : null}
          </svg>` : null}
      </div>`
  }

  return {
    RegionView: RegionView3D,
    Cursor: RegionCursor,          // the shell threads this into regionInput.Cursor; the modal pie-cursor
    // NO installFit: the 2D client's fit-to-viewport CSS-transforms #app to scale the 960px stage up,
    // but CSS-scaling a live WebGL canvas tears/blurs it on real GPUs (the POC, with no transform,
    // was crisp). So the 3D client leaves #app un-transformed and renders the canvas at native
    // resolution. (Filling large viewports responsively is a follow-up — resize the WebGL buffer
    // rather than CSS-scale it.)

    // Pick at the cursor's press-anchor. canvasX/canvasY are scaled logical px (0..320*scale,
    // 0..128*scale) — the space RegionCursor works in. Convert to the pointer's screen position over
    // the 3D canvas, raycast (scene.pickAt), and return the 2D pick.mjs shape verb-dispatch expects.
    pickRegionTarget: (pickState, canvasX, canvasY, scale) => {
      const { view, canvas } = sceneRef
      if (!view || !canvas) return null
      const rect = canvas.getBoundingClientRect()
      const fx = canvasX / (REGION_W * scale)
      const fy = canvasY / (REGION_H * scale)
      const pick = view.pickAt({ clientX: rect.left + fx * rect.width, clientY: rect.top + fy * rect.height })
      if (!pick) return null
      // Foreground billboard: the scene already transform-backed limb/cel. A hit on the HELD item's
      // pixels (pick.held, the 0x80 marker) resolves to the avatar's HANDS-slot object — like the 2D
      // pickAt — so F7 / verbs target what's in hand, not the avatar. Find the avatar by noid to get
      // its ref for heldItemOf.
      if (pick.kind === "object") {
        if (pick.held) {
          const objs = pickState?.objects || []
          const avatar = objs.find(o => o.mods?.[0]?.noid === pick.noid)
          const item = avatar ? heldItemOf(objs, avatar.ref) : null
          if (item?.mods?.[0]) return { noid: item.mods[0].noid, habitatX: pick.habitatX, habitatY: pick.habitatY }
        }
        return { noid: pick.noid, habitatX: pick.habitatX, habitatY: pick.habitatY, whichLimb: pick.whichLimb, celNumber: pick.celNumber }
      }
      // Backdrop (wall/floor): the scene inverted the horizon split into 2D backdrop canvas coords.
      // Background objects (signs, doors, ground) are baked into that texture from the SAME 2D layout,
      // so pick.mjs pickAt resolves them there exactly as the 2D client would — including the ground
      // fallback (→ floor GO). Exclude FOREGROUND objects (avatars/furniture): those are billboards
      // handled by the raycast above, and their 2D layout position ≠ their 3D screen position.
      if (pick.kind === "backdrop") {
        const bgObjects = (pickState?.objects || []).filter(o => o.type === "context" || !(o.mods?.[0]?.y & 0x80))
        const hit = pick2D(pickState?.layoutMap, bgObjects, pick.backdropX, pick.backdropY)
        return hit ? { noid: hit.noid, habitatX: hit.habitatX, habitatY: hit.habitatY, whichLimb: hit.whichLimb, celNumber: hit.celNumber } : null
      }
      return null
    },

    // Balloon horizontal hook: project the speaker's billboard to the screen and map into the
    // 0..160 panel space (speakerXposFromMod's range; balloons ×2 → 0..320 px). 0 = no on-screen tail.
    speakerScreenX: (world, noid) => {
      const { view } = sceneRef
      const pos = view?.billboardPos?.(noid)
      if (!pos) return 0
      _v.set(pos.x, pos.y, pos.z).project(view.camera)
      if (_v.z > 1) return 0 // behind the camera
      return Math.max(0, Math.min(160, Math.round((_v.x * 0.5 + 0.5) * 160)))
    },

    // The 3D client draws its OWN edge affordances (the perspective wedges in RegionView3D), so the
    // shell must NOT also render its rectangular grid chevrons. onEdge is still the shell's shared
    // walk-then-transit handler; the wedges just invoke it.
    rendersOwnEdges: true,

    // Walk-off-edge → a floor GO coordinate at the region's x-edge, THEN transit (shell onEdgeClick).
    // The 2D returns habitat coords directly; here the shell RAYCASTS the returned point, so we must
    // return a floor SCREEN point (perspective). The depth comes from where the click landed within
    // the floor edge's on-screen span (top/horizon → far, bottom/near-edge → near); we project a
    // floor world point there (nudged just inside the edge so the raycast reliably lands on the floor).
    edgeCoord: (edge, e, region) => {
      const { view, canvas } = sceneRef
      if (!view?.camera || !canvas) return null
      const depth = region?.depth ?? DEFAULT_REGION_DEPTH
      const rect = canvas.getBoundingClientRect()
      // UN-PROJECT the click onto the floor plane (y=0): perspective-correct, so the walk target lands
      // where the click points at the ground (a linear screen-Y→depth map is wrong under perspective).
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1
      _v.set(ndcX, ndcY, 0.5).unproject(view.camera)
      const cam = view.camera.position
      const wallZ = depth * DEPTH_SCALE
      const dy = _v.y - cam.y
      const FAR = -wallZ + 2 // just inside the far edge, so the shell's raycast lands on the FLOOR (not
      // the wall behind it) and rounds to habitat y = region depth
      let wz, hitX = cam.x
      if (dy < -1e-6) {
        // Ray points DOWN → it meets the floor plane (y=0) in front; use that depth (perspective-correct),
        // clamped into the walkable band. A click near/just-above the horizon clamps to the FAR edge.
        const t = -cam.y / dy
        hitX = cam.x + t * (_v.x - cam.x)                       // world x where the ray meets the floor
        wz = Math.max(FAR, Math.min(0, cam.z + t * (_v.z - cam.z)))
      } else {
        // Click AT/ABOVE the horizon (over the back wall / neighbor-wall pane) → no floor hit in front;
        // walk to the region's FAR edge (habitat y = region depth), then transit.
        wz = FAR
      }
      // left/right: pin x to the region's edge (walk off the side); down: keep the click's x (walk off
      // the front). Nudge x just inside so the shell's raycast reliably lands on the floor.
      const wx = edge === "left" ? 2 : edge === "right" ? REGION_W - 2 : Math.max(2, Math.min(REGION_W - 2, hitX))
      const { cx, cy, behind } = floorToRegionCanvas(view, wx, wz)
      return behind ? null : { cx, cy, scale: SCALE }
    },
  }
}
