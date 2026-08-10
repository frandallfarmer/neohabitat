// avatarvox.js — assemble a whole Habitat figure as solids, one hull per limb.
//
// voxel.js knows how to turn three silhouettes into a solid. This module knows where Habitat's
// three silhouettes come from and how they line up: it drives the existing, C64-verified decode and
// limb-chain code in habirender/ and hands voxel.js registered view layers.
//
// THE REGISTRATION TRICK. `region.js avatarLimbChainAt` already computes cx[]/cy[] — every limb's
// origin for a given action, exactly as animate.m does it. Run it three times, once per view:
//
//     stand        → cx gives each limb's DEPTH (its position along the side view's horizontal axis)
//     stand_front  → cx gives each limb's left/right position, cy its height
//     stand_back   → the back cel, for coloring the far faces
//
// A limb's horizontal position in the side view *is* how far forward or back it sits. So the third
// coordinate is not estimated or hand-tuned; it is read out of the same chain the 2D client uses.
// Nothing here re-derives geometry, which is the point — [[c64-is-ground-truth]] applies, and the
// chain is already the ported animate.m.
//
// COORDINATE SPACES. habirender frames are y-UP with x in BYTES (8 world units, 4 native pixels)
// and y in rows (render.js translateSpace comment). voxel.js wants native pixels, y-up, bottom row
// first. `layerFromFrame` is the whole conversion, and it is the only place the two meet.

import {
    avatarLimbChainAt, initAnimationsForAction, limbPatternsFromMod,
    AVATAR_HEAD_LIFT, AVATAR_HAND, colorsFromMod, headPatternFromMod,
} from "../habirender/region.js"
import { frameFromCels, celsFromMask, translateSpace } from "../habirender/render.js"
import { animationsAtStart, advanceAnimations } from "../habirender/chore-frames.js"
import { shouldPaintFacePlate } from "../habirender/face-plate.js"
import {
    makeLayer, EMPTY_LAYER, hullFromViews, facesFromVoxels,
    rasterizeWithDepth, mirrorView, orthoIsMirrored,
} from "./voxel.js"

// A pose is a TRIPLE of chore names — one per view. Only these three poses have art in all three
// directions: choreographyActions pairs facings for stand, walk and sit only. Everything else
// (wave, point, bend_over, throw, punch, …) is SIDE-ONLY in the 1986 art, so there is no third
// silhouette to hull and a rotating solid of a wave would be invention, not restoration.
// `back: null` means "reuse the front cel for the far faces" — sit was never drawn from behind.
export const POSE_TRIPLES = {
    stand: { side: "stand", front: "stand_front", back: "stand_back" },
    walk: { side: "walk", front: "walk_front", back: "walk_back" },
    sit: { side: "sit_chair", front: "sit_front", back: null },
}

// Poses with no front/back art at all. The lab offers them side-locked (billboard-style) rather
// than pretending they can rotate.
export const isRotatablePose = (poseName) => Object.hasOwn(POSE_TRIPLES, poseName)

const VIEW_FACING = { side: 0, front: 1, back: 3 } // headProp.animations index (headFacingFromAction)

/**
 * Convert one habirender frame (RGBA canvas + y-up byte/row space) into a voxel.js view layer
 * (native pixels, y-up, bottom row first).
 *
 * canvasFromBitmap doubles every native pixel horizontally (putpixel writes two RGBA quads), so
 * sampling canvas column c*2 recovers the native pixel exactly — no filtering, no averaging.
 * Bytes are recombined with explicit shifts rather than a Uint32Array view so the packing does not
 * depend on the host's endianness.
 */
export const layerFromFrame = (frame) => {
    if (!frame || !frame.canvas) return EMPTY_LAYER
    const canvas = frame.canvas
    const w = (frame.maxX - frame.minX) * 4      // native px
    const h = frame.maxY - frame.minY            // rows
    if (w <= 0 || h <= 0) return EMPTY_LAYER
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const src = img.data
    const data = new Uint32Array(w * h)
    for (let r = 0; r < h; r++) {
        const canvasRow = h - 1 - r              // canvas is top-down, the body frame is y-up
        for (let c = 0; c < w; c++) {
            const i = (canvasRow * canvas.width + c * 2) * 4
            data[r * w + c] =
                src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)
        }
    }
    return makeLayer(w, h, frame.minX * 4, frame.minY, data)
}

