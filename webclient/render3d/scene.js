// scene.js — the Three.js diorama: fixed camera, real floor + back-wall geometry, and a reconciler
// that turns habiworld's per-object composited frames (from region.js computeLayoutMap) into
// billboards standing on the floor / hanging on the wall. GPU depth ordering replaces the 2D
// client's painter's-Y z-index; a raycast replaces its pixel-readback pick.
//
// Three is passed in (from ../vendor/three.module.js) so this module has no hard import of it.
// Placement reuses the 2D client's own layout box (objectSpaceFromLayout) for horizontal parity,
// then lifts it into 3D via project.js. See the plan's risk note: the exact vertical anchor is
// tuned against the live 2D render.

import { floorGeometry, wallGeometry } from "./env.js"
import {
  worldFromObjectXY, effectiveXY,
  STAGE_W, STAGE_H, DEFAULT_REGION_DEPTH, DEFAULT_PROJECTION, FOREGROUND_BIT,
} from "./project.js"
import { Billboard } from "./billboard.js"
import { objectSpaceFromLayout } from "../habirender/region.js"
import { renderBackdrop, splitBackdrop } from "./backdrop.js"

// Convert an object's 2D layout box into the world-space bottom-left corner of its billboard.
//   • horizontal: exact 2D parity — pxLeft = objSpace.minX × 8 (render.js topLeftCanvasOffset).
//   • vertical/depth: from the horizon model (project.js) — floor objects rest at wy=0 receding by
//     depth; wall objects sit at wy=(v−depth) up from the horizon at the wall.
const placeFromLayout = (layout, mod, regionDepth, cfg) => {
  const objSpace = objectSpaceFromLayout(layout)
  const p = worldFromObjectXY(mod.x, mod.y, regionDepth, cfg)
  return { wx: objSpace.minX * 8, wy: p.wy, wz: p.wz }
}

// Background (the whole bg pass) is composited into one texture and split onto the floor/wall
// surfaces (see backdrop.js); only FOREGROUND objects (0x80 — avatars, furniture) are billboards.
const isForegroundMod = (mod) => (mod.y & FOREGROUND_BIT) !== 0

