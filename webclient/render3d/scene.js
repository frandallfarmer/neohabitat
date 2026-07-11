// scene.js — the Three.js diorama: fixed camera, real floor + back-wall geometry, and a reconciler
// that turns habiworld's per-object composited frames (from region.js computeLayoutMap) into
// billboards standing on the floor / hanging on the wall. GPU depth ordering replaces the 2D
// client's painter's-Y z-index; a raycast replaces its pixel-readback pick.
//
// Three is passed in (from ../vendor/three.module.js) so this module has no hard import of it.
// Placement gives the billboard the object's ORIGIN (project.js horizon model); the billboard then
// positions each animation frame by its own cel space (billboard.js), matching the 2D client's
// per-frame draw so a walk cycle doesn't hop.

import { floorGeometry, wallGeometry } from "./env.js"
import {
  worldFromObjectXY, effectiveXY,
  STAGE_W, STAGE_H, DEFAULT_REGION_DEPTH, DEFAULT_PROJECTION, FOREGROUND_BIT,
} from "./project.js"
import { Billboard } from "./billboard.js"
import { splitBackdrop } from "./backdrop.js"
import { buildNeighborDioramas, clearNeighbors } from "./neighbors.js"
import { compositeRegion } from "../habirender/region.js"
import { hitTestFrame, celNumberAtFrame, markerAtFrame, HELD_PICK_MARKER } from "../habirender/pick.mjs"

// The object's ORIGIN in world coords (the billboard adds each frame's own cel offset — billboard.js).
//   • horizontal: originX = layout.x × 8 (the object's x column; frame.minX×8 is added per frame).
//   • vertical/depth: the horizon model (project.js) — floor objects' feet rest at wy=0 receding by
//     depth; wall objects sit at wy=(v−depth) up from the horizon at the wall.
const placeFromLayout = (layout, mod, regionDepth, cfg) => {
  const p = worldFromObjectXY(mod.x, mod.y, regionDepth, cfg)
  return { wx: layout.x * 8, wy: p.wy, wz: p.wz }
}

// Background (the whole bg pass) is composited into one texture and split onto the floor/wall
// surfaces (see backdrop.js); only FOREGROUND objects (0x80 — avatars, furniture) are billboards.
const isForegroundMod = (mod) => (mod.y & FOREGROUND_BIT) !== 0

