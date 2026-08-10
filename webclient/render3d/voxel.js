// voxel.js — recover a SOLID from Habitat's multi-view cel art (shape-from-silhouette).
//
// Props were drawn once, so they stay billboards. Avatars and heads were drawn THREE times —
// side, front, back (the fourth view is the mirrored side; the C64's left-facing avatar *is* the
// right-facing art flipped, paint.m). Three orthographic silhouettes 90° apart are exactly the
// input a visual hull wants, so the volume here is *recovered from the art*, not invented.
//
// PER-PART, NEVER PER-FIGURE. Intersecting whole-body silhouettes produces the classic visual-hull
// phantom: the arm's depth gets applied at the torso's width, and the figure fattens into a slab.
// Habitat hands us the decomposition for free — the art is already per-limb (animate.m paints six
// independent cels), so each limb is hulled in isolation and placed afterwards by the C64 limb
// chain. Callers (avatarvox.js) do the placing; this module only knows about one part at a time.
//
// ── Units ────────────────────────────────────────────────────────────────────────────────────
// Everything here is in NATIVE C64 MULTICOLOR PIXELS, not world units. A cel byte is 4 multicolor
// pixels (codec.js drawByte) while render.js canvasForSpace is (maxX-minX)*8 wide, so one native
// pixel is 2 world units across and 1 tall. Keeping the grid native makes it small and the math
// integral; the (2,1,2) world scale is applied once, at mesh time, in facesFromVoxels.
//
// Y IS UP and y=0 is the bottom row — the opposite of ImageData. Callers convert when they build
// layers, so every function below can treat the body frame as ordinary y-up geometry.
//
// ── Why the back view only colors, never carves ──────────────────────────────────────────────
// A solid's shadow along +Z and along −Z is the SAME set — you cannot build one object whose front
// silhouette is `stand_front` and whose back silhouette is a different `stand_back`. Real objects
// obey this; hand-drawn 1986 cels do not. So the mask is front ∧ side, and the back art is used
// only to paint the −Z faces (resampled into the front's silhouette). That keeps the front and side
// renders exact — which is the fidelity bar — and spends the disagreement where it is least
// visible. `hullDiagnostics` reports how far the two views actually disagree.

// A VIEW LAYER: one orthographic silhouette, native pixels, y-up.
//   w, h   size in native px / rows
//   x0, y0 box origin in the shared body frame (y0 = the BOTTOM row)
//   data   Uint32Array(w*h), ImageData packing (little-endian 0xAABBGGRR); 0 = transparent
// Row r of `data` is body row y0+r.
export const makeLayer = (w, h, x0, y0, data) => ({ w, h, x0, y0, data })

export const EMPTY_LAYER = makeLayer(0, 0, 0, 0, new Uint32Array(0))

// Sample a layer in BODY coordinates. Outside the box reads as transparent, so callers never
// have to bounds-check against a part whose views cover different boxes.
export const layerAt = (layer, x, y) => {
    if (!layer || layer.w === 0) return 0
    const lx = x - layer.x0
    const ly = y - layer.y0
    if (lx < 0 || ly < 0 || lx >= layer.w || ly >= layer.h) return 0
    return layer.data[ly * layer.w + lx]
}

const isOpaque = (px) => (px >>> 24) !== 0

// Horizontal extent of one row, in BODY x. null when the row is empty.
export const rowExtent = (layer, y) => {
    if (!layer || layer.w === 0) return null
    const ly = y - layer.y0
    if (ly < 0 || ly >= layer.h) return null
    const base = ly * layer.w
    let min = -1, max = -1
    for (let lx = 0; lx < layer.w; lx++) {
        if (isOpaque(layer.data[base + lx])) {
            if (min < 0) min = lx
            max = lx
        }
    }
    return min < 0 ? null : { min: min + layer.x0, max: max + layer.x0 }
}

// Bounding box of the opaque pixels, in BODY coordinates. null when the layer is blank.
export const bboxOf = (layer) => {
    if (!layer || layer.w === 0) return null
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let ly = 0; ly < layer.h; ly++) {
        const ext = rowExtent(layer, ly + layer.y0)
        if (!ext) continue
        if (ext.min < minX) minX = ext.min
        if (ext.max > maxX) maxX = ext.max
        const y = ly + layer.y0
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }
    return minX === Infinity ? null : { minX, maxX, minY, maxY }
}

