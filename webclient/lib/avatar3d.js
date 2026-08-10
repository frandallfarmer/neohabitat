// avatar3d.js — the Solid Avatar Lab.
//
// A turntable for the shape-from-silhouette avatar (render3d/voxel.js + avatarvox.js), plus the
// calibration surface that keeps it honest: a side-by-side diff of the SOLID rasterized along each
// cardinal axis against the SAME frame composed by the 2D client (region.js composeAvatarFrameAt).
//
// Why the diff panel matters more than the turntable: a rotating figure always looks plausible, so
// "does it still look like the character?" cannot be answered by staring at it. At yaw 0 and yaw 90
// the answer is objective — the render must land on the original cels pixel for pixel — and the
// panel prints that number. Every knob below (roundness especially) is judged against it.
//
// ORTHOGRAPHIC ON PURPOSE. A perspective camera would make the cardinal views *nearly* right and
// hide exactly the registration errors the lab exists to find.

import * as THREE from "../vendor/three.module.js"
import { getFile } from "../habirender/shim.js"
import { decodeBody, decodeProp } from "../habirender/codec.js"
import { composeAvatarFrameAt, AVATAR_BODY_FILES } from "../habirender/region.js"
import { buildFigureParts, geometryFromParts, rasterizeFigure, layerFromFrame, POSE_TRIPLES,
    registrationReport } from "../render3d/avatarvox.js"
import { compareLayers, bboxOf, layerAt, mirrorView } from "../render3d/voxel.js"

const BODY_NAMES = ["Human", "Penguin", "Spider", "Dragon", "Gunship", "Tank", "Tentacle"]

// The four cardinal views, and the chore whose 2D frame each one must reproduce. Only "+z" (front)
// and "-x" (side) are asserted strictly: a solid's shadow is the same along +Z and −Z, so the back
// silhouette cannot also be honoured, and "+x" is just the mirrored side (paint.m's flip).
const CARDINALS = [
    { axis: "+z", label: "front", view: "front", strict: true },
    { axis: "-x", label: "side", view: "side", strict: true },
    { axis: "-z", label: "back", view: "back", strict: false },
    { axis: "+x", label: "side (mirrored)", view: "side", strict: false, mirrored: true },
]

const state = {
    style: 0,
    head: "heads/head0.bin",
    pose: "stand",
    frameIndex: 0,
    height: 2,          // orientation bits 0x38, in steps of 1 (custom.m HEIGHT_STEP = 0x10 → 2)
    female: false,
    hair: 6,            // head orientation colour value (custom.m HAIR_STEP)
    legs: 6, torso: 6, arms: 8, // customize nibbles
    // Per-part: a head hull is nearly cubic and needs hard rounding or it reads at 45° as two flat
    // portraits meeting at an edge; limbs are genuinely slab-like. See avatarvox.js buildFigureParts.
    roundLimb: 0.45,
    roundHead: 1,
    rowMapping: "absolute",
    yaw: 0,
    autorotate: true,
    showParts: "all",
}

let body = null
let headProp = null
let headList = []
let parts = []

// ── habitat mods ─────────────────────────────────────────────────────────────────────────────
// Field semantics are custom.m's (see lib/customize.mjs): orientation bit 0x80 = female,
// bits 0x38 = height; customize[0] hi/lo = leg/torso colour, customize[1] hi = arm colour.
const avatarMod = () => ({
    type: "Avatar",
    style: state.style,
    orientation: (state.female ? 0x80 : 0) | ((state.height << 3) & 0x38),
    custom: [((state.legs & 0xf) << 4) | (state.torso & 0xf), ((state.arms & 0xf) << 4) | 0x8],
})
const headMod = () => ({ type: "Head", orientation: (state.hair << 3) & 0x78 })

// ── asset loading ────────────────────────────────────────────────────────────────────────────
const loadBinary = async (path) => {
    const res = await getFile(path)
    if (!res.ok) throw new Error(`${path}: ${res.status}`)
    return new DataView(await res.arrayBuffer())
}
const loadBody = async (style) => decodeBody(await loadBinary(AVATAR_BODY_FILES[style] ?? AVATAR_BODY_FILES[0]))
const loadHead = async (path) => decodeProp(await loadBinary(path))

