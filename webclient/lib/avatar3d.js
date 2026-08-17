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
import { quantizeFrames, encodeGif } from "../render3d/gifenc.js"
import { createControlKit } from "./lab-controls.js"

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
// preserveDrawingBuffer so the GIF export can read a frame back after rendering it. antialias off
// is not just for looks: smoothed edges would blend C64 colours into in-between values and turn a
// 17-colour rotation into a few thousand, which is the one thing that would make the GIF export
// need real quantization.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true })
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

// ── GIF export ───────────────────────────────────────────────────────────────────────────────
// One full turn, sampled at even yaw steps so the loop is seamless: frame N would be frame 0 again,
// so it is not emitted. Rendering is synchronous per frame and read back immediately
// (preserveDrawingBuffer), with a yield every few frames so the tab does not lock up.
const BACKDROP_RGB = [0x4a, 0x4a, 0x55]

const captureRotation = async ({ frames, onProgress }) => {
    const wasSpinning = state.autorotate
    const wasYaw = state.yaw
    state.autorotate = false
    const w = canvas.width, h = canvas.height
    const scratch = document.createElement("canvas")
    scratch.width = w; scratch.height = h
    const sctx = scratch.getContext("2d", { willReadFrequently: true })
    const shots = []
    try {
        for (let i = 0; i < frames; i++) {
            pivot.rotation.y = THREE.MathUtils.degToRad((i * 360) / frames)
            renderer.render(scene, camera)
            sctx.drawImage(canvas, 0, 0)
            shots.push(sctx.getImageData(0, 0, w, h).data)
            onProgress?.(i + 1, frames)
            if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0))
        }
    } finally {
        state.autorotate = wasSpinning
        setYaw(wasYaw)
        pivot.rotation.y = THREE.MathUtils.degToRad(wasYaw)
        renderer.render(scene, camera)
    }
    return { shots, width: w, height: h }
}

const buildRotationGif = async ({ frames = 36, delayMs = 60, transparent = false, onProgress } = {}) => {
    const { shots, width, height } = await captureRotation({ frames, onProgress })
    const q = quantizeFrames(shots, { backgroundRGB: BACKDROP_RGB })
    const bytes = encodeGif({
        width, height, palette: q.palette,
        frames: q.indexed.map((indices) => ({ indices, delayMs })),
        loop: 0,
        transparentIndex: transparent ? q.backgroundIndex : null,
    })
    return { bytes, width, height, frames, colors: q.palette.length, exact: q.exact }
}