// Mirror a layer left-for-right about a body-x axis. Used on the back view: looking at someone's
// back, their right hand is on your left, so back art must be flipped into the body frame before
// it can color the −Z faces. The axis is the FRONT silhouette's own center (see mirrorAxisFor),
// which self-corrects for art whose front and back cels sit at different xOffsets.
export const mirrorLayerAbout = (layer, axis) => {
    if (!layer || layer.w === 0) return layer
    const out = new Uint32Array(layer.w * layer.h)
    for (let ly = 0; ly < layer.h; ly++) {
        for (let lx = 0; lx < layer.w; lx++) {
            out[ly * layer.w + (layer.w - 1 - lx)] = layer.data[ly * layer.w + lx]
        }
    }
    // A pixel at body x lands at 2*axis - x; the box's left edge is the old right edge's image.
    const newX0 = Math.round(2 * axis) - (layer.x0 + layer.w - 1)
    return makeLayer(layer.w, layer.h, newX0, layer.y0, out)
}

// The mirror axis for the back view: the horizontal center of the FRONT silhouette. Using the
// chain origin (x=0) instead would be off by a couple of pixels — the human legs cel sits at
// xOffset −2 bytes, so its silhouette centers near native x 2, not 0.
export const mirrorAxisFor = (front) => {
    const bb = bboxOf(front)
    return bb ? (bb.minX + bb.maxX) / 2 : 0
}

// Per-row side profile with CLAMPING. Where a row has content in the front view but none in the
// side view, reuse the nearest non-empty side row instead of intersecting the part away. The human
// right arm needs this: its side cel spans body rows 15–43 while the front cel spans only 21–41,
// and a straight AND would amputate the shoulder. `clamped` counts the substituted rows — that
// number is a direct measure of how much the two views disagree, which is worth watching.
// Returns, per body row, the SOURCE ROW of the side art to read the depth profile from. Clamped
// rows point at a neighbour, and every later read — the occupancy test and the ±X face color —
// must go through this map. (Returning only a min/max extent is not enough: the mask still has to
// be sampled somewhere, and sampling the empty row carves the part away again.)
//
// ── the two views disagree about how tall a limb is ──
// Measured on the human at stand, the side cels run 2–8 rows taller than the front cels every
// time: legs y0..28 vs y0..24, torso y24..44 vs y21..40, arm y14..42 vs y19..39. Nothing is
// broken — they were drawn by hand, separately, in 1986, and the side figure is simply a little
// taller. A solid has ONE height per limb, so one view has to lose. The front wins, because it is
// the (x,y) mask and because it is the only view that shows both arms.
//
// That leaves a choice of how to read the side art across the front's rows:
//
//   "absolute"     — read row y from row y, and clamp beyond the side cel's own span. The overlap
//                    stays 1:1, so the hand and foot profiles land at the height they were drawn.
//   "proportional" — read row y at the same FRACTION of the side cel's span, stretching it to fit.
//                    Nothing is clipped, but every row is distorted.
//
// Proportional sounds better and measures worse — consistently about twice the side-view error
// (stand 86 px vs 53; walk 227 vs 118; sit 124 vs 51), because stretching moves every row while
// clamping only affects the few rows that do not overlap. Absolute is the default on that evidence.
// The knob stays because the choice is a judgement about art, and it belongs in the lab where it
// can be looked at.
const sideProfileRows = (side, yMin, yMax, mapping = "absolute") => {
    const n = yMax - yMin + 1
    const rows = new Array(n).fill(null)
    const srcY = new Int32Array(n)
    let clamped = 0
    const sbb = mapping === "proportional" ? bboxOf(side) : null
    const mapRow = (y) => {
        if (!sbb || n <= 1 || sbb.maxY === sbb.minY) return y
        const t = (y - yMin) / (n - 1)
        return Math.round(sbb.minY + t * (sbb.maxY - sbb.minY))
    }
    for (let y = yMin; y <= yMax; y++) {
        const sy = mapRow(y)
        rows[y - yMin] = rowExtent(side, sy)
        srcY[y - yMin] = sy
    }
    // Nearest non-empty row, searching outward. Rows outside the side art's own span clamp to its
    // first/last row; interior gaps (a cel with a transparent scanline) clamp to whichever side is
    // closer, which keeps a waist from punching a hole through the figure.
    for (let i = 0; i < n; i++) {
        if (rows[i]) continue
        let lo = i - 1, hi = i + 1
        while (lo >= 0 && !rows[lo]) lo--
        while (hi < n && !rows[hi]) hi++
        const pick = lo < 0 ? hi : hi >= n ? lo : (i - lo <= hi - i ? lo : hi)
        if (pick < 0 || pick >= n || !rows[pick]) continue
        rows[i] = rows[pick]
        srcY[i] = srcY[pick]   // the neighbour's SOURCE row, which under proportional mapping is not pick+yMin
        clamped++
    }
    return { rows, srcY, clamped }
}

