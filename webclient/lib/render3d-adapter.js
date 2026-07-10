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
import { findGroundObject } from "../habirender/pick.mjs"
import { RegionCursor } from "./cursor-view.js"
import { createScene } from "../render3d/scene.js"

const html = htm.bind(h)
const REGION_W = 320, REGION_H = 128, SCALE = 3
const CANVAS_W = REGION_W * SCALE, CANVAS_H = REGION_H * SCALE // 960×384

export function make3DAdapter() {
  // The live scene/canvas, set by RegionView3D on mount so the coordinate hooks below can reach it.
  const sceneRef = { view: null, canvas: null }
  const _v = new THREE.Vector3()

  // The region slot: mounts the Three scene, drives the render loop, populates pickState, and
  // overlays the shared modal cursor (RegionCursor) — the same one the 2D client uses.
  const RegionView3D = ({ objects, avatarMotion, pickState, world, regionInput }) => {
    const canvasRef = useRef(null)
    const latest = useRef({ objects, avatarMotion, world })
    latest.current = { objects, avatarMotion, world }
    const layoutSig = useRef(null)
    if (!layoutSig.current) layoutSig.current = signal({})

    // Recompute the composited layout when the object set changes (the per-avatar layout effects then
    // update it every avatarMotion tick — the loop reads the reactive value).
    useEffect(() => { computeLayoutMap(objects, layoutSig.current, avatarMotion) }, [objects, avatarMotion])

    useEffect(() => {
      const canvas = canvasRef.current
      const view = createScene(THREE, { canvas })
      sceneRef.view = view; sceneRef.canvas = canvas
      view.resize()
      const onResize = () => view.resize()
      window.addEventListener("resize", onResize)
      let raf = 0, errs = 0
      const loop = () => {
        const { objects, world } = latest.current
        try {
          if (objects && world) {
            const lm = layoutSig.current.value
            pickState.layoutMap = lm      // kept in sync for the shell / keyboard-target picks
            pickState.objects = objects
            view.syncObjects(lm, world)
          }
          view.advanceFrames(performance.now())
          view.renderFrame()
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

    const Cursor = regionInput?.Cursor
    return html`
      <div style="position: relative; width: ${CANVAS_W}px; height: ${CANVAS_H}px; background: #000;">
        <canvas ref=${canvasRef} width=${CANVAS_W} height=${CANVAS_H}
                style="display:block; width:${CANVAS_W}px; height:${CANVAS_H}px; image-rendering:pixelated;"></canvas>
        ${Cursor && regionInput.enabled
          ? html`<${Cursor} width=${REGION_W} height=${REGION_H}
                    onCommand=${regionInput.onCommand} onMove=${regionInput.onMove}
                    onBounds=${regionInput.onBounds} enabled=${regionInput.enabled}
                    busy=${regionInput.busy} busyIcon=${regionInput.busyIcon}
                    cursorWarp=${regionInput.cursorWarp} />`
          : null}
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
      if (pick.kind === "object") {
        return { noid: pick.noid, habitatX: pick.habitatX, habitatY: pick.habitatY, whichLimb: pick.whichLimb, celNumber: pick.celNumber }
      }
      // Floor → GO on the region's ground object at the floor's habitat coords (the 2D fallback).
      const ground = findGroundObject(pickState?.objects || [])
      if (!ground) return null
      return { noid: ground.mods[0].noid, habitatX: pick.x, habitatY: pick.y }
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

    // Full-height side chevrons over the 3D canvas. (edgeCoord omitted for now → a chevron transits
    // immediately via the agnostic changeRegion, without a walk-to-edge GO first; a later refinement.)
    sideChevronStyle: () => `height:${CANVAS_H}px; align-self:center;`,
  }
}