export function createScene(THREE, { canvas, projection = DEFAULT_PROJECTION } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a0a1a) // C64-ish night; overdrawn by the region's own flats

  // Fixed camera: a slightly elevated, near-head-on view of the set so depth reads without ever
  // exposing the single wall's missing sides. Looks down +Z (from the front) at the floor's middle.
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 4000)
  const placeCamera = (regionDepth) => {
    const wallZ = regionDepth * projection.depthScale
    // In FRONT of the scene (+Z) looking toward −Z where it recedes — so world +X lands screen-right
    // (matching habitat x) and billboards face the camera. Elevated enough that the floor reads with
    // depth, shallow enough that we never see over the single back wall.
    camera.position.set(STAGE_W / 2, STAGE_H * 0.64, wallZ * 1.15)
    camera.lookAt(STAGE_W / 2, STAGE_H * 0.32, -wallZ * 0.5)
  }

  // Environment meshes (rebuilt when region depth changes).
  const envGroup = new THREE.Group()
  scene.add(envGroup)
  let floorMesh = null
  let wallMesh = null
  const buildEnv = (regionDepth) => {
    envGroup.clear()
    const mkPlane = (geo, color) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute("position", new THREE.Float32BufferAttribute(geo.positions, 3))
      g.setAttribute("uv", new THREE.Float32BufferAttribute(geo.uvs, 2))
      g.computeVertexNormals()
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
      return new THREE.Mesh(g, mat)
    }
    floorMesh = mkPlane(floorGeometry(regionDepth, projection), 0x243024) // muted ground
    wallMesh = mkPlane(wallGeometry(regionDepth, projection), 0x101830)   // muted backdrop
    // Nudge the wall a few units farther back so objects sitting AT the horizon (v = depth, e.g. a
    // door: wz = −wallZ) render just in front of it instead of z-fighting the wall surface.
    wallMesh.position.z = -3
    envGroup.add(wallMesh)
    envGroup.add(floorMesh)
  }

  let regionDepth = DEFAULT_REGION_DEPTH
  buildEnv(regionDepth)
  placeCamera(regionDepth)

  // Backdrop rebuild bookkeeping. We can't cache on the bg set alone: trapezoid flats (sky/ground)
  // allocate their canvas at full size and fill it ASYNCHRONOUSLY when the trap texture loads —
  // same object, same width×height — so no set/identity key ever changes. Instead, after the bg set
  // changes we rebuild + checksum the composite for a self-extending grace window and re-upload only
  // when the pixels actually change; it self-heals when a trap fills in, then settles.
  let lastBgSetSig = null // the bg SET signature (refs + sizes) — changes on add/remove/reload
  let lastBgSum = null    // pixel checksum of the last uploaded composite
  let bgGrace = 0         // frames left to keep re-checking (extended whenever pixels change)
  const setRegionDepth = (d) => {
    const nd = d || DEFAULT_REGION_DEPTH
    if (nd === regionDepth) return
    regionDepth = nd
    buildEnv(regionDepth) // new meshes → force a backdrop re-apply
    placeCamera(regionDepth)
    lastBgSetSig = null
    lastBgSum = null
  }

  // Cheap content checksum over a strided pixel sample — detects an in-place trap fill.
  const bgChecksum = (cv) => {
    const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data
    let h = d.length
    for (let i = 0; i < d.length; i += 4 * 211) h = (Math.imul(h, 31) + d[i] + d[i + 1] * 3 + d[i + 3] * 7) | 0
    return h
  }

  // Assign a canvas as a mesh's surface texture (NearestFilter keeps the C64 dither crisp).
  const setMeshTexture = (mesh, canvas) => {
    if (!mesh || !canvas) return
    const tex = new THREE.CanvasTexture(canvas)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    if (mesh.material.map) mesh.material.map.dispose()
    mesh.material.map = tex
    mesh.material.color.setHex(0xffffff)
    mesh.material.needsUpdate = true
  }

  // ── billboard reconciler ──────────────────────────────────────────────────────
  // One Billboard per object ref; framesRef tracks frame-array identity so we only rebuild
  // textures when the composited frames actually change (avatars change every tick; static props
  // never do). `mesh.userData.noid` lets the raycast resolve a pick back to a game object.
  const billboards = new Map() // ref → { bb, framesRef }
  const pickGroup = new THREE.Group()
  scene.add(pickGroup)
  let syncWarn = 0 // rate-limit per-object skip warnings

  const removeBillboard = (ref) => {
    const entry = billboards.get(ref)
    if (!entry) return
    pickGroup.remove(entry.bb.mesh)
    entry.bb.dispose()
    billboards.delete(ref)
  }

  // Sync from a computeLayoutMap result + the live world (for mod + seating resolution).
  const syncObjects = (layoutMap, world) => {
    setRegionDepth(world.region?.depth)
    const regionRef = world.region?.ref
    const live = new Set()
    const bgItems = []      // the region's background objects → composited into the backdrop
    let bgSig = ""          // cache key: bg refs + their y + frame-canvas size
    for (const ref in layoutMap) {
     // Guard each object so one bad frame/layout can't abort the whole sync (which would leave every
     // foreground object unrendered — the "something aborted" symptom). Skip it, keep the rest.
     try {
      const item = layoutMap[ref]
      const layout = item.layout?.value
      const obj = item.obj?.value
      if (!layout || !obj || !layout.frames || layout.frames.length === 0) continue
      const rec = world.getByRef ? world.getByRef(ref) : null
      const mod = obj.mods?.[0]
      if (!mod) continue
      // Background objects (the whole bg pass — sky, ground, walls, signs, …) are composited into
      // the backdrop texture and split onto the floor/wall, NOT billboarded. Only foreground
      // objects (0x80: avatars, furniture) and seated avatars become billboards.
      const seated = rec && rec.containerRef && rec.containerRef !== regionRef
      if (obj.in === regionRef && !isForegroundMod(mod) && !seated) {
        const f = layout.frames[0]
        bgItems.push({ frame: f, x: layout.x, y: layout.y, modY: mod.y })
        bgSig += `${ref}:${mod.y}:${f?.canvas?.width}x${f?.canvas?.height};`
        continue
      }
      live.add(ref)

      let entry = billboards.get(ref)
      if (!entry) {
        const bb = new Billboard(THREE)
        bb.mesh.userData.noid = mod.noid
        pickGroup.add(bb.mesh)
        entry = { bb, framesRef: null }
        billboards.set(ref, entry)
      }
      if (entry.framesRef !== layout.frames) {
        entry.bb.setFrames(layout.frames)
        entry.framesRef = layout.frames
      }
      entry.bb.mesh.userData.noid = mod.noid

      // Resolve seating (a seated avatar projects at the seat's floor position).
      const containerRec = rec && rec.containerRef && rec.containerRef !== regionRef
        ? (world.getByRef ? world.getByRef(rec.containerRef) : null) : null
      const eff = rec ? effectiveXY(rec, containerRec, regionRef) : { x: mod.x, y: mod.y }
      const pos = placeFromLayout(layout, eff, regionDepth, projection)
      entry.bb.setWorldRect(pos.wx, pos.wy, pos.wz)
     } catch (e) { if (syncWarn++ < 5) console.warn("[scene] skipped a bad object:", e) }
    }
    // Drop billboards whose object left the region.
    for (const ref of [...billboards.keys()]) if (!live.has(ref)) removeBillboard(ref)

    // On any bg-set change, (re)open a ~10s grace window (trap textures fill in over seconds, and
    // the set sig stabilizes BEFORE the pixels do). Throttled to ~10 Hz, rebuild + checksum the
    // composite and re-upload only when the pixels change — catching async in-place trap fills. Each
    // change re-extends the window; it closes once the backdrop has been stable for ~10s.
    if (bgSig !== lastBgSetSig) { lastBgSetSig = bgSig; bgGrace = 600 }
    if (bgGrace > 0 && bgItems.length) {
      bgGrace--
      if ((bgGrace % 6) === 0) {
        const backdrop = renderBackdrop(bgItems)
        const sum = bgChecksum(backdrop)
        if (sum !== lastBgSum) {
          lastBgSum = sum
          bgGrace = 600 // pixels changed (a trap filled in) — keep watching
          const { wall, floor } = splitBackdrop(backdrop, regionDepth)
          setMeshTexture(wallMesh, wall)
          setMeshTexture(floorMesh, floor)
        }
      }
    }
  }

  // Advance animation frames on the 250ms cadence (static multi-frame props); avatar frames are
  // single-frame-per-tick already, so this is a no-op for them.
  const advanceFrames = (nowMs) => {
    const idx = Math.floor(nowMs / 250)
    for (const { bb } of billboards.values()) bb.setFrameIndex(idx)
  }

  // ── picking ───────────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const pointerToNdc = (ev) => {
    const r = canvas.getBoundingClientRect()
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1
  }
  // Returns { kind:"object", noid } for a prop/avatar hit, or { kind:"floor", x, y } in habitat
  // coords for a floor hit, or null.
  const pickAt = (ev) => {
    pointerToNdc(ev)
    raycaster.setFromCamera(ndc, camera)
    const objHits = raycaster.intersectObjects(pickGroup.children, false)
    if (objHits.length > 0) {
      const noid = objHits[0].object.userData.noid
      if (noid != null) return { kind: "object", noid }
    }
    if (floorMesh) {
      const fHits = raycaster.intersectObject(floorMesh, false)
      if (fHits.length > 0) {
        const p = fHits[0].point
        // Inverse projection: worldX → habitat x (col×8 → col×4); worldZ (negative) → depth → y.
        const col = Math.round(p.x / 8)
        let habX = col * 4
        if (habX < 0) habX = 0
        else if (habX > 160) habX = 160
        let depth = Math.round(-p.z / projection.depthScale)
        if (depth < 0) depth = 0
        else if (depth > regionDepth) depth = regionDepth
        return { kind: "floor", x: habX, y: FOREGROUND_BIT | depth }
      }
    }
    return null
  }

  // ── render loop plumbing ────────────────────────────────────────────────────────
  const resize = () => {
    const w = canvas.clientWidth || canvas.width
    const h = canvas.clientHeight || canvas.height
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const renderFrame = () => renderer.render(scene, camera)

  const dispose = () => {
    for (const ref of [...billboards.keys()]) removeBillboard(ref)
    renderer.dispose()
  }

  return { renderer, scene, camera, syncObjects, advanceFrames, pickAt, resize, renderFrame, setRegionDepth, dispose }
}