const idx = (grid, x, y, z) =>
    ((y - grid.y0) * grid.nz + (z - grid.z0)) * grid.nx + (x - grid.x0)

export const occupiedAt = (grid, x, y, z) => {
    if (x < grid.x0 || y < grid.y0 || z < grid.z0) return 0
    if (x >= grid.x0 + grid.nx || y >= grid.y0 + grid.ny || z >= grid.z0 + grid.nz) return 0
    return grid.occ[idx(grid, x, y, z)]
}

/**
 * Build one part's solid from its three views.
 *
 *   solid(x,y,z) ⟺ front(x,y) ∧ side′(z,y) ∧ envelope(x,y,z)
 *
 *   envelope: |z − zc(y)| ≤ zhalf(y) · sqrt(1 − r · ((x − xc(y)) / xhalf(y))²)
 *
 * `roundness` r ∈ [0,1] tapers the depth toward the silhouette's left and right edges. r=0 is the
 * strict visual hull — correct, but boxy: the human legs are 20 native px across in front and 16
 * deep in side (feet pointing forward), so the ankles become a 20×16 brick. r=1 gives elliptical
 * cross-sections. The mask AND is applied FIRST, so rounding never fills the gap between the legs.
 *
 * The envelope can starve a column at the extreme edges (zhalf → 0 where the only surviving z has
 * no side coverage), which would punch holes in the front silhouette. `keepThinnestColumn` restores
 * the single z nearest the profile center in that case, so the +Z projection is exactly `front`.
 */
export const hullFromViews = ({ front, side, back }, options = {}) => {
    const { roundness = 0.6, keepThinnestColumn = true, rowMapping = "absolute", minHalfDepth = 0.5 } = options
    const fbb = bboxOf(front)
    const sbb = bboxOf(side)
    if (!fbb || !sbb) {
        return {
            nx: 0, ny: 0, nz: 0, x0: 0, y0: 0, z0: 0,
            occ: new Uint8Array(0), sideRowSrc: new Int32Array(0),
            views: { front: front ?? EMPTY_LAYER, side: side ?? EMPTY_LAYER, back: EMPTY_LAYER },
            diagnostics: { clampedRows: 0, starvedColumns: 0, voxels: 0 },
        }
    }

    // The grid spans the FRONT silhouette in x/y and the SIDE silhouette in z. The side view's
    // horizontal axis IS depth: how far forward or back the limb sits (avatarvox.js gets the same
    // fact from the side limb chain's cx, which is why the two agree).
    const x0 = fbb.minX, nx = fbb.maxX - fbb.minX + 1
    const y0 = fbb.minY, ny = fbb.maxY - fbb.minY + 1
    const z0 = sbb.minX, nz = sbb.maxX - sbb.minX + 1

    const { rows: sideRows, srcY: sideRowSrc, clamped: clampedRows } =
        sideProfileRows(side, y0, y0 + ny - 1, rowMapping)
    const occ = new Uint8Array(nx * ny * nz)
    const grid = { nx, ny, nz, x0, y0, z0, occ, sideRowSrc }

    let starvedColumns = 0
    let voxels = 0
    for (let y = y0; y < y0 + ny; y++) {
        const fExt = rowExtent(front, y)
        const sExt = sideRows[y - y0]
        if (!fExt || !sExt) continue
        const sy = sideRowSrc[y - y0]
        const xc = (fExt.min + fExt.max) / 2
        const xhalf = Math.max((fExt.max - fExt.min) / 2, 0.5)
        const zc = (sExt.min + sExt.max) / 2
        const zhalf = (sExt.max - sExt.min) / 2

        for (let x = fExt.min; x <= fExt.max; x++) {
            if (!isOpaque(layerAt(front, x, y))) continue
            const t = (x - xc) / xhalf
            const shrink = Math.sqrt(Math.max(0, 1 - roundness * t * t))
            // Floor the taper so a column never collapses to nothing. Without it, high roundness
            // leaves the silhouette's edges as isolated single voxels chosen one at a time by the
            // starved-column guard, and a limb's rim breaks up into loose specks.
            const limit = Math.max(zhalf * shrink, minHalfDepth)
            let filled = 0
            for (let z = sExt.min; z <= sExt.max; z++) {
                if (!isOpaque(layerAt(side, z, sy))) continue
                if (Math.abs(z - zc) > limit + 1e-9) continue
                occ[idx(grid, x, y, z)] = 1
                filled++
            }
            if (filled === 0 && keepThinnestColumn) {
                // Restore the z closest to the profile center that the side art actually covers,
                // so this front pixel still exists in the solid. NOTE the null sentinel: z is a
                // body-frame coordinate and is very often NEGATIVE (limbs sit behind the chain
                // origin), so a `best >= 0` test would silently discard the fix and drop the
                // column — which is exactly how the Spider's stub limbs went missing.
                let best = null, bestD = Infinity
                for (let z = sExt.min; z <= sExt.max; z++) {
                    if (!isOpaque(layerAt(side, z, sy))) continue
                    const d = Math.abs(z - zc)
                    if (d < bestD) { bestD = d; best = z }
                }
                if (best !== null) { occ[idx(grid, x, y, best)] = 1; filled = 1; starvedColumns++ }
            }
            voxels += filled
        }
    }

    const backM = back && back.w > 0 ? mirrorLayerAbout(back, mirrorAxisFor(front)) : EMPTY_LAYER
    return {
        nx, ny, nz, x0, y0, z0, occ, sideRowSrc,
        views: { front, side, back: backM },
        diagnostics: { clampedRows, starvedColumns, voxels },
    }
}