export function createScene(THREE, { canvas, projection = DEFAULT_PROJECTION, neighbors = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))

  const scene = new THREE.Scene()
  // Unrendered space (the canvas area outside the diorama flats, and behind props that hang off the
  // frame like lamp posts). A subtle neutral dark grey — NOT a C64 palette value (it sits between
  // black #000 and C64 dark grey #4a4a4a) so black props read against it instead of vanishing.
  scene.background = new THREE.Color(0x2c2c31) // overdrawn by the region's own flats

  // Fixed camera: a slightly elevated, near-head-on view of the set so depth reads without ever
  // exposing the single wall's missing sides. Looks down +Z (from the front) at the floor's middle.
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 4000)
  const placeCamera = (regionDepth) => {
    const wallZ = regionDepth * projection.depthScale
    // In FRONT of the scene (+Z) looking toward −Z where it recedes — so world +X lands screen-right
    // (matching habitat x) and billboards face the camera. Elevated enough that the floor reads with
    // depth, shallow enough that we never see over the single back wall.
    //
    // Pull back far enough to frame the ENTIRE back wall width (STAGE_W) with a margin, for the
    // CURRENT aspect — otherwise a shallow region (small wallZ, e.g. Plaza Fountain) sits too close
    // and clips the wall. Never closer than the old wallZ×1.15 framing. Recomputed on resize.
    const vHalf = (camera.fov * Math.PI / 180) / 2
    const hHalf = Math.atan(Math.tan(vHalf) * (camera.aspect || 1))
    const distForWidth = ((STAGE_W / 2) * 1.15) / Math.tan(hHalf) // z-distance to fit the wall width
    // VERTICAL fit: pull back far enough that BOTH the wall top AND the floor's near edge (the front
    // lip) are in frame — otherwise shallow regions (small wallZ) clip the tall wall above and the
    // front lip below. The camera stays elevated at cy and is pitched so the near edge lands at a
    // fixed screen height (NEAR_NDC, a small front-lip margin below it); we then need cz large enough
    // that the wall top clears the top (WALL_NDC). Both targets ARE the depth-32 framing, so every
    // depth frames alike (at depth 32 this reproduces the old cy=0.64·H / lookY=0.32·H camera). The
    // near edge and wall top are horizontal screen lines (no corner droop), so center math suffices.
    const cy = STAGE_H * 0.64
    const NEAR_NDC = -0.854, WALL_NDC = 0.974
    const DELTA = Math.atan(-NEAR_NDC * Math.tan(vHalf)) // pitch offset that puts the near edge at NEAR_NDC
    const lookPitch = (cz) => Math.atan(cy / cz) - DELTA
    const wallNdc = (cz) => Math.tan(lookPitch(cz) + Math.atan((STAGE_H - cy) / (wallZ + cz))) / Math.tan(vHalf)
    let lo = wallZ * 1.15, hi = 6000 // wallNdc decreases as cz grows → find the smallest cz that fits
    for (let i = 0; i < 48; i++) { const m = (lo + hi) / 2; if (wallNdc(m) > WALL_NDC) lo = m; else hi = m }
    const camZ = Math.max(wallZ * 1.15, distForWidth - wallZ, hi)
    const lookY = cy - Math.tan(lookPitch(camZ)) * (camZ + wallZ / 2)
    camera.position.set(STAGE_W / 2, cy, camZ)
    camera.lookAt(STAGE_W / 2, lookY, -wallZ / 2)
    camera.updateMatrixWorld() // refresh matrixWorldInverse now so project()/unproject() (edge wedges,
    // walk-off-edge, balloon x) are correct even when called before the next renderFrame updates it.
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

  // POC: neighbor-region previews — the adjacent regions' bitmaps filling the grey side margins (see
  // neighbors.js). Rebuilt (async) whenever the region changes; a token cancels an in-flight build.
  const neighborsGroup = new THREE.Group()
  scene.add(neighborsGroup)
  let lastNeighborRegion = null
  let neighborToken = { stale: false }

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

  // Get-or-create a billboard for a ref, refreshing its frames when they change.
  const ensureBillboard = (ref, mod, frames) => {
    let entry = billboards.get(ref)
    if (!entry) {
      entry = { bb: new Billboard(THREE), framesRef: null }
      pickGroup.add(entry.bb.mesh)
      billboards.set(ref, entry)
    }
    if (entry.framesRef !== frames) { entry.bb.setFrames(frames); entry.framesRef = frames }
    entry.bb.mesh.userData.noid = mod.noid
    entry.bb.mesh.userData.bb = entry.bb // so the raycast can read the CURRENT frame for cel/limb pick
    return entry
  }

  // The ORIGIN of a contained item ON its container's plane (2D containedItemLayout). The item's own
  // layout is already container-relative (computeLayoutMap ran containedItemLayout /
  // offsetsFromContainer), so its origin X is layout.x×8 and its origin Y is the container's origin
  // plus the 2D vertical offset (item.layout.y − container.layout.y). The billboard adds each frame's
  // own cel offset. Depth is the container's plane; contentsInFront nudges it in front, else behind.
  const containedItemPos = (layout, containerItem) => {
    const cLayout = containerItem.layout?.value
    const cMod = containerItem.obj?.value?.mods?.[0]
    const cProp = containerItem.prop?.value
    if (!cLayout || !cMod || !cProp) return null
    const cPlace = placeFromLayout(cLayout, cMod, regionDepth, projection) // container origin anchor
    const bias = cProp.contentsInFront ? projection.fgBias : -projection.fgBias
    return {
      wx: layout.x * 8,
      wy: cPlace.wy + (layout.y - cLayout.y),
      wz: cPlace.wz + bias,
    }
  }

  // Sync from a computeLayoutMap result + the live world (for mod + seating resolution).
  const syncObjects = (layoutMap, world, objects) => {
    setRegionDepth(world.region?.depth)
    const regionRef = world.region?.ref
    // POC: (re)build the left/right neighbor previews when the region changes (regionDepth is now
    // current). Gated by the `neighbors` switch (?neighbors=0 off) — a hook for future corner renders.
    if (neighbors && regionRef && regionRef !== lastNeighborRegion) {
      lastNeighborRegion = regionRef
      neighborToken.stale = true
      neighborToken = { stale: false }
      buildNeighborDioramas(THREE, neighborsGroup, world, regionDepth, projection, neighborToken)
    }
    const live = new Set()
    let bgCount = 0         // how many background objects the backdrop will composite (grace gate)
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
        bgCount++
        // The backdrop (composited by compositeRegion below) is cached and only rebuilt when this
        // signature changes, so it must capture everything that alters what a background object
        // draws: its render position (x,y), z-order (mod.y), and the fields that pick its frame —
        // gr_state (animinit.m graphic state: doors opening, machines, gates, any state transition),
        // orientation (horizontal flip), style (which prop), and the frame's size. gr_state is the
        // general "BG object changed" signal; don't special-case doors. (In-place trap fills keep
        // the same signature — the checksum grace window below catches those.)
        bgSig += `${ref}:${layout.x},${layout.y}:${mod.y}:${mod.gr_state ?? 0}:${mod.orientation ?? 0}:${mod.style ?? 0}:${f?.canvas?.width}x${f?.canvas?.height};`
        continue
      }
      // A contained item (a box's contents, a phone in a desk) renders ON its container's plane at
      // the container's contentsXY offset — and ONLY if the container displays contents. An opaque
      // container has no contentsXY table → contents hidden (the open-box case). Excludes an avatar's
      // own head/hand (composed into the body frame) and seated avatars (bodies, handled below).
      const containerItem = (obj.in && obj.in !== regionRef) ? layoutMap[obj.in] : null
      const containerProp = containerItem?.prop?.value
      if (containerItem && containerProp) {
        // Contained in a body (avatar): head/hands are composed INTO the body frame and pocket
        // inventory is invisible in-region (C64 display_avatar) — never a separate billboard.
        if (containerProp.isBody) { removeBillboard(ref); continue }
        // Contained in a real container (box/desk). NOT a seated avatar (an Avatar in a non-body
        // seat) — that falls through to the normal path below (effectiveXY seat resolution).
        if (rec?.mod?.type !== "Avatar") {
          const isGlue = containerItem.obj?.value?.mods?.[0]?.type === "Glue" // offset via mod fields, not contentsXY
          const shows = isGlue || (containerProp.contentsXY && containerProp.contentsXY.length > mod.y)
          if (!shows) { removeBillboard(ref); continue } // opaque container / slot not displayed → hidden
          const pos = containedItemPos(layout, containerItem)
          if (!pos) continue
          live.add(ref)
          ensureBillboard(ref, mod, layout.frames).bb.setWorldRect(pos.wx, pos.wy, pos.wz)
          continue
        }
      }

      live.add(ref)
      const entry = ensureBillboard(ref, mod, layout.frames)
      // Resolve seating (a seated avatar projects at the seat's floor position).
      const containerRec = rec && rec.containerRef && rec.containerRef !== regionRef
        ? (world.getByRef ? world.getByRef(rec.containerRef) : null) : null
      // DEPTH must follow the walk animation. computeLayoutMap builds a FREE object's layout from
      // the animated displayMod, so layout.y already carries the current v (depth) — but the server
      // mod.y is stale mid-walk. wx comes from the (animated) layout, so left/right worked; wz came
      // from mod.y, so forward/back was frozen. Drive depth from layout.y (keeping the FOREGROUND
      // bit) for free objects; seated/contained objects keep their container's depth (effectiveXY).
      const depthSource = containerRec
        ? effectiveXY(rec, containerRec, regionRef)
        : { x: mod.x, y: (mod.y & FOREGROUND_BIT) | (layout.y & 0x7f) }
      const pos = placeFromLayout(layout, depthSource, regionDepth, projection)
      entry.bb.setWorldRect(pos.wx, pos.wy, pos.wz)
     } catch (e) { if (syncWarn++ < 5) console.warn("[scene] skipped a bad object:", e) }
    }
    // Drop billboards whose object left the region.
    for (const ref of [...billboards.keys()]) if (!live.has(ref)) removeBillboard(ref)

    // On any change to the bg signature — a new bg set, OR a background object changing gr_state /
    // position / flip (a door opens, etc.) — (re)open a ~10s grace window (trap textures also fill in
    // over seconds, and the sig stabilizes BEFORE those pixels do). Throttled to ~10 Hz, rebuild +
    // checksum the composite and re-upload only when the pixels change — catching both the state
    // change and async in-place trap fills. Each change re-extends the window; it closes once the
    // backdrop has been stable for ~10s.
    if (bgSig !== lastBgSetSig) { lastBgSetSig = bgSig; bgGrace = 600 }
    if (bgGrace > 0 && bgCount) {
      bgGrace--
      if ((bgGrace % 6) === 0) {
        // Composite via the SHARED 2D compositor (bgOnly) so the backdrop is bit-identical to the 2D
        // web client's render — same position/z-order/contents/trap handling — then split it.
        const backdrop = compositeRegion(objects, layoutMap, { bgOnly: true })
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
  const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  // Pick at a pointer position (an event or {clientX, clientY}):
  //   foreground billboard → { kind:"object", noid, habitatX, habitatY, whichLimb, celNumber }
  //   backdrop (wall/floor) → { kind:"backdrop", backdropX, backdropY }  (un-split 2D canvas coords)
  //   miss                  → null
  // FG whichLimb/celNumber come from the TRANSFORM-BACK: the billboard's raycast UV maps straight into
  // its current 2D frame, so pick.mjs limbAtFrame/celNumberAtFrame read the same cel/limb buffers the
  // 2D renderer built (SPRAY limb, door cel-2 pass-through). habitatX/Y is the cursor's floor coord.
  // A BACKGROUND object (sign, door, ground) is baked into the backdrop texture, so we hand the caller
  // its position in that texture and it reuses the 2D pick.mjs pickAt against the background objects.
  const pickAt = (ev) => {
    pointerToNdc(ev)
    raycaster.setFromCamera(ndc, camera)
    // Cursor habitat coord = where the ray meets the floor (GO target / face), for the FG-object case.
    let habitatX = 0, habitatY = FOREGROUND_BIT | 0
    if (floorMesh) {
      const fHits = raycaster.intersectObject(floorMesh, false)
      if (fHits.length > 0) {
        const p = fHits[0].point // worldX → habitat x (col×8 → col×4); worldZ (−) → depth
        habitatX = clampN(Math.round(p.x / 8) * 4, 0, 160)
        habitatY = FOREGROUND_BIT | clampN(Math.round(-p.z / projection.depthScale), 0, regionDepth)
      }
    }
    // Foreground billboards, nearest-first; skip transparent cel pixels (alpha test), like the 2D pick.
    for (const h of raycaster.intersectObjects(pickGroup.children, false)) {
      const noid = h.object.userData.noid
      const bb = h.object.userData.bb
      const frame = bb?.frames?.[bb.index]
      if (noid == null || !frame?.canvas || !h.uv) continue
      const px = Math.floor(h.uv.x * frame.canvas.width)
      const py = Math.floor((1 - h.uv.y) * frame.canvas.height) // CanvasTexture flipY
      if (!hitTestFrame(frame, px, py, 0, 0)) continue // transparent → not a real hit; try behind
      // Read the avatar pick-buffer marker once: 1–4 → a body limb (SPRAY), 0x80 → the HELD item's
      // pixels (composeAvatarFrame paints them with HELD_PICK_MARKER). `held` lets the adapter resolve
      // the click to the avatar's HANDS-slot object (pick.mjs heldItemOf) — matching the 2D pickAt.
      const marker = markerAtFrame(frame, px, py, 0, 0)
      return {
        kind: "object", noid, habitatX, habitatY,
        whichLimb: marker >= 1 && marker <= 4 ? marker - 1 : null,
        celNumber: celNumberAtFrame(frame, px, py, 0, 0),
        held: marker === HELD_PICK_MARKER,
      }
    }
    // No billboard → the BACKDROP. Invert splitBackdrop: the wall shows the top (STAGE_H−depth) rows,
    // the floor the bottom `depth` rows; CanvasTexture flipY means UV v=1 is the top image row. Map the
    // hit UV back to the un-split backdrop canvas (x∈[0,STAGE_W), y∈[0,STAGE_H−1)) for pick.mjs pickAt.
    const bg = raycaster.intersectObjects([wallMesh, floorMesh].filter(Boolean), false)[0]
    if (bg?.uv) {
      const wallH = STAGE_H - regionDepth
      const u = clampN(bg.uv.x, 0, 1), v = clampN(bg.uv.y, 0, 1)
      const backdropX = clampN(Math.round(u * STAGE_W), 0, STAGE_W - 1)
      const rawY = bg.object === wallMesh ? (1 - v) * (wallH - 1)
                                          : wallH + (1 - v) * (regionDepth - 1)
      const backdropY = clampN(Math.round(rawY), 0, STAGE_H - 2) // pick.mjs REGION_CANVAS_H is 127
      return { kind: "backdrop", backdropX, backdropY }
    }
    return null
  }

  // ── render loop plumbing ────────────────────────────────────────────────────────
  const resize = () => {
    const w = canvas.clientWidth || canvas.width
    const h = canvas.clientHeight || canvas.height
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    placeCamera(regionDepth) // reframe for the new aspect so the full wall still fits
    camera.updateProjectionMatrix()
  }
  const renderFrame = () => renderer.render(scene, camera)

  const dispose = () => {
    for (const ref of [...billboards.keys()]) removeBillboard(ref)
    neighborToken.stale = true
    clearNeighbors(neighborsGroup)
    renderer.dispose()
  }

  // Debug/automation: the current world position of a billboard by noid (null if not present).
  const billboardPos = (noid) => {
    for (const { bb } of billboards.values()) {
      if (bb.mesh.userData.noid === noid) {
        const p = bb.mesh.position
        return { x: p.x, y: p.y, z: p.z }
      }
    }
    return null
  }

  return { renderer, scene, camera, syncObjects, advanceFrames, pickAt, resize, renderFrame, setRegionDepth, dispose, billboardPos }
}