const describeGif = (r) =>
    `${r.frames} frames · ${r.width}×${r.height} · ${r.colors} colours` +
    `${r.exact ? "" : " (approximated!)"} · ${(r.bytes.length / 1024).toFixed(0)} KB`

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
// The widgets themselves live in lib/lab-controls.js — figure3d.js wants the same set, and the
// spray popdown especially must not exist twice (it renders its swatches through the real
// canvasFromBitmap, so a second copy could drift and the drift would read as a rendering bug).
const kit = createControlKit({ onChange: () => rebuild() })
const { el, addRow, slider, select, checkbox, sprayPopdown, SPRAY_SLOTS } = kit
const syncControls = kit.sync

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

    // One popdown per spray-can limb slot (equates.m LEG/TORSO/ARM/FACE).
    const spray = el("fieldset", {}, [el("legend", { textContent: "spray can — limb patterns" })])
    for (const slot of SPRAY_SLOTS) {
        const row = addRow(spray, slot.label,
            sprayPopdown(() => state[slot.key], (v) => { state[slot.key] = v }))
        row.title = `SPRAY limb ${slot.limb} · ${slot.hint}`
    }
    panel.appendChild(spray)

    const solid = el("fieldset", {}, [el("legend", { textContent: "solid" })])
    addRow(solid, "limb round", ...slider(0, 1, 0.05, () => state.roundLimb, (v) => { state.roundLimb = v }))
    addRow(solid, "head round", ...slider(0, 1, 0.05, () => state.roundHead, (v) => { state.roundHead = v }))
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

    // Export is view-only too — it must never rebuild the hull.
    const exp = el("fieldset", {}, [el("legend", { textContent: "export" })])
    const framesSel = el("select")
    for (const n of [12, 24, 36, 48, 72]) framesSel.appendChild(el("option", { value: String(n), textContent: `${n} frames` }))
    framesSel.value = "36"
    addRow(exp, "steps", framesSel)
    const fpsSel = el("select")
    // GIF delays are hundredths of a second, so only these divide evenly — anything else is a lie
    // rounded at encode time.
    for (const [ms, lbl] of [[40, "25 fps"], [50, "20 fps"], [60, "16.7 fps"], [80, "12.5 fps"], [100, "10 fps"]]) {
        fpsSel.appendChild(el("option", { value: String(ms), textContent: lbl }))
    }
    fpsSel.value = "60"
    addRow(exp, "speed", fpsSel)
    const transp = el("input", { type: "checkbox" })
    const transpRow = addRow(exp, "transparent", transp)
    transpRow.title = "Off by default: the C64 dither paints real black pixels, which vanish on a dark page."
    const status = el("div", { className: "exportstatus", textContent: "" })
    const goBtn = el("button", { type: "button", textContent: "export rotation GIF" })
    goBtn.addEventListener("click", async () => {
        goBtn.disabled = true
        try {
            const r = await buildRotationGif({
                frames: +framesSel.value,
                delayMs: +fpsSel.value,
                transparent: transp.checked,
                onProgress: (i, n) => { goBtn.textContent = `rendering ${i}/${n}…` },
            })
            const blob = new Blob([r.bytes], { type: "image/gif" })
            const url = URL.createObjectURL(blob)
            const name = gifFilename()
            const a = el("a", { href: url, download: name })
            document.body.appendChild(a); a.click(); a.remove()
            setTimeout(() => URL.revokeObjectURL(url), 10000)
            // Show the name: the browser decides WHERE the file goes, so the least we can do is
            // say what to look for.
            status.textContent = `${name}\n${describeGif(r)}`
        } catch (e) {
            status.textContent = `export failed: ${e?.message ?? e}`
        } finally {
            goBtn.disabled = false
            goBtn.textContent = "export rotation GIF"
        }
    })
    exp.appendChild(el("div", { className: "row" }, [goBtn]))
    exp.appendChild(status)
    panel.appendChild(exp)
}

// Name the file after what is actually in it, so a folder of experiments stays legible:
//
//     habitat-<body>-<head>-<LTAH>.gif       e.g. habitat-human-wizard0-6968.gif
//
// The four texture digits are Legs, Torso, Arms, Hair, in the order the spray-can panel lists
// them. HEX, one digit each, because that is exactly how Habitat stores them — custom.m packs
// legs/torso into the nibbles of custom[0] and arms into the high nibble of custom[1], and the
// hair pattern rides in the head's orientation. So the suffix is not an invented code, it is the
// paint values written out.
const textureDigits = () =>
    [state.legs, state.torso, state.arms, state.hair]
        .map((n) => (n & 0xf).toString(16)).join("")

const gifFilename = () => {
    const safe = (s) => String(s).replace(/[^a-z0-9_]+/gi, "-")
    const body = BODY_NAMES[state.style] ?? `style${state.style}`
    const head = state.head.replace(/^heads\//, "").replace(/\.bin$/, "")
    return `habitat-${safe(body.toLowerCase())}-${safe(head)}-${textureDigits()}.gif`
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
    // Returns the GIF as base64 so check-avatar3d.mjs can write the real file out and hand it back
    // to the browser's own decoder — the only verification that actually proves the bytes are valid.
    async exportGif(opts) {
        const r = await buildRotationGif(opts)
        let bin = ""
        for (const b of r.bytes) bin += String.fromCharCode(b)
        return { base64: btoa(bin), width: r.width, height: r.height, frames: r.frames, colors: r.colors, exact: r.exact, bytes: r.bytes.length }
    },
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