// Face color for an exposed voxel face. Each face wears the art of the view that looks straight at
// it: +Z the front cel, −Z the back cel, ±X the side cel (BOTH sides share the side art — that is
// ground truth, the C64 never drew a distinct left view). Top and bottom take the front, which is
// what the diorama's slightly-elevated camera mostly grazes. No lighting term: the 1986 artists
// already painted the shading differences between the views, and a lambert on top of that reads as
// mud. Transparent samples fall back so a face is never left with a hole.
const faceColor = (grid, x, y, z, nxAxis) => {
    const { front, side, back } = grid.views
    // ±X faces read the side art through the clamp map — the same substituted row the occupancy
    // used. Reading the raw row would leave clamped rows uncolored.
    const sy = grid.sideRowSrc?.[y - grid.y0] ?? y
    let c = 0
    if (nxAxis === 2) c = layerAt(front, x, y)                      // +Z
    else if (nxAxis === 3) c = layerAt(back, x, y)                  // −Z
    else if (nxAxis === 0 || nxAxis === 1) c = layerAt(side, z, sy)  // ±X
    else c = layerAt(front, x, y)                                    // ±Y
    if (!isOpaque(c)) c = layerAt(front, x, y)
    if (!isOpaque(c)) c = layerAt(side, z, sy)
    return c
}

// Face directions, indexed by the `nxAxis` code faceColor reads: 0 +X, 1 −X, 2 +Z, 3 −Z, 4 +Y, 5 −Y.
const FACES = [
    { code: 0, d: [1, 0, 0], n: [1, 0, 0] },
    { code: 1, d: [-1, 0, 0], n: [-1, 0, 0] },
    { code: 2, d: [0, 0, 1], n: [0, 0, 1] },
    { code: 3, d: [0, 0, -1], n: [0, 0, -1] },
    { code: 4, d: [0, 1, 0], n: [0, 1, 0] },
    { code: 5, d: [0, -1, 0], n: [0, -1, 0] },
]