// ── three scene ──────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("stage")
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false })
renderer.setPixelRatio(1)
// NOT black. The C64 wild-colour dither legitimately paints BLACK pixels (render.js
// rgbaFromNibble: patternColors[2] is colour 0), so on a black backdrop a dithered robe or a dark
// hat reads as holes in the mesh and the figure looks like it is falling apart. It is not — it is
// camouflage. A mid grey shows the real silhouette.
renderer.setClearColor(0x4a4a55, 1)
const scene = new THREE.Scene()
const pivot = new THREE.Group()
scene.add(pivot)

// Level, orthographic, and framed to the figure's BOUNDING SPHERE — not its box. A voxel is 2 world
// units wide and only 1 tall, so the figure is far wider than it is tall (~80 × ~58), and the width
// swings into depth as it turns. Fitting the box at yaw 0 would clip the arms at yaw 45.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000)
camera.position.set(0, 0, 1000)
camera.lookAt(0, 0, 0)

const frameCamera = (radius) => {
    const r = Math.max(radius, 1) * 1.06
    const aspect = canvas.width / canvas.height
    const halfH = aspect >= 1 ? r : r / aspect
    const halfW = halfH * aspect
    camera.left = -halfW; camera.right = halfW
    camera.top = halfH; camera.bottom = -halfH
    camera.updateProjectionMatrix()
}

// Vertex colours straight from the cels, unlit: the 1986 artists already painted the difference
// between the front and side views, and a lambert term on top of that just muddies it.
const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
let mesh = null

const rebuildMesh = () => {
    if (mesh) { pivot.remove(mesh); mesh.geometry.dispose(); mesh = null }
    const shown = state.showParts === "all" ? parts : parts.filter((p) => p.name === state.showParts)
    if (shown.length === 0) return
    const geo = geometryFromParts(THREE, shown)
    // Spin about the figure's own centre, not the chain origin, or the turntable wobbles.
    geo.computeBoundingBox()
    const b = geo.boundingBox
    geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2)
    geo.computeBoundingSphere()
    frameCamera(geo.boundingSphere?.radius ?? 60)
    mesh = new THREE.Mesh(geo, material)
    pivot.add(mesh)
}

// ── the diff panel ───────────────────────────────────────────────────────────────────────────
const SCALE = 3
const DIFF_PX = { w: 2, h: 1 } // a native C64 multicolor pixel: 2 world units wide, 1 tall

// Draw a view layer at native resolution, restoring the 2:1 pixel aspect the C64 had.
const drawLayer = (ctx, layer, box, tint = null) => {
    if (!layer || layer.w === 0) return
    for (let r = 0; r < layer.h; r++) {
        for (let c = 0; c < layer.w; c++) {
            const px = layer.data[r * layer.w + c]
            if ((px >>> 24) === 0) continue
            ctx.fillStyle = tint ?? `rgb(${px & 0xff},${(px >>> 8) & 0xff},${(px >>> 16) & 0xff})`
            ctx.fillRect(
                (layer.x0 + c - box.minX) * DIFF_PX.w * SCALE,
                (box.maxY - (layer.y0 + r)) * DIFF_PX.h * SCALE,
                DIFF_PX.w * SCALE, DIFF_PX.h * SCALE)
        }
    }
}

const unionBox = (layers) => {
    const bs = layers.map(bboxOf).filter(Boolean)
    if (bs.length === 0) return null
    return {
        minX: Math.min(...bs.map((b) => b.minX)), maxX: Math.max(...bs.map((b) => b.maxX)),
        minY: Math.min(...bs.map((b) => b.minY)), maxY: Math.max(...bs.map((b) => b.maxY)),
    }
}

// The 2D reference frame for one view, straight out of the shipping compositor.
const referenceLayer = (viewName) => {
    const triple = POSE_TRIPLES[state.pose]
    const actionName = viewName === "back" ? (triple.back ?? triple.front) : triple[viewName]
    // Orientation bit 0 must stay clear: flipComposedFrame mirrors the side composite when it is
    // set, and the solid is always built from the canonical right-facing art.
    const frame = composeAvatarFrameAt(body, avatarMod(), headProp, headMod(), null, null,
        actionName, state.frameIndex)
    return frame ? layerFromFrame(frame) : null
}