// The limb chain for one view at one frame of its cycle. Mirrors composeAvatarFrameAt's stepping so
// the solid is built from exactly the cels the 2D client would paint.
const chainForView = (body, avatarMod, actionName, frameIndex) => {
    const animations = initAnimationsForAction(body, actionName, null)
    if (!animations) return null
    const scratch = animationsAtStart(animations)
    for (let i = 0; i < frameIndex; i++) advanceAnimations(scratch)
    return avatarLimbChainAt(body, scratch, avatarMod, actionName)
}

// How many frames one view's cycle runs for.
const cycleLength = (body, actionName) => {
    const animations = initAnimationsForAction(body, actionName, null)
    if (!animations) return 0
    const scratch = animationsAtStart(animations)
    let n = 0
    while (true) { n++; if (advanceAnimations(scratch) === scratch.length) break }
    return n
}

// The side walk runs 7 frames and the front/back walk only 3 — the views were animated
// independently in 1986 and never meant to be played in lockstep. Phase-normalize instead of
// assuming a 1:1 correspondence: the side cycle is the clock, the others are sampled from it.
const mapFrame = (frameIndex, fromLen, toLen) =>
    (fromLen <= 0 || toLen <= 0) ? 0 : Math.floor((frameIndex % fromLen) * toLen / fromLen) % toLen

// animate.m walk paint offset, gated to the human body exactly as composeAvatarFrame gates it.
const walkPaintYFor = (actionName, avatarMod, chain) => {
    const isWalk = actionName === "walk" || actionName === "walk_front" || actionName === "walk_back"
    return (isWalk && (avatarMod.style ?? 0) === 0) ? -(chain.cels[0]?.yRel ?? 0) : 0
}

/**
 * Build every part of a figure as an independent solid.
 *
 * Returns `[{ name, grid, diagnostics }]`. Every grid is already in the SHARED body frame (native
 * px in x/z, rows in y), so `facesFromVoxels(grid, {scale:[2,1,2]})` puts all the parts in one
 * world space with no per-part origin — world x = byte*8 and world y = row, matching the 2D client.
 *
 * `headProp` may be null, and is skipped entirely when the body is headless
 * (headCelNumber 255 — every non-human style except Spid, see [[webclient-avatar-rendering]]).
 */
