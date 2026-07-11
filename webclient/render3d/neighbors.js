// neighbors.js — POC (spike): fill the left/right grey margins beside the current region's floor with
// the ADJACENT regions, textured from their pre-rendered bitmaps (/renders/context-<ref>.png), so a
// Downtown street visually CONTINUES into its neighbors. Reuses the region floor+wall geometry and the
// horizon split, offset ±STAGE_W in X so the floors/walls stay coplanar (continuous).
//
// EXPERIMENTAL — on by default, disabled with ?neighbors=0 (see render3d-adapter.js / scene.js).
//
// Uses each neighbor's REAL depth + orientation (from its DB context) when we can fetch it, else falls
// back to the current region's depth. Orientation is applied as a facing delta (Δorient) vs. the
// current region: Δ0 renders floor + back wall continuous; Δ2 (180°) flips the floor texture, blank
// wall; Δ1/Δ3 (±90°) lay a native-scale center slice of the cross-street's road, blank wall. Corner /
// diagonal neighbors are a future refinement (hence the on/off switch).

import { STAGE_W } from "./project.js"
import { floorGeometry, wallGeometry } from "./env.js"
import { splitBackdrop } from "./backdrop.js"
import { contextMap, until } from "../habirender/data.js"
import { parseHabitatRegion } from "../habirender/neohabitat.js"

// directionNav topology (habirender/region.js:1051): neighbors list order = [North, East, South, West];
// positionToCompassOffset {left:3, right:1}; ineighbor = (orientation + offset + 3) & 3 — the CURRENT
// region's orientation. So which context is on our screen-left/right falls straight out.
const SIDE_OFFSET = { left: 3, right: 1, down: 2 }
export const sideNeighborRef = (neighbors, orientation, side) => {
  const i = ((orientation ?? 0) + SIDE_OFFSET[side] + 3) & 0x03
  const ref = neighbors?.[i]
  return ref && ref !== "" ? ref : null
}

// Per-neighbor {depth, orientation} from its DB context mod — the metadata the render bitmaps lack.
// contextMap() (db/contextmap.json) maps ref → {filename}; parse that file's context/Region mod.
const metaCache = new Map()
const neighborMeta = async (ref) => {
  if (metaCache.has(ref)) return metaCache.get(ref)
  let meta = null
  try {
    const map = await until(() => contextMap(), (m) => Object.keys(m).length > 0)
    const filename = map[ref]?.filename
    if (filename) {
      const objs = parseHabitatRegion(await (await fetch(filename)).text())
      const rmod = objs.find((o) => o.type === "context")?.mods?.[0] || {}
      meta = { depth: rmod.depth ?? 32, orientation: rmod.orientation ?? 0 }
    }
  } catch (_) { /* fall back to current depth */ }
  metaCache.set(ref, meta)
  return meta
}

// Center-crop a canvas to `w` columns (full height). Used for the perpendicular case: we show a
// native-scale center slice of the cross-street's road rather than squeezing its whole width in.
const cropCenterCols = (canvas, w) => {
  w = Math.max(1, Math.min(canvas.width, Math.round(w)))
  const c = document.createElement("canvas")
  c.width = w
  c.height = canvas.height
  const x0 = Math.floor((canvas.width - w) / 2)
  c.getContext("2d").drawImage(canvas, x0, 0, w, canvas.height, 0, 0, w, canvas.height)
  return c
}

const loadImageCanvas = (url) => new Promise((resolve) => {
  const img = new Image()
  img.onload = () => {
    const c = document.createElement("canvas")
    c.width = img.naturalWidth || 320
    c.height = img.naturalHeight || 128
    c.getContext("2d").drawImage(img, 0, 0)
    resolve(c)
  }
  img.onerror = () => resolve(null)
  img.src = url
})

