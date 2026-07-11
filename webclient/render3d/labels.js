// labels.js — floating region-name text in the 3D diorama.
//
// The band above a region's back wall is otherwise empty grey (wall top sits at y = STAGE_H − depth,
// while the camera frames up to ≈ STAGE_H), so we hang the region's name there as
// transparent-background letters, centered over the wall at the wall depth, drawn ON TOP of everything.
//
//  • the CURRENT region's name floats above the current wall (always shown, even with ?neighbors=0);
//  • each side NEIGHBOR's name floats in the SAME band but at that neighbor's ±STAGE_W offset and its
//    own depth, so the fixed camera renders it leaning/receding toward that side — "look left and you'd
//    see the name of the place over there". Neighbor names ride with the neighbor previews (gated by
//    the neighbors switch). North (behind the wall) / south (front, where the ▼ chevron lives) are TODO.

import { STAGE_W, STAGE_H } from "./project.js"
import { sideNeighborRef, neighborMeta } from "./neighbors.js"
import { contextMap } from "../habirender/data.js"

const TEXT_FONT = '300 64px "Helvetica Neue", Arial, sans-serif' // light weight
const FONT_PX = 64
const TEXT_FILL = "#b6bac2" // soft cool grey — legible but not glaring white
const TOP_MARGIN = 4        // gap below the frame's top edge
const MAX_H = 18            // world-units tall at full size; shrinks for shallow (thin-band) regions

// A transparent canvas with `text` drawn centered — soft grey with a dark outline so it stays legible
// against the grey sky whatever sits behind it.
const makeTextCanvas = (text) => {
  const pad = 10
  const m = document.createElement("canvas").getContext("2d")
  m.font = TEXT_FONT
  const w = Math.max(2, Math.ceil(m.measureText(text).width) + pad * 2)
  const h = FONT_PX + pad * 2
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d")
  ctx.font = TEXT_FONT
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.lineJoin = "round"
  ctx.strokeStyle = "rgba(0,0,0,0.7)"
  ctx.lineWidth = 6
  ctx.strokeText(text, w / 2, h / 2)
  ctx.fillStyle = TEXT_FILL
  ctx.fillText(text, w / 2, h / 2)
  return c
}

const mkTextMesh = (THREE, text, worldH) => {
  const canvas = makeTextCanvas(text)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter // text, not pixel art — smooth it
  tex.generateMipmaps = false
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace
  const aspect = canvas.width / canvas.height
  const g = new THREE.PlaneGeometry(worldH * aspect, worldH)
  // depthTest off + a high renderOrder → the name draws last, floating OVER all region content
  // (props, lamp posts, avatars) instead of being crossed/occluded by them.
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(g, mat)
  mesh.renderOrder = 999
  mesh.userData.aspect = aspect
  return mesh
}

// Build + place one floating name centered at world-x `centerX`, hanging from top edge `yTop`, over a
// wall of the given `depth`. Names wider than `maxW` scale down to fit (keeps side names in-margin).
// yTop defaults to just under the frame's top edge (the sky band); neighbors pass the wall top so the
// name sits ON the wall.
const addName = (THREE, group, text, centerX, depth, projection, { maxW = STAGE_W * 0.92, yTop = STAGE_H - TOP_MARGIN, roll = 0, worldH: fixedH } = {}) => {
  if (!text) return
  let worldH = fixedH ?? Math.min(MAX_H, depth * 0.7)
  const mesh = mkTextMesh(THREE, text, worldH)
  const worldW = worldH * mesh.userData.aspect
  if (worldW > maxW) { const s = maxW / worldW; mesh.scale.setScalar(s); worldH *= s }
  mesh.position.set(centerX, yTop - worldH / 2, -depth * projection.depthScale)
  if (roll) mesh.rotation.z = roll // slant the name onto the floor-seam diagonal so it reads as attached
  group.add(mesh)
}

const displayName = (ref, fallback) => contextMap()[ref]?.name || fallback || ref.replace(/^context-/, "")
// Exit (neighbor) names get a "To " prefix so they read as destinations vs. the current region's name.
const exitName = (ref) => `To ${displayName(ref)}`

export const clearLabel = (group) => {
  for (const child of [...group.children]) {
    group.remove(child)
    child.geometry?.dispose?.()
    child.material?.map?.dispose?.()
    child.material?.dispose?.()
  }
}