export const buildFigureParts = (body, avatarMod, headProp, headMod, options = {}) => {
    // Roundness is PER PART, because heads and limbs want different answers. A head hull is close
    // to a cube (head0 is 12 wide × 26 tall × 16 deep — the side cel includes the nose and hair
    // profile), and a cube wearing the front cel on one facet and the profile cel on the next reads
    // at 45° as TWO FLAT PORTRAITS meeting at an edge. Rounding the head hard turns that into a
    // single 3/4 view. Limbs are genuinely slab-like and look right much boxier.
    const { pose = "stand", frameIndex = 0, rowMapping = "absolute" } = options
    const roundness = typeof options.roundness === "number"
        ? { limb: options.roundness, head: options.roundness }
        : { limb: 0.45, head: 1, ...(options.roundness ?? {}) }
    const triple = POSE_TRIPLES[pose]
    if (!triple) throw new Error(`buildFigureParts: pose "${pose}" has no three-view art`)

    const limbPatterns = limbPatternsFromMod(avatarMod)
    const lens = {
        side: cycleLength(body, triple.side),
        front: cycleLength(body, triple.front),
        back: triple.back ? cycleLength(body, triple.back) : 0,
    }
    // The side cycle is the clock (it is the longest and the one the client animates against).
    const frames = {
        side: lens.side ? frameIndex % lens.side : 0,
        front: mapFrame(frameIndex, lens.side, lens.front),
        back: triple.back ? mapFrame(frameIndex, lens.side, lens.back) : 0,
    }

    const views = {}
    for (const view of ["side", "front", "back"]) {
        const actionName = view === "back" ? (triple.back ?? triple.front) : triple[view]
        const chain = chainForView(body, avatarMod, actionName, frames[view])
        if (!chain) continue
        views[view] = { actionName, chain, walkPaintY: walkPaintYFor(actionName, avatarMod, chain) }
    }
    if (!views.front || !views.side) return []

    const layerForLimb = (view, i) => {
        const v = views[view]
        if (!v) return EMPTY_LAYER
        const cel = v.chain.cels[i]
        if (!cel) return EMPTY_LAYER
        const pattern = limbPatterns[body.limbs[i].pattern]
        const frame = frameFromCels([cel], { colors: { pattern }, firstCelOrigin: false })
        if (!frame) return EMPTY_LAYER
        // Limb 0 (legs) is the chain root and takes no walk offset, matching composeAvatarFrame.
        const dy = v.chain.cy[i] + (i === 0 ? 0 : v.walkPaintY)
        return layerFromFrame(translateSpace(frame, v.chain.cx[i], dy))
    }

    // THE FAR LIMB HAS NO SIDE ART. Seen from the side, the human's left arm is hidden behind the
    // body, so animate.m simply does not draw it: at stand, limb 2's side cel is null while its
    // front cel is a full 12×20 arm. A straight hull drops the limb and the front view loses a
    // whole arm (54 px, the first thing the fidelity check caught).
    //
    // The fix is the one the art itself justifies: borrow the depth profile of the limb's MIRROR
    // PARTNER — the limb sharing its pattern class (body byte 21+i: LEG/LEG/ARM/TORSO/FACE/ARM).
    // Two arms are the same thickness and hang at the same depth; they differ only in x, which the
    // front view already supplies. So this invents nothing: it reuses the one silhouette Habitat
    // drew for "an arm, from the side".
    const sideFallback = (i) => {
        const own = layerForLimb("side", i)
        if (own.w > 0) return own
        const cls = body.limbs[i]?.pattern
        if (cls == null) return own
        for (let j = 0; j < body.limbs.length; j++) {
            if (j === i || body.limbs[j]?.pattern !== cls) continue
            const partner = layerForLimb("side", j)
            if (partner.w > 0) return partner
        }
        return own
    }

    const parts = []
    const pushPart = (name, front, side, back, kind = "limb") => {
        if (!front || front.w === 0 || !side || side.w === 0) return
        const grid = hullFromViews({ front, side, back: back ?? EMPTY_LAYER },
            { roundness: roundness[kind] ?? roundness.limb, rowMapping })
        if (grid.diagnostics.voxels === 0) return
        parts.push({ name, kind, grid, diagnostics: grid.diagnostics })
    }

    const hcn = body.headCelNumber
    const headed = headProp?.celmasks?.length && hcn >= 0 && hcn < body.limbs.length
    for (let i = 0; i < body.limbs.length; i++) {
        // The neck cel is the head's attachment point, not a limb of its own. Whether it is PAINTED
        // is the head's call — animate.m disk_face (face-plate.js) — and most heads suppress it
        // because the head object supplies the face. A headless body has no such gate: all six cels
        // are ordinary limbs.
        if (headed && i === hcn && !shouldPaintFacePlate(headProp, VIEW_FACING.front)) continue
        pushPart(`limb${i}`, layerForLimb("front", i), sideFallback(i), layerForLimb("back", i))
    }

    if (headed) {
        const headLayer = (view) => {
            const v = views[view]
            if (!v) return EMPTY_LAYER
            const facing = VIEW_FACING[view]
            const anim = headProp.animations?.[facing] ?? headProp.animations?.[0] ?? { startState: 0 }
            const state = Math.min(anim.startState ?? 0, headProp.celmasks.length - 1)
            const frame = frameFromCels(celsFromMask(headProp, headProp.celmasks[state]), {
                colors: headMod ? colorsFromMod(headMod) : { pattern: headPatternFromMod(headMod, limbPatterns[3]) },
                firstCelOrigin: false,
            })
            if (!frame) return EMPTY_LAYER
            return layerFromFrame(translateSpace(frame,
                v.chain.cx[hcn], v.chain.cy[hcn] + AVATAR_HEAD_LIFT + v.walkPaintY))
        }
        pushPart("head", headLayer("front"), headLayer("side"), headLayer("back"), "head")
    }

    return parts
}

/**
 * Per-part registration report: where the three views agree and where they do not.
 *
 * The hull can only span rows the FRONT view covers, so a limb whose side cel is taller than its
 * front cel loses the difference. That is a property of the 1986 art, not of the code, and it is
 * the number to look at before touching any constant — [[webclient-pick-trace-first]]: measure the
 * live data first, do not theorise about the registration.
 */