// Align a mirrored render onto the reference by bbox — mirrored views carry no body-frame origin
// (voxel.js orthoRasterize), so only their shape is comparable, not their absolute position.
const alignToBbox = (layer, ref) => {
    const a = bboxOf(layer), b = bboxOf(ref)
    if (!a || !b) return layer
    return { ...layer, x0: layer.x0 + (b.minX - a.minX), y0: layer.y0 + (b.minY - a.minY) }
}

const renderDiff = () => {
    const grid = document.getElementById("diffgrid")
    grid.textContent = ""
    const summary = []
    for (const card of CARDINALS) {
        let solid = rasterizeFigure(parts, card.axis)
        // "+x" is the avatar facing the other way — paint.m mirrors the whole composite, so the
        // reference has to be mirrored too or the comparison is meaningless on an asymmetric figure.
        let ref = referenceLayer(card.view)
        if (card.mirrored && ref) ref = mirrorView(ref)
        if (card.mirrored || card.axis === "-z") solid = alignToBbox(solid, ref)
        const cmp = compareLayers(solid, ref)
        const box = unionBox([solid, ref])
        const cell = document.createElement("div")
        cell.className = "diffcell"
        if (box) {
            const w = (box.maxX - box.minX + 1) * DIFF_PX.w * SCALE
            const h = (box.maxY - box.minY + 1) * DIFF_PX.h * SCALE
            for (const [caption, paint] of [
                ["solid", (ctx) => drawLayer(ctx, solid, box)],
                ["2D cels", (ctx) => drawLayer(ctx, ref, box)],
                ["diff", (ctx) => {
                    drawLayer(ctx, ref, box, "#2a2e3c")
                    // Red = the solid has a pixel the cels do not; blue = the cels have one it lost.
                    for (let y = box.minY; y <= box.maxY; y++) {
                        for (let x = box.minX; x <= box.maxX; x++) {
                            const sa = (layerAt(solid, x, y) >>> 24) !== 0
                            const ra = (layerAt(ref, x, y) >>> 24) !== 0
                            if (sa === ra) continue
                            ctx.fillStyle = sa ? "#e06c75" : "#61afef"
                            ctx.fillRect((x - box.minX) * DIFF_PX.w * SCALE,
                                (box.maxY - y) * DIFF_PX.h * SCALE, DIFF_PX.w * SCALE, DIFF_PX.h * SCALE)
                        }
                    }
                }],
            ]) {
                const c = document.createElement("canvas")
                c.width = w; c.height = h
                paint(c.getContext("2d"))
                const holder = document.createElement("div")
                holder.appendChild(c)
                const cap = document.createElement("div")
                cap.className = "cap"
                cap.textContent = caption
                holder.appendChild(cap)
                holder.style.display = "inline-block"
                holder.style.marginRight = "8px"
                cell.appendChild(holder)
            }
        }
        const title = document.createElement("div")
        const pct = cmp.total ? (100 * cmp.alphaMismatch / cmp.total).toFixed(1) : "0.0"
        const cls = cmp.alphaMismatch === 0 ? "ok" : card.strict ? "bad" : "warn"
        title.innerHTML = `<b>${card.label}</b> <span class="${cls}">` +
            `${cmp.alphaMismatch} px off (${pct}%)</span>` +
            `<span class="cap"> · colour ${cmp.colorMismatch}/${cmp.total}</span>`
        cell.insertBefore(title, cell.firstChild)
        grid.appendChild(cell)
        summary.push({ axis: card.axis, label: card.label, strict: card.strict, ...cmp, mismatches: undefined })
    }
    const diag = parts.map((p) => `${p.name}: ${p.diagnostics.voxels}v` +
        `${p.diagnostics.clampedRows ? ` clamp:${p.diagnostics.clampedRows}` : ""}` +
        `${p.diagnostics.starvedColumns ? ` starved:${p.diagnostics.starvedColumns}` : ""}`).join("   ")
    document.getElementById("stats").textContent = diag
    // Consumed by check-avatar3d.mjs; also handy from the console.
    window.__avatarvox = {
        parts, summary, state: { ...state },
        registration: registrationReport(body, avatarMod(), headProp, headMod(),
            { pose: state.pose, frameIndex: state.frameIndex }),
    }
    return summary
}