const mkTexturedPlane = (THREE, geo, canvas, dx, dz, rotation = 0) => {
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(geo.positions, 3))
  g.setAttribute("uv", new THREE.Float32BufferAttribute(geo.uvs, 2))
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  if (rotation) { tex.center.set(0.5, 0.5); tex.rotation = rotation } // rotate the road to point the right way
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
  mesh.position.set(dx, 0, dz)
  return mesh
}

export const clearNeighbors = (group) => {
  for (const child of [...group.children]) {
    group.remove(child)
    child.geometry?.dispose?.()
    child.material?.map?.dispose?.()
    child.material?.dispose?.()
  }
}

// (Re)build the left/right neighbor dioramas into `group`. Async (metadata + image loads). `token.stale`
// guards a region change that happens mid-fetch — the stale build drops its result.
export const buildNeighborDioramas = async (THREE, group, world, regionDepth, projection, token) => {
  clearNeighbors(group)
  const neighbors = world.region?.neighbors
  if (!neighbors) return
  const myOrient = world.region?.orientation ?? 0
  for (const [side, dx] of [["left", -STAGE_W], ["right", STAGE_W]]) {
    const ref = sideNeighborRef(neighbors, myOrient, side)
    if (!ref) continue
    const [canvas, meta] = await Promise.all([loadImageCanvas(`/renders/${ref}.png`), neighborMeta(ref)])
    if (token.stale) { clearNeighbors(group); return } // region changed mid-fetch → abandon
    if (!canvas) continue
    const nDepth = meta?.depth ?? regionDepth // real neighbor depth when we have it, else current
    const dOrient = (((meta?.orientation ?? myOrient) - myOrient) + 4) & 3 // neighbor facing vs mine
    const { wall, floor } = splitBackdrop(canvas, nDepth)
    if (dOrient === 0) {
      // Same facing → the street lines up: full floor + back wall (continuous).
      group.add(mkTexturedPlane(THREE, wallGeometry(nDepth, projection), wall, dx, -3))
      group.add(mkTexturedPlane(THREE, floorGeometry(nDepth, projection), floor, dx, 0))
    } else if (dOrient === 2) {
      // Opposite facing → 180° TEXTURE flip (aspect-preserving: the band stays 320×depth), floor only,
      // blank wall. The road reverses so it still runs into the distance the right way.
      group.add(mkTexturedPlane(THREE, floorGeometry(nDepth, projection), floor, dx, 0, Math.PI))
    } else {
      // Perpendicular → floor only (blank wall). Rotate the floor POLY +90° around vertical so it
      // recedes INTO the scene (−Z) — head-on texture keeps the road's proportions (a rotated texture
      // smears it thin). Same rotation for both sides; only the abut position differs. The rotated
      // quad spans wallZ in x, so the RIGHT side offsets by STAGE_W + wallZ to sit just past the edge.
      const wallZ = nDepth * projection.depthScale
      // Δ1 faces opposite Δ3, so its road runs the other way — but −90° placement would go off-screen
      // (behind the camera). Keep the +90° placement and REVERSE the road with a 180° texture flip
      // (aspect-preserving), so it connects the right way instead of coming in backwards.
      const flip = dOrient === 1 ? Math.PI : 0
      // Don't squeeze the whole 320-wide road into the depth band (that shrinks it). Show the NATIVE-
      // scale center wallZ-wide slice of the cross-street instead — its far ends recede past the
      // horizon anyway. The slice (wallZ px) maps 1:1 onto the wallZ-wide quad below, so no distortion.
      const slice = cropCenterCols(floor, wallZ)
      const m = mkTexturedPlane(THREE, floorGeometry(nDepth, projection), slice, 0, 0, flip)
      m.rotation.y = Math.PI / 2
      // After the +90° turn the floor's local-X (STAGE_W) becomes the receding depth. Scale it to wallZ
      // so it stops at the wall line (z=−wallZ); with the wallZ-wide crop above this stays 1:1 native.
      m.scale.x = wallZ / STAGE_W
      m.position.set(side === "left" ? 0 : STAGE_W + wallZ, 0, 0)
      group.add(m)
    }
  }
}