export const registrationReport = (body, avatarMod, headProp, headMod, options = {}) => {
    const { pose = "stand", frameIndex = 0 } = options
    const triple = POSE_TRIPLES[pose]
    if (!triple) return []
    const rows = []
    const chains = {}
    for (const view of ["side", "front", "back"]) {
        const actionName = view === "back" ? (triple.back ?? triple.front) : triple[view]
        const lens = cycleLength(body, triple.side)
        const f = view === "side" ? frameIndex % Math.max(1, lens)
            : mapFrame(frameIndex, lens, cycleLength(body, actionName))
        chains[view] = { actionName, chain: chainForView(body, avatarMod, actionName, f) }
    }
    for (let i = 0; i < body.limbs.length; i++) {
        const span = (view) => {
            const c = chains[view]?.chain
            const cel = c?.cels[i]
            if (!cel) return null
            return { lo: c.cy[i] + cel.yOffset - cel.height, hi: c.cy[i] + cel.yOffset, xlo: (c.cx[i] + cel.xOffset) * 4 }
        }
        const front = span("front"), side = span("side")
        rows.push({
            limb: i, pattern: body.limbs[i].pattern,
            front, side,
            // Rows the side cel has that the front cel does not: these are dropped by the hull.
            lostRows: (front && side) ? Math.max(0, front.lo - side.lo) + Math.max(0, side.hi - front.hi) : null,
        })
    }
    return rows
}

/**
 * Merge every part's faces into one buffer set — one draw call per figure.
 *
 * Parts are already in a shared space, so this is a concatenation, not a transform. Keeping it
 * separate from buildFigureParts lets the lab render parts individually (to inspect one limb) or
 * merged (to see the figure).
 */
export const mergeParts = (parts, options = {}) => {
    const meshes = parts.map((p) => facesFromVoxels(p.grid, options))
    const total = meshes.reduce((n, m) => n + m.positions.length, 0)
    const totalIdx = meshes.reduce((n, m) => n + m.indices.length, 0)
    const positions = new Float32Array(total)
    const normals = new Float32Array(total)
    const colors = new Float32Array(total)
    const indices = new Uint32Array(totalIdx)
    let vo = 0, io = 0
    for (const m of meshes) {
        positions.set(m.positions, vo)
        normals.set(m.normals, vo)
        colors.set(m.colors, vo)
        for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo / 3
        vo += m.positions.length
        io += m.indices.length
    }
    return { positions, normals, colors, indices, faceCount: totalIdx / 6 }
}

/**
 * Software-rasterize the WHOLE figure along a cardinal axis, in native pixels.
 *
 * This is the fidelity instrument: its output is directly comparable to composeAvatarFrameAt's
 * canvas, so "does the solid still look like the character?" becomes a pixel count instead of an
 * opinion. Parts are merged with a real depth test (rasterizeWithDepth's key is signed so nearer
 * is smaller), which is also the honest way to find where the 3D depth order disagrees with the 2D
 * paint order — the 2D client sorts by frontFacingLimbOrder, the solid sorts by actual depth.
 *
 * Mirroring happens ONCE, on the finished figure. Flipping each part about its own box would
 * scatter the limbs across the body.
 */
export const rasterizeFigure = (parts, axis = "+z") => {
    const views = parts.map((p) => rasterizeWithDepth(p.grid, axis)).filter((v) => v.w > 0)
    if (views.length === 0) return EMPTY_LAYER
    const minX = Math.min(...views.map((v) => v.x0))
    const maxX = Math.max(...views.map((v) => v.x0 + v.w - 1))
    const minY = Math.min(...views.map((v) => v.y0))
    const maxY = Math.max(...views.map((v) => v.y0 + v.h - 1))
    const w = maxX - minX + 1, h = maxY - minY + 1
    const data = new Uint32Array(w * h)
    const depth = new Int32Array(w * h).fill(0x7fffffff)
    for (const v of views) {
        for (let r = 0; r < v.h; r++) {
            for (let c = 0; c < v.w; c++) {
                const px = v.data[r * v.w + c]
                if ((px >>> 24) === 0) continue
                const o = (v.y0 + r - minY) * w + (v.x0 + c - minX)
                const d = v.depth[r * v.w + c]
                if (d >= depth[o]) continue
                depth[o] = d
                data[o] = px
            }
        }
    }
    const merged = makeLayer(w, h, minX, minY, data)
    return orthoIsMirrored(axis) ? mirrorView(merged) : merged
}

/**
 * Build a Three BufferGeometry. Three is passed in rather than imported so this module stays pure
 * and node-testable — the same decoupling billboard.js uses.
 */
export const geometryFromParts = (THREE, parts, options = {}) => {
    const { positions, normals, colors, indices } = mergeParts(parts, options)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3))
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))
    return geo
}