// ── rebuild pipeline ─────────────────────────────────────────────────────────────────────────
const rebuild = () => {
    parts = buildFigureParts(body, avatarMod(), headProp, headMod(),
        {
            pose: state.pose, frameIndex: state.frameIndex, rowMapping: state.rowMapping,
            roundness: { limb: state.roundLimb, head: state.roundHead },
        })
    populatePartPicker()
    rebuildMesh()
    renderDiff()
}

// ── controls ─────────────────────────────────────────────────────────────────────────────────
const el = (tag, props = {}, kids = []) => {
    const n = Object.assign(document.createElement(tag), props)
    for (const k of kids) n.appendChild(k)
    return n
}

const addRow = (parent, label, control, valueNode) => {
    const row = el("div", { className: "row" })
    row.appendChild(el("label", { textContent: label }))
    row.appendChild(control)
    if (valueNode) row.appendChild(valueNode)
    parent.appendChild(row)
    return row
}

// Every control registers a syncer so labApi.setState can drive the lab from outside and leave the
// widgets showing the truth — otherwise the automated check and the on-screen panel drift apart.
const syncers = []
const syncControls = () => { for (const s of syncers) s() }

const show = (v) => (typeof v === "number" && !Number.isInteger(v)) ? v.toFixed(2) : String(v)

const slider = (min, max, step, get, set) => {
    const val = el("span", { className: "val", textContent: show(get()) })
    const input = el("input", { type: "range", min, max, step, value: get() })
    input.addEventListener("input", () => {
        set(parseFloat(input.value))
        val.textContent = show(get())
        rebuild()
    })
    syncers.push(() => { input.value = String(get()); val.textContent = show(get()) })
    return [input, val]
}

const select = (options, get, set) => {
    const s = el("select")
    for (const [value, label] of options) s.appendChild(el("option", { value, textContent: label }))
    s.value = get()
    s.addEventListener("change", async () => { await set(s.value); rebuild() })
    syncers.push(() => { s.value = get() })
    return s
}

const checkbox = (get, set) => {
    const c = el("input", { type: "checkbox", checked: get() })
    c.addEventListener("change", () => { set(c.checked); rebuild() })
    syncers.push(() => { c.checked = get() })
    return c
}

let partPicker = null
let yawInput = null
let yawVal = null
let setYaw = () => {}
const populatePartPicker = () => {
    if (!partPicker) return
    const prev = state.showParts
    partPicker.textContent = ""
    partPicker.appendChild(el("option", { value: "all", textContent: "whole figure" }))
    for (const p of parts) partPicker.appendChild(el("option", { value: p.name, textContent: p.name }))
    partPicker.value = parts.some((p) => p.name === prev) ? prev : "all"
    state.showParts = partPicker.value
}