// The four corners of a unit face, in the winding order that puts the outward normal on the front.
const FACE_CORNERS = [
    [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], // +X
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // −X
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // +Z
    [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // −Z
    [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], // +Y
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // −Y
]

/**
 * Exposed-face quads with vertex colors, ready for a BufferGeometry.
 *
 * One quad per exposed face — no greedy merging. An avatar comes out around 3–5k faces, which is
 * nothing for a GPU; merging runs of equal color is the optimization to reach for only once many
 * avatars share a region. Colors ride on the vertices, so there is no texture and no atlas, and
 * NearestFilter/mipmap concerns never arise.
 *
 * `scale` is where native pixels become world units: [2,1,2] by default, because a C64 multicolor
 * pixel is 2 world units wide and 1 tall (see the units note at the top). The voxels are therefore
 * deliberately non-cubic, and that is what makes an orthographic render at yaw 0 land pixel-for-
 * pixel on the 2D client's frame.
 */
export const facesFromVoxels = (grid, options = {}) => {
    const { scale = [2, 1, 2], origin = [0, 0, 0] } = options
    const [sx, sy, sz] = scale
    const positions = []
    const normals = []
    const colors = []
    const indices = []

    for (let y = grid.y0; y < grid.y0 + grid.ny; y++) {
        for (let z = grid.z0; z < grid.z0 + grid.nz; z++) {
            for (let x = grid.x0; x < grid.x0 + grid.nx; x++) {
                if (!occupiedAt(grid, x, y, z)) continue
                for (const face of FACES) {
                    const [dx, dy, dz] = face.d
                    if (occupiedAt(grid, x + dx, y + dy, z + dz)) continue
                    const c = faceColor(grid, x, y, z, face.code)
                    const r = (c & 0xff) / 255
                    const g = ((c >>> 8) & 0xff) / 255
                    const b = ((c >>> 16) & 0xff) / 255
                    const base = positions.length / 3
                    for (const [cx, cy, cz] of FACE_CORNERS[face.code]) {
                        positions.push(
                            origin[0] + (x + cx) * sx,
                            origin[1] + (y + cy) * sy,
                            origin[2] + (z + cz) * sz)
                        normals.push(face.n[0], face.n[1], face.n[2])
                        colors.push(r, g, b)
                    }
                    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
                }
            }
        }
    }
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        colors: new Float32Array(colors),
        indices: new Uint32Array(indices),
        faceCount: indices.length / 6,
    }
}

// Which axis each ortho view looks down, and how it maps the grid to a 2D layer.
// "+z" = the camera in front looking toward −Z, i.e. the FRONT view. This is the diorama's own
// convention (project.js: the scene recedes toward −Z with the camera at +Z).
const ORTHO = {
    "+z": { face: 2, uAxis: "x", vAxis: "y", depth: "z", dir: -1 },
    "-z": { face: 3, uAxis: "x", vAxis: "y", depth: "z", dir: +1, flipU: true },
    "+x": { face: 0, uAxis: "z", vAxis: "y", depth: "x", dir: -1, flipU: true },
    "-x": { face: 1, uAxis: "z", vAxis: "y", depth: "x", dir: +1 },
}

// Is this cardinal view a mirror of the art as drawn? (See the origin note in orthoRasterize.)
export const orthoIsMirrored = (axis) => !!ORTHO[axis]?.flipU

/**
 * Rasterize one part in BODY COORDINATES, with a depth buffer and no mirroring — the form a
 * multi-part figure can be merged in. `depth` is a signed key where SMALLER IS CLOSER to the
 * camera, so merging several parts is a plain per-pixel minimum.
 *
 * Kept separate from orthoRasterize because mirroring has to happen once, on the finished figure:
 * flipping each part about its own box would scatter the limbs.
 */
export const rasterizeWithDepth = (grid, axis = "+z") => {
    const spec = ORTHO[axis]
    if (!spec) throw new Error(`rasterizeWithDepth: unknown axis ${axis}`)
    if (grid.nx === 0) return { ...EMPTY_LAYER, depth: new Int32Array(0) }

    const dims = { x: { n: grid.nx, o: grid.x0 }, y: { n: grid.ny, o: grid.y0 }, z: { n: grid.nz, o: grid.z0 } }
    const u = dims[spec.uAxis], v = dims[spec.vAxis], d = dims[spec.depth]
    const data = new Uint32Array(u.n * v.n)
    const depth = new Int32Array(u.n * v.n).fill(0x7fffffff)

    for (let vi = 0; vi < v.n; vi++) {
        for (let ui = 0; ui < u.n; ui++) {
            // Walk from the camera inward; the first solid voxel wins (a depth test with no buffer).
            for (let k = 0; k < d.n; k++) {
                const di = spec.dir < 0 ? d.n - 1 - k : k
                const coord = { [spec.uAxis]: u.o + ui, [spec.vAxis]: v.o + vi, [spec.depth]: d.o + di }
                if (!occupiedAt(grid, coord.x, coord.y, coord.z)) continue
                data[vi * u.n + ui] = faceColor(grid, coord.x, coord.y, coord.z, spec.face)
                depth[vi * u.n + ui] = spec.dir * (d.o + di)
                break
            }
        }
    }
    return { ...makeLayer(u.n, v.n, u.o, v.o, data), depth }
}