// (Re)build the CURRENT region's floating name (synchronous). Clears the group first, so call this
// before the async neighbor pass.
export const buildRegionLabel = (THREE, group, world, regionDepth, projection) => {
  clearLabel(group)
  const ref = world.region?.ref
  if (!ref) return
  addName(THREE, group, world.region?.name || displayName(ref), STAGE_W / 2, regionDepth, projection)
}

// (Re)build the left/right NEIGHBOR names, each in its own sky band at the ±STAGE_W offset and its own
// depth. Async (neighbor depth fetch); `token.stale` drops a build superseded by a region change.
export const buildNeighborLabels = async (THREE, group, world, regionDepth, projection, token, camera) => {
  const neighbors = world.region?.neighbors
  if (!neighbors) return
  const orient = world.region?.orientation ?? 0
  // At wall depth the current region fills the middle ~2/3 of the frame and each neighbor shows only in
  // a thin outer margin. Centering a name over the neighbor's CENTER lands it off-screen, so anchor it
  // just inside the shared edge (into the neighbor) — it renders leaning toward that side in the margin.
  const EDGE_INSET = STAGE_W * 0.13
  const MARGIN_W = STAGE_W * 0.28 // cap side-name width so it stays in the margin
  const LIFT = 14                 // raise the names off the wall top into the band above it
  const EXIT_H = 8                // small exit-name height (matches the down name at the near plane)
  const camZ = camera?.position?.z || 300 // depth-compensate side names so they match down's visual size
  const aspect = camera?.aspect || 1
  const wallZ = regionDepth * projection.depthScale
  const wallH = STAGE_H - regionDepth
  // Slant each name to the TOP edge of that side's region-selection wedge — the line from the screen's
  // top corner to the wall-top corner (WL/WR), i.e. the "upper limit of the next-region area". This is
  // shallower than the floor's side edge and reads as attached to that side. A perspective camera's
  // world→screen scale is isotropic, so rotation.z == this visual angle directly.
  const paneTopRoll = (side) => {
    if (!camera) return 0
    const edgeX = side === "left" ? 0 : STAGE_W
    const cornerX = side === "left" ? -1 : 1 // NDC x of the screen's top corner on that side
    const w = new THREE.Vector3(edgeX, wallH, -wallZ).project(camera)
    let a = Math.atan2(w.y - 1, (w.x - cornerX) * aspect)
    if (a > Math.PI / 2) a -= Math.PI      // normalize the (undirected) line to [-90°, 90°]
    else if (a < -Math.PI / 2) a += Math.PI
    return a
  }
  for (const side of ["left", "right"]) {
    const ref = sideNeighborRef(neighbors, orient, side)
    if (!ref) continue
    const meta = await neighborMeta(ref)
    if (token.stale) return // region changed mid-fetch → abandon
    const nDepth = meta?.depth ?? regionDepth
    const centerX = side === "left" ? -EDGE_INSET : STAGE_W + EDGE_INSET
    // Drop the side names ONTO the neighbor's wall (its top is at STAGE_H − nDepth) rather than the sky
    // band above it, and slant them to the floor-seam diagonal so they read as attached to that side.
    // Size to match the down name visually: EXIT_H is at the near plane, so scale up by the depth ratio.
    const worldH = EXIT_H * (camZ + nDepth * projection.depthScale) / camZ
    addName(THREE, group, exitName(ref), centerX, nDepth, projection,
      { maxW: MARGIN_W, yTop: STAGE_H - nDepth - 2 + LIFT, roll: paneTopRoll(side), worldH })
  }
  // Down (front): no wall to attach to — a horizontal name in the foreground band, centered above the
  // ▼ exit chevron (mirror of the current region's top-center name). Placed just in front of the near
  // floor edge (small +z toward the camera) so it lands in the bottom band, face-on (no roll).
  const downRef = sideNeighborRef(neighbors, orient, "down")
  if (downRef && !token.stale) {
    const worldH = EXIT_H
    const mesh = mkTextMesh(THREE, exitName(downRef), worldH)
    const worldW = worldH * mesh.userData.aspect
    const maxW = STAGE_W * 0.5
    if (worldW > maxW) mesh.scale.setScalar(maxW / worldW)
    mesh.position.set(STAGE_W / 2, -5, 0)
    group.add(mesh)
  }
}