const buildControls = () => {
    const panel = document.getElementById("controls")

    const figure = el("fieldset", {}, [el("legend", { textContent: "figure" })])
    addRow(figure, "body", select(BODY_NAMES.map((n, i) => [String(i), `${i} ${n}`]),
        () => String(state.style), async (v) => { state.style = +v; body = await loadBody(state.style) }))
    addRow(figure, "head", select(headList.map((h) => [h, h.replace("heads/", "").replace(".bin", "")]),
        () => state.head, async (v) => { state.head = v; headProp = await loadHead(v) }))
    addRow(figure, "pose", select(Object.keys(POSE_TRIPLES).map((p) => [p, p]),
        () => state.pose, (v) => { state.pose = v; state.frameIndex = 0 }))
    addRow(figure, "frame", ...slider(0, 6, 1, () => state.frameIndex, (v) => { state.frameIndex = v }))
    addRow(figure, "height", ...slider(0, 7, 1, () => state.height, (v) => { state.height = v }))
    addRow(figure, "female", checkbox(() => state.female, (v) => { state.female = v }))
    panel.appendChild(figure)

    const colour = el("fieldset", {}, [el("legend", { textContent: "colours (custom.m nibbles)" })])
    for (const key of ["legs", "torso", "arms", "hair"]) {
        addRow(colour, key, ...slider(0, 15, 1, () => state[key], (v) => { state[key] = v }))
    }
    panel.appendChild(colour)

    const solid = el("fieldset", {}, [el("legend", { textContent: "solid" })])
    addRow(solid, "round limb", ...slider(0, 1, 0.05, () => state.roundLimb, (v) => { state.roundLimb = v }))
    addRow(solid, "round head", ...slider(0, 1, 0.05, () => state.roundHead, (v) => { state.roundHead = v }))
    // How the side cel's depth profile is read across the front's rows. See voxel.js
    // sideProfileRows — the two views disagree on limb height and this is the choice of who loses.
    addRow(solid, "side rows", select([["absolute", "absolute (1:1, clamp)"], ["proportional", "proportional (stretch)"]],
        () => state.rowMapping, (v) => { state.rowMapping = v }))
    partPicker = el("select")
    partPicker.addEventListener("change", () => { state.showParts = partPicker.value; rebuildMesh() })
    addRow(solid, "show", partPicker)
    panel.appendChild(solid)

    // Yaw and autorotate are VIEW-ONLY — they must never rebuild the hull, which is why they do not
    // go through the shared slider() helper.
    const view = el("fieldset", {}, [el("legend", { textContent: "view" })])
    yawVal = el("span", { className: "val", textContent: "0" })
    yawInput = el("input", { type: "range", min: 0, max: 359, step: 1, value: 0 })
    setYaw = (deg) => { state.yaw = deg; yawInput.value = String(Math.round(deg)); yawVal.textContent = String(Math.round(deg)) }
    yawInput.addEventListener("input", () => { state.autorotate = false; spinBox.checked = false; setYaw(+yawInput.value) })
    addRow(view, "yaw", yawInput, yawVal)
    const spinBox = el("input", { type: "checkbox", checked: state.autorotate })
    spinBox.addEventListener("change", () => { state.autorotate = spinBox.checked })
    addRow(view, "autorotate", spinBox)
    const snap = el("div", { className: "row" })
    for (const [label, deg] of [["front", 0], ["side", 90], ["back", 180], ["side'", 270]]) {
        const b = el("button", { textContent: label })
        b.addEventListener("click", () => { state.autorotate = false; spinBox.checked = false; setYaw(deg) })
        snap.appendChild(b)
    }
    view.appendChild(snap)
    panel.appendChild(view)
}

// ── main loop ────────────────────────────────────────────────────────────────────────────────
const tick = () => {
    if (state.autorotate) {
        state.yaw = (state.yaw + 0.4) % 360
        if (yawInput) yawInput.value = String(Math.round(state.yaw))
        if (yawVal) yawVal.textContent = String(Math.round(state.yaw))
    }
    // Yaw 0 must face the camera: the front cels are the +Z faces, and the camera sits at +Z.
    pivot.rotation.y = THREE.MathUtils.degToRad(state.yaw)
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
}

// Drive the lab from outside (check-avatar3d.mjs). Exposed rather than duplicated so the automated
// fidelity check measures exactly what the on-screen diff panel shows.
const labApi = {
    async setState(patch) {
        const needBody = patch.style !== undefined && patch.style !== state.style
        const needHead = patch.head !== undefined && patch.head !== state.head
        Object.assign(state, patch)
        if (needBody) body = await loadBody(state.style)
        if (needHead) headProp = await loadHead(state.head)
        syncControls()
    },
    rebuild() { rebuild(); return window.__avatarvox.summary },
    setYaw(deg) { state.autorotate = false; setYaw(deg) },
    get state() { return { ...state } },
}

const boot = async () => {
    headList = await (await getFile("heads.json")).json()
    body = await loadBody(state.style)
    headProp = await loadHead(state.head)
    buildControls()
    rebuild()
    tick()
    window.__avatarvoxLab = labApi
    window.__avatarvoxReady = true
}

boot().catch((e) => {
    document.body.insertBefore(
        el("pre", { textContent: `boot failed: ${e?.stack ?? e}`, style: "color:#e06c75;padding:16px" }),
        document.body.firstChild)
    window.__avatarvoxError = String(e?.stack ?? e)
})
