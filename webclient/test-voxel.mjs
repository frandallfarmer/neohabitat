// Node tests for the solid-avatar hull (render3d/voxel.js).
//
// voxel.js is deliberately pure — no canvas, no Three, no habirender — so the geometry that the
// whole solid-avatar experiment rests on can be checked here with plain arrays. The avatar-level
// fidelity check (the real cels, through the real compositor) needs preact and a canvas, so it
// lives in check-avatar3d.mjs and runs under playwright.
//
// The property that matters most is the FRONT PROJECTION IDENTITY: whatever the hull does with
// depth, its shadow along the camera axis must still be exactly the silhouette the 2D client draws.
// If that ever breaks, a "3D avatar" has quietly stopped being the same character.

import {
    makeLayer, EMPTY_LAYER, layerAt, rowExtent, bboxOf, mirrorLayerAbout, mirrorAxisFor,
    hullFromViews, facesFromVoxels, orthoRasterize, compareLayers, occupiedAt,
} from "./render3d/voxel.js"

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${a}, want ${b})`)

const RED = 0xff0000ff   // A=ff B=00 G=00 R=ff  (ImageData packing: R low byte)
const BLUE = 0xffff0000
const GREEN = 0xff00ff00

// Build a layer from a predicate, with an optional per-pixel color.
const mk = (w, h, x0, y0, fn, color = RED) => {
    const d = new Uint32Array(w * h)
    for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
            d[r * w + c] = fn(c + x0, r + y0) ? (typeof color === "function" ? color(c + x0, r + y0) : color) : 0
        }
    }
    return makeLayer(w, h, x0, y0, d)
}

// ── layer basics: body-coordinate sampling, extents, bbox ────────────────────────────────────
{
    const L = mk(4, 3, 10, 5, (x, y) => x >= 11 && x <= 12 && y >= 6)
    eq(layerAt(L, 11, 6), RED, "samples inside the box")
    eq(layerAt(L, 10, 5), 0, "transparent inside the box reads 0")
    eq(layerAt(L, 99, 99), 0, "outside the box reads transparent, not undefined")
    eq(rowExtent(L, 5), null, "an empty row has no extent")
    const e = rowExtent(L, 6)
    eq(e.min, 11, "row extent min is in body coords")
    eq(e.max, 12, "row extent max is in body coords")
    const bb = bboxOf(L)
    eq(bb.minX, 11, "bbox minX"); eq(bb.maxX, 12, "bbox maxX")
    eq(bb.minY, 6, "bbox minY"); eq(bb.maxY, 7, "bbox maxY")
    eq(bboxOf(EMPTY_LAYER), null, "an empty layer has no bbox")
}

// ── mirroring: the back view flips about the FRONT's center, not the chain origin ────────────
// Real cels are not centered on x=0 — the human legs sit at xOffset −2 bytes — so mirroring about
// the origin would slide the back art sideways relative to the front.
{
    const front = mk(6, 2, -2, 0, (x) => x >= -1 && x <= 3)
    eq(mirrorAxisFor(front), 1, "mirror axis is the front silhouette's center")
    const back = mk(4, 2, 0, 0, (x) => x === 0, BLUE)   // a single stripe at body x 0
    const m = mirrorLayerAbout(back, mirrorAxisFor(front))
    eq(layerAt(m, 2, 0), BLUE, "a stripe at x=0 mirrors to x=2 about axis 1")
    eq(layerAt(m, 0, 0), 0, "and no longer sits at x=0")
    eq(mirrorLayerAbout(EMPTY_LAYER, 0), EMPTY_LAYER, "mirroring an empty layer is a no-op")
}

// ── the core guarantee: the front projection IS the front silhouette ─────────────────────────
{
    // An awkward shape on purpose: a notched front, an off-center side profile with its own origin.
    const front = mk(7, 9, -3, 0, (x, y) => !(y >= 3 && y <= 5 && x >= -1 && x <= 0))
    const side = mk(5, 9, 4, 0, (z, y) => z !== 6 || y < 4)
    const back = mk(7, 9, -3, 0, () => true)
    for (const roundness of [0, 0.6, 1]) {
        const g = hullFromViews({ front, side, back }, { roundness })
        const cmp = compareLayers(orthoRasterize(g, "+z"), front)
        eq(cmp.alphaMismatch, 0, `front projection is exact at roundness=${roundness}`)
    }
}

// ── roundness tapers depth toward the silhouette edges, and never below one voxel ────────────
{
    const front = mk(9, 4, 0, 0, () => true)
    const side = mk(9, 4, 0, 0, () => true)
    const box = hullFromViews({ front, side, back: EMPTY_LAYER }, { roundness: 0 })
    const round = hullFromViews({ front, side, back: EMPTY_LAYER }, { roundness: 1 })
    eq(box.diagnostics.voxels, 9 * 4 * 9, "roundness 0 is the strict visual hull (a full box)")
    assert(round.diagnostics.voxels < box.diagnostics.voxels, "roundness 1 carves the corners away")
    // The centre column keeps full depth; the edge column keeps at least one voxel.
    let centre = 0, edge = 0
    for (let z = round.z0; z < round.z0 + round.nz; z++) {
        if (occupiedAt(round, 4, 0, z)) centre++
        if (occupiedAt(round, 0, 0, z)) edge++
    }
    eq(centre, 9, "the centre column keeps the full side profile")
    assert(edge >= 1, "an edge column is tapered but never erased")
    assert(edge < centre, "an edge column is thinner than the centre")
}

// ── negative body coordinates work exactly like positive ones ────────────────────────────────
// Limbs routinely sit behind the chain origin, so z is often negative. A `best >= 0` sentinel in
// the starved-column guard silently dropped those columns and made the Spider's stub limbs vanish.
{
    const front = mk(2, 1, -6, -24, () => true)
    const side = mk(2, 1, -14, -24, () => true)
    // minHalfDepth 0 removes the taper floor so the envelope really does starve these columns and
    // the guard has to run — otherwise the floor quietly satisfies the case and the regression this
    // test exists for (a `best >= 0` sentinel against negative z) would slip back in unnoticed.
    const g = hullFromViews({ front, side, back: EMPTY_LAYER }, { roundness: 0.6, minHalfDepth: 0 })
    assert(g.diagnostics.starvedColumns > 0, "this case exercises the starved-column guard")
    assert(g.diagnostics.voxels > 0, "a part at negative x/y/z still produces voxels")
    eq(compareLayers(orthoRasterize(g, "+z"), front).alphaMismatch, 0,
        "…and its front silhouette is still exact")

    // With the floor at its default, the same columns survive without needing the guard at all.
    const floored = hullFromViews({ front, side, back: EMPTY_LAYER }, { roundness: 0.6 })
    eq(floored.diagnostics.starvedColumns, 0, "the taper floor keeps thin columns from starving")
    eq(compareLayers(orthoRasterize(floored, "+z"), front).alphaMismatch, 0,
        "…and the front silhouette is exact either way")
}

// ── row clamping: a row missing from one view must not amputate the part ─────────────────────
// The human right arm needs exactly this — its side cel spans more rows than its front cel.
{
    const front = mk(6, 8, -2, 0, () => true)
    const side = mk(4, 8, 3, 0, (z, y) => y !== 5)      // row 5 blank in the side view only
    const g = hullFromViews({ front, side, back: EMPTY_LAYER }, { roundness: 0 })
    eq(g.diagnostics.clampedRows, 1, "the missing side row is reported as clamped")
    eq(compareLayers(orthoRasterize(g, "+z"), front).alphaMismatch, 0,
        "the clamped row survives — the front silhouette is still complete")
    // And the substituted row is honestly visible in the side projection: it is EXTRA content the
    // side art never had. That difference is a measurement of how far the two views disagree.
    const sideDiff = compareLayers(orthoRasterize(g, "-x"), side)
    eq(sideDiff.alphaMismatch, 4, "the clamped row shows up as extra pixels in the side view")
}

// ── cardinal views come back in the orientation the art was DRAWN in ─────────────────────────
// This is what lets check-avatar3d.mjs compare a render straight against composeAvatarFrameAt.
{
    const front = mk(4, 3, 0, 0, () => true, (x) => x === 0 ? RED : BLUE)
    const side = mk(3, 3, 5, 0, () => true, (z) => z === 5 ? GREEN : BLUE)
    const g = hullFromViews({ front, side, back: EMPTY_LAYER }, { roundness: 0 })

    const fz = orthoRasterize(g, "+z")
    eq(fz.x0, 0, '"+z" keeps the front layer\'s own origin')
    eq(layerAt(fz, 0, 0), RED, '"+z" is the front art unmirrored')

    const sx = orthoRasterize(g, "-x")
    eq(sx.x0, 5, '"-x" keeps the side layer\'s own origin (grid z IS side-art x)')
    eq(layerAt(sx, 5, 0), GREEN, '"-x" is the side art unmirrored')

    const px = orthoRasterize(g, "+x")
    eq(px.x0, 0, '"+x" is mirrored so it reports no body-frame origin')
    eq(layerAt(px, px.w - 1, 0), GREEN, '"+x" is the side art mirrored (a left-facing avatar)')
}

// ── the back view colors the far faces but never carves the shape ────────────────────────────
// A solid's shadow is the same along +Z and −Z, so front and back silhouettes cannot both be
// honoured. The back is therefore a paint job, and a back cel SMALLER than the front must not
// shrink the solid.
{
    const front = mk(6, 4, 0, 0, () => true)
    const side = mk(3, 4, 0, 0, () => true)
    const back = mk(2, 4, 2, 0, () => true, BLUE)   // much narrower than the front
    const g = hullFromViews({ front, side, back }, { roundness: 0 })
    eq(compareLayers(orthoRasterize(g, "+z"), front).alphaMismatch, 0,
        "a narrow back cel does not carve the solid")
    const bz = orthoRasterize(g, "-z")
    let blue = 0
    for (const px of bz.data) if (px === BLUE) blue++
    assert(blue > 0, "the back art is painted onto the far faces")
}

// ── degenerate inputs return an empty grid instead of throwing ───────────────────────────────
{
    const front = mk(4, 4, 0, 0, () => true)
    for (const [label, views] of [
        ["no side view", { front, side: EMPTY_LAYER, back: EMPTY_LAYER }],
        ["no front view", { front: EMPTY_LAYER, side: front, back: EMPTY_LAYER }],
        ["all blank", { front: EMPTY_LAYER, side: EMPTY_LAYER, back: EMPTY_LAYER }],
        ["fully transparent front", { front: mk(4, 4, 0, 0, () => false), side: front, back: EMPTY_LAYER }],
    ]) {
        const g = hullFromViews(views, {})
        eq(g.diagnostics.voxels, 0, `${label}: empty hull`)
        eq(g.nx, 0, `${label}: empty grid`)
        eq(orthoRasterize(g, "+z"), EMPTY_LAYER, `${label}: rasterizes to nothing`)
        eq(facesFromVoxels(g).faceCount, 0, `${label}: no faces`)
    }
}

// ── mesh: exposed faces only, with the (2,1,2) native-pixel-to-world scale ───────────────────
{
    const front = mk(3, 5, 0, 0, () => true)
    const side = mk(2, 5, 0, 0, () => true)
    const g = hullFromViews({ front, side, back: EMPTY_LAYER }, { roundness: 0 })
    const m = facesFromVoxels(g)
    // A solid 3×5×2 box: only the shell is emitted, interior faces are skipped.
    eq(m.faceCount, 2 * (3 * 5 + 3 * 2 + 5 * 2), "one quad per exposed face, none inside")
    eq(m.indices.length, m.faceCount * 6, "two triangles per quad")
    eq(m.positions.length, m.faceCount * 4 * 3, "four verts per quad")
    eq(m.colors.length, m.positions.length, "a colour per vertex")

    const xs = [], ys = [], zs = []
    for (let i = 0; i < m.positions.length; i += 3) {
        xs.push(m.positions[i]); ys.push(m.positions[i + 1]); zs.push(m.positions[i + 2])
    }
    // A C64 multicolor pixel is 2 world units wide and 1 tall, so voxels are deliberately
    // non-cubic — that is what makes an orthographic render land on the 2D client's pixel grid.
    eq(Math.max(...xs), 3 * 2, "x spans native px × 2 world units")
    eq(Math.max(...ys), 5 * 1, "y spans rows × 1 world unit")
    eq(Math.max(...zs), 2 * 2, "z spans native px × 2 world units")
}

// ── compareLayers reports alpha and colour separately ────────────────────────────────────────
{
    const a = mk(3, 1, 0, 0, () => true, RED)
    const b = mk(3, 1, 0, 0, (x) => x < 2, BLUE)
    const c = compareLayers(a, b)
    eq(c.total, 3, "the union of opaque pixels")
    eq(c.alphaMismatch, 1, "one pixel present in a but not b")
    eq(c.colorMismatch, 2, "two overlapping pixels differ in colour")
    eq(compareLayers(a, a).total, 3, "a layer matches itself")
    eq(compareLayers(a, a).alphaMismatch, 0, "…with no alpha mismatch")
    eq(compareLayers(a, a).colorMismatch, 0, "…and no colour mismatch")
}

console.log("test-voxel: ok")