// Flip a finished view left-for-right. Mirrored views report x0 = 0 — see orthoRasterize.
export const mirrorView = (layer) => {
    if (!layer || layer.w === 0) return layer
    const out = new Uint32Array(layer.w * layer.h)
    for (let r = 0; r < layer.h; r++) {
        for (let c = 0; c < layer.w; c++) out[r * layer.w + (layer.w - 1 - c)] = layer.data[r * layer.w + c]
    }
    return makeLayer(layer.w, layer.h, 0, layer.y0, out)
}

/**
 * Rasterize the solid orthographically along a cardinal axis, in native pixels — a pure software
 * renderer with no GL, so tests and the lab's diff overlay agree exactly and run in node.
 *
 * Returns a view layer (same shape as the inputs), which is what makes the fidelity check a plain
 * array comparison against the 2D compositor's own output.
 */
// Every cardinal view comes back in the orientation the art was DRAWN in, which is what makes a
// direct comparison against composeAvatarFrameAt possible:
//   "+z" → the front cel as drawn, origin = the front layer's own x0.
//   "-x" → the side cel as drawn, origin = the side layer's own x0 (grid z IS side-art x).
//   "-z" → the back cel as drawn: the grid stores the back MIRRORED into the body frame, and the
//          flip here mirrors it back out again.
//   "+x" → the mirrored side, i.e. a left-facing avatar (paint.m's flip).
// The two mirrored views have no meaningful body-frame origin — there is no single axis to mirror
// a *box* about that stays consistent across parts — so they report x0 = 0 and callers align them
// by content. The two un-mirrored views ("+z", "-x") are the ones the fidelity check asserts
// strictly, and they carry exact origins.
export const orthoRasterize = (grid, axis = "+z") => {
    const spec = ORTHO[axis]
    if (!spec) throw new Error(`orthoRasterize: unknown axis ${axis}`)
    if (grid.nx === 0) return EMPTY_LAYER
    const raw = rasterizeWithDepth(grid, axis)
    if (spec.flipU) return mirrorView(raw)
    return makeLayer(raw.w, raw.h, raw.x0, raw.y0, raw.data)
}

// Compare two view layers over their union box. `alphaOnly` answers the strict silhouette question;
// the color counts answer the softer "does it look right" one. Used by test-voxel.mjs and by the
// lab's diff overlay, so a mismatch you see on screen is the same number CI reports.
export const compareLayers = (a, b) => {
    const boxes = [a, b].filter((l) => l && l.w > 0)
    if (boxes.length === 0) return { total: 0, alphaMismatch: 0, colorMismatch: 0, mismatches: [] }
    const minX = Math.min(...boxes.map((l) => l.x0))
    const maxX = Math.max(...boxes.map((l) => l.x0 + l.w - 1))
    const minY = Math.min(...boxes.map((l) => l.y0))
    const maxY = Math.max(...boxes.map((l) => l.y0 + l.h - 1))
    let total = 0, alphaMismatch = 0, colorMismatch = 0
    const mismatches = []
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const pa = layerAt(a, x, y), pb = layerAt(b, x, y)
            const oa = isOpaque(pa), ob = isOpaque(pb)
            if (!oa && !ob) continue
            total++
            if (oa !== ob) {
                alphaMismatch++
                if (mismatches.length < 64) mismatches.push({ x, y, a: pa, b: pb })
            } else if ((pa & 0x00ffffff) !== (pb & 0x00ffffff)) {
                colorMismatch++
            }
        }
    }
    return { total, alphaMismatch, colorMismatch, mismatches }
}
