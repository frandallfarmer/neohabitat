// figure3d.js — the Habitat Figure Lab.
//
// A turntable for a genuinely rigged 3D avatar wearing Habitat's colours. Distinct from the Solid
// Avatar Lab (lib/avatar3d.js) and both are kept: that one recovers a solid from the 1986 art and
// is pixel-exact at the cardinals but can only ever stand, walk and sit, because those are the only
// poses the artists drew from more than one angle. This one gives up that exactness to get a figure
// that can wave, bow and point — and buys the Habitat *look* back with the shader instead.
//
// WHAT IS ACTUALLY BEING TESTED HERE. Not "does a 3D character render" — that is a solved problem.
// The open questions are:
//
//   1. Does Habitat's coloring model still read as Habitat on geometry the C64 never drew?
//   2. How much pixelation and palette-snapping does a smooth low-poly body need before it stops
//      looking like a modern asset — and does it turn to mush before it gets there?
//   3. Can a 1986 head sit on a 2020s body without looking like a joke? Habitat heads are enormous
//      relative to the figure; they are whole props, not head-sized.
//
// Every control below exists to answer one of those, which is why the retro settings are sliders
// rather than constants: the answer to (2) is not something to be argued about in a plan.

import * as THREE from "three"
import { GLTFLoader } from "../vendor/GLTFLoader.js"
import { getFile } from "../habirender/shim.js"
import { decodeProp } from "../habirender/codec.js"
import { loadFigure, setPackHeadVisible, POSE_BONES } from "../render3d/habirig.js"
import { GESTURES, CLIP_FOR_GESTURE, resolvePose, compactPose, poseCoverage } from "../render3d/habipose.js"
import { buildHeadPart, geometryFromParts } from "../render3d/avatarvox.js"
import { Billboard } from "../render3d/billboard.js"
import { frameFromCels, celsFromMask } from "../habirender/render.js"
import { createPostFX } from "../render3d/postfx.js"
import { createControlKit } from "./lab-controls.js"

const FIGURE_URL = "./assets3d/quaternius-casual.glb"
const HEADS_INDEX = "heads.json"
const PROPS_INDEX = "props.json"

// How tall the Habitat head should be as a fraction of the whole figure.
//
// NOT a scale factor. The first version of this was a hardcoded 1/70 and produced a head that
// filled half the frame, because a voxel is 2×1×2 world units and the bone it hangs from carries
// its own scale — two unknowns that a magic constant silently gets wrong. Measuring the figure and
// the hull at runtime and solving for the scale cannot be wrong in that way, and it keeps working
// if the body is ever swapped.
//
// The DEFAULT, though, is a judgement and the one this milestone exists to make. On the C64 the
// avatar stands 58 units and head0 is 26 of them — a head is FORTY-FIVE PERCENT of a Habitat
// avatar. Put that on a realistically proportioned body and it reads as a cartoon; put a
// realistic 13% on it and the head stops being the character. 0.30 is the opening bid.
const HEAD_FRACTION_DEFAULT = 0.30

const state = {
    // Two ways to drive the figure, and the lab does both because the gesture set needs both.
    // "clip" plays one of the pack's 24 animations; "gesture" holds one of Habitat's 23 chore poses
    // out of poses.json. Habitat gestures are mostly single held poses, which is exactly why hand
    // authoring them is tractable — see render3d/habipose.js.
    mode: "clip",
    gesture: "wave",
    editBone: "UpperArm.R",

    clip: "Idle",
    playing: true,
    speed: 1,
    yaw: 0,
    autorotate: true,

    // Habitat appearance. The three spray slots plus the two colours the patterns dither between.
    legs: 6, torso: 6, arms: 8,
    wildcard: 6, skin: 10,

    ditherSpace: "screen",
    ditherScale: 2,
    objDitherScale: 40,
    shade: false,

    pixelSize: 3,
    quantize: true,
    outline: true,

    head: "heads/head0.bin",
    hair: 6,
    headFraction: HEAD_FRACTION_DEFAULT,
    headLift: 0,        // in head-heights, so it means the same thing for every head
    packHead: false,

    held: "(none)",
    heldFraction: 0.14,
}

let figure = null
let mixer = null
let action = null
let clock = null
let headProp = null
let headMesh = null
let headMount = null
let headList = []
let headHullHeight = 1     // the current hull's own height, in voxel world units
let figureHeight = 1       // the body's height, in world units
let headToNeckWorld = 0    // how far the Head bone sits above the Neck bone, measured at bind
let poses = {}             // the gesture table, loaded from render3d/poses.json
let restRotations = {}     // every pose bone's rest euler, captured before anything moves
let bindPose = []          // EVERY bone's rest transform — see applyPose for why all of them
let heldMount = null
let heldScale = null
let heldBillboard = null
let propList = []

// ── three ────────────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("stage")
const statusEl = document.getElementById("status")

// preserveDrawingBuffer so the headless check can read a frame back. antialias OFF is not a
// preference: a blended edge is a colour that is not in the palette, and "every pixel is one of
// sixteen" is the property check-figure3d.mjs asserts.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
// No tone mapping and no output encoding. The shader emits final sRGB bytes; anything applied on
// top of that turns exact palette values into approximate ones.
renderer.toneMapping = THREE.NoToneMapping
renderer.outputColorSpace = THREE.LinearSRGBColorSpace
// And colour management off, page-wide. Without this the shader's palette values come out exact
// (they are read from a NoColorSpace lookup texture) but the CLEAR COLOUR does not: Three converts
// the hex to linear on assignment, nothing converts it back, and 0x4a4a55 lands in the framebuffer
// as 0x141418 — which quantizes to black, and a black background hides the black keyline. Found by
// dumping the actual pixels, not by reading the docs.
THREE.ColorManagement.enabled = false
// Not black: the wild dither legitimately paints black pixels (patternColors[2] is colour 0), so on
// black a dithered shirt reads as holes in the mesh. A mid grey shows the true silhouette. It
// quantizes to colodore dark grey, so the "16 colours only" property survives it.
renderer.setClearColor(0x4a4a55, 1)

const scene = new THREE.Scene()
const pivot = new THREE.Group()
scene.add(pivot)

// Orthographic, like the Solid Avatar Lab, and for the same reason: perspective would make the
// cardinal views nearly-but-not-quite right and hide exactly the registration errors worth seeing.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
camera.position.set(0, 0, 100)
camera.lookAt(0, 0, 0)

const postfx = createPostFX(THREE, renderer, {
    pixelSize: state.pixelSize, quantize: state.quantize, outline: state.outline ? 0.0015 : 0,
})
postfx.setSize(canvas.width, canvas.height)

const frameCamera = (radius) => {
    // Bounding SPHERE, not box: the figure's width swings into depth as the turntable turns, so a
    // box fitted at yaw 0 clips the arms at yaw 45.
    const r = Math.max(radius, 0.01) * 1.05
    const aspect = canvas.width / canvas.height
    const halfH = aspect >= 1 ? r : r / aspect
    camera.left = -halfH * aspect; camera.right = halfH * aspect
    camera.top = halfH; camera.bottom = -halfH
    camera.updateProjectionMatrix()
}

// ── the habitat head ─────────────────────────────────────────────────────────────────────────
// The one part of the figure that is NOT an interpretation. avatarvox.js recovers a true solid
// from the three cels the 1986 artists drew for every head in heads.json, so all 160-odd of them
// come along unchanged — and a Habitat avatar without its head is not a Habitat avatar, it is a
// mannequin. The body may be a stand-in; the head is the character.
const loadBinary = async (path) => {
    const res = await getFile(path)
    if (!res.ok) throw new Error(`${path}: ${res.status}`)
    return new DataView(await res.arrayBuffer())
}

const rebuildHead = () => {
    if (headMesh) {
        headMount.remove(headMesh)
        headMesh.geometry.dispose()
        headMesh = null
    }
    if (!headProp || !headMount) return

    const part = buildHeadPart(headProp, { type: "Head", orientation: (state.hair << 3) & 0x78 })
    if (!part) return

    const geo = geometryFromParts(THREE, [part])
    geo.computeBoundingBox()
    const b = geo.boundingBox
    // Sit the head ON the mount rather than centred through it: centre in x and z, but put the
    // BOTTOM of the hull at the origin, so the neck bone is where the neck is and the head grows
    // upward from it. Centring in y would bury half the head in the shoulders.
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)
    headHullHeight = Math.max(b.max.y - b.min.y, 1e-6)

    headMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        // Vertex colours straight off the cels — already palette values, and unlit on purpose:
        // the artists painted the shading between the views by hand, and a lambert term on top of
        // that only muddies what they did.
        vertexColors: true, side: THREE.DoubleSide,
    }))
    headMount.add(headMesh)
    applyHeadTransform()
}

const applyHeadTransform = () => {
    if (!headMesh || !figure?.headBone) return
    // Solve for the scale rather than assume it. The head hangs off a bone whose world scale is
    // whatever the exporter left behind — 100, as it happens, because the pack came out of FBX in
    // centimetres. Dividing it out is what makes the requested fraction actually the fraction you
    // get, and it keeps working if the body is ever swapped for one with different units.
    figure.root.updateWorldMatrix(true, true)
    const boneScale = figure.headBone.getWorldScale(new THREE.Vector3()).y || 1
    const s = (figureHeight * state.headFraction) / headHullHeight / boneScale
    headMesh.scale.set(s, s, s)

    // ANCHOR AT THE CHIN, NOT THE CROWN. The hull's bottom sits at the mount, and the Head bone is
    // up inside the skull — so mounting there leaves the head floating on a stalk, and the bigger
    // you make it the further it flies. Dropping the mount to the Neck bone puts the chin where a
    // chin goes, and growing the head then engulfs the shoulders, which is what a Habitat avatar
    // actually looks like. The drop is measured off the rig, in bone-local units.
    const drop = headToNeckWorld / boneScale
    // Lift in twentieths of a head height, so the slider means the same thing at every head size.
    const lift = state.headLift * 0.05 * (figureHeight * state.headFraction) / boneScale
    headMesh.position.set(0, -drop + lift, 0)
    reframe()
}

// A Habitat head can be half the height of the figure, which puts the crown well outside the body's
// own bounding sphere — so framing on the body alone crops the top of the head off, and cropping is
// exactly what you must not do while judging proportions.
const reframe = () => {
    const bodyRadius = figure.box.getBoundingSphere(new THREE.Sphere()).radius
    const headTop = headMesh
        ? headMesh.getWorldPosition(new THREE.Vector3()).y + figureHeight * state.headFraction
        : 0
    frameCamera(Math.max(bodyRadius, Math.abs(headTop)))
}

const setHead = async (path) => {
    state.head = path
    headProp = decodeProp(await loadBinary(path))
    rebuildHead()
}

// ── the held object ──────────────────────────────────────────────────────────────────────────
// A BILLBOARD, and that is not a compromise. Habitat props were drawn once, from one angle — there
// is no second view of a magic wand to build a solid out of. A flat quad is the complete truth
// about the art, so render3d/billboard.js is reused verbatim rather than something new being
// invented to render half the information twice.
const setHeld = async (path) => {
    state.held = path
    if (heldBillboard) {
        heldScale.remove(heldBillboard.mesh)
        heldBillboard.dispose()
        heldBillboard = null
    }
    if (!path || path === "(none)" || !heldMount) return

    const prop = decodeProp(await loadBinary(path))
    const frame = frameFromCels(celsFromMask(prop, prop.celmasks[0] ?? 0x80), { colors: {} })
    if (!frame?.canvas) return

    heldBillboard = new Billboard(THREE).setFrames([frame])
    // Billboard places a frame by its own cel origin, in canvas pixels == world units. Here the
    // world is 1.8 units tall, so it goes inside a scaled group and is re-anchored to its centre.
    heldBillboard.setWorldRect(-frame.canvas.width / 2, -frame.canvas.height / 2, 0)
    heldScale.add(heldBillboard.mesh)
    applyHeldTransform()
}

const applyHeldTransform = () => {
    if (!heldBillboard || !figure?.handBone) return
    figure.root.updateWorldMatrix(true, true)
    const boneScale = figure.handBone.getWorldScale(new THREE.Vector3()).y || 1
    const h = heldBillboard.mesh.scale.y || 1
    const s = (figureHeight * state.heldFraction) / h / boneScale
    heldScale.scale.set(s, s, s)
}

// ── applying state ───────────────────────────────────────────────────────────────────────────
const applyAppearance = () => {
    if (!figure) return
    const u = figure.shared
    u.uWildcard.value = state.wildcard
    u.uSkin.value = state.skin
    // LEG, TORSO, ARM, FACE — the same four slots the spray can addresses (equates.m). FACE takes
    // the torso pattern for now; the hull head brings its own colours in milestone 4.
    u.uLimbPattern.value.set(state.legs, state.torso, state.arms, state.torso)
    u.uDitherSpace.value = state.ditherSpace === "screen" ? 0 : 1
    u.uDitherScale.value.set(state.ditherScale, Math.max(1, Math.round(state.ditherScale / 2)))
    u.uObjDitherScale.value = state.objDitherScale
    u.uShadeStrength.value = state.shade ? 1 : 0
    setPackHeadVisible(figure, state.packHead)
    applyHeadTransform()
    applyHeldTransform()
}

const applyPost = () => {
    postfx.setPixelSize(state.pixelSize)
    postfx.setQuantize(state.quantize)
    postfx.setOutline(state.outline ? 0.0015 : 0)
}

const applyClip = () => {
    if (!figure || !mixer) return
    const next = figure.clipByLabel(state.clip)
    if (action) action.stop()
    action = null
    if (!next) { mixer.setTime(0); return }
    action = mixer.clipAction(next)
    action.reset().play()
    action.paused = !state.playing
}

// ── gestures ─────────────────────────────────────────────────────────────────────────────────
const currentPose = () => (poses[state.gesture] ??= {})

// Assigned by buildControls; a no-op until the panel exists.
let paintTouched = () => {}

/**
 * Put the rig into the current gesture's pose.
 *
 * The mixer has to be stopped first and kept stopped: an action writes bone rotations on every
 * update, so a pose set while a clip is playing survives exactly until the next frame and reads as
 * "the sliders do nothing".
 *
 * AND THE WHOLE SKELETON HAS TO GO BACK TO BIND FIRST. Stopping an action does not undo it — every
 * bone stays wherever the last evaluated frame left it. A pose only names twenty bones, so the
 * other forty-two (including Root and Body, which Idle animates) keep the residue of whichever clip
 * happened to be playing. The symptom is a figure that is subtly rotated and never the same twice,
 * which reads as a broken pose rather than as a stale skeleton. Restoring bind makes a pose mean
 * the same thing every time it is applied.
 */
const applyPose = () => {
    if (!figure) return
    if (mixer) { mixer.stopAllAction(); action = null }
    for (const b of bindPose) {
        b.bone.position.copy(b.position)
        b.bone.quaternion.copy(b.quaternion)
        b.bone.scale.copy(b.scale)
    }
    const resolved = resolvePose(currentPose(), restRotations)
    for (const name of POSE_BONES) {
        const bone = figure.bone(name)
        const r = resolved[name]
        if (bone && r) bone.rotation.set(r[0], r[1], r[2])
    }
    paintTouched()
}

const applyMode = () => {
    if (state.mode === "clip") applyClip()
    else applyPose()
}

const gestureLabel = (g) => {
    const pose = poses[g]
    if (pose && Object.keys(pose).length) return `${g} ✓`
    if (CLIP_FOR_GESTURE[g]) return `${g} (clip: ${CLIP_FOR_GESTURE[g]})`
    return `${g} — unposed`
}

// The lab cannot write to the repo, so the authored table leaves the same way the GIF export does:
// as a download the user drops into render3d/poses.json. Round-tripping through a file is also what
// makes the pose table reviewable in a diff, which a binary or an in-browser store would not be.
const exportPoses = () => {
    const out = {}
    for (const g of GESTURES) {
        const p = compactPose(poses[g] ?? {})
        if (Object.keys(p).length) out[g] = p
    }
    const blob = new Blob([JSON.stringify(out, null, 2) + "\n"], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "poses.json"
    a.click()
    URL.revokeObjectURL(a.href)
}

const rebuild = () => {
    applyAppearance()
    applyPost()
}

// ── controls ─────────────────────────────────────────────────────────────────────────────────
const kit = createControlKit({ onChange: () => rebuild() })
const { el, addRow, slider, select, checkbox, sprayPopdown } = kit

const group = (parent, title) => {
    const fs = el("fieldset")
    fs.appendChild(el("legend", { textContent: title }))
    parent.appendChild(fs)
    return fs
}

// The 16 C64 colours by their canonical names, for the wildcard and skin pickers. These pick a
// PALETTE ENTRY, unlike the spray slots which pick a dither PATTERN — a distinction that is easy to
// lose and confusing when lost, so the two use visibly different widgets.
const C64_NAMES = ["black", "white", "red", "cyan", "purple", "green", "blue", "yellow",
    "orange", "brown", "lt.red", "dk.grey", "grey", "lt.green", "lt.blue", "lt.grey"]
const colourOptions = () => C64_NAMES.map((n, i) => [String(i), `${i} ${n}`])

const buildControls = () => {
    const panel = document.getElementById("controls")
    panel.textContent = ""

    const motion = group(panel, "motion")
    addRow(motion, "driven by", select([["clip", "pack clip"], ["gesture", "habitat gesture"]],
        () => state.mode, (v) => { state.mode = v; applyMode(); buildControls() }))
    addRow(motion, "clip", select(
        [["(none)", "(none)"], ...figure.clipNames.map((c) => [c, c])],
        () => state.clip, (v) => { state.clip = v; state.mode = "clip"; applyClip() }))
    addRow(motion, "playing", checkbox(() => state.playing,
        (v) => { state.playing = v; if (action) action.paused = !v }))
    addRow(motion, "speed", ...slider(0.1, 2, 0.05, () => state.speed, (v) => { state.speed = v }))
    addRow(motion, "yaw", ...slider(0, 359, 1, () => state.yaw, (v) => { state.yaw = v }))
    addRow(motion, "autorotate", checkbox(() => state.autorotate, (v) => { state.autorotate = v }))

    // ── the pose editor ──────────────────────────────────────────────────────────────────────
    // Twenty bones times three axes is sixty sliders, which is unusable. One bone at a time with a
    // list of what has been touched is the same expressive power and fits on screen — and matches
    // how the poses actually get made, one limb at a time against the original cel.
    const ed = group(panel, "gesture / pose editor")
    addRow(ed, "gesture", select(GESTURES.map((g) => [g, gestureLabel(g)]),
        () => state.gesture, (v) => { state.gesture = v; state.mode = "gesture"; applyPose() }))
    addRow(ed, "bone", select(POSE_BONES.map((b) => [b, b]),
        () => state.editBone, (v) => { state.editBone = v }))
    for (const [i, axis] of ["pitch x", "yaw y", "roll z"].entries()) {
        addRow(ed, axis, ...slider(-180, 180, 1,
            () => currentPose()[state.editBone]?.[i] ?? 0,
            (v) => {
                const p = currentPose()
                p[state.editBone] = [...(p[state.editBone] ?? [0, 0, 0])]
                p[state.editBone][i] = v
                state.mode = "gesture"
                applyPose()
            }))
    }
    const touched = el("div", { className: "sub", style: "margin:2px 0 0" })
    paintTouched = () => {
        const p = compactPose(currentPose())
        const keys = Object.keys(p)
        touched.textContent = keys.length
            ? keys.map((k) => `${k} ${p[k].join(",")}`).join("  ·  ")
            : "(nothing posed yet)"
    }
    paintTouched()
    ed.appendChild(touched)

    const buttons = el("div", { className: "row" })
    const btn = (label, fn) => {
        const b = el("button", { type: "button", textContent: label })
        b.addEventListener("click", () => { fn(); state.mode = "gesture"; applyPose(); kit.sync() })
        buttons.appendChild(b)
    }
    btn("clear bone", () => { delete currentPose()[state.editBone] })
    btn("clear pose", () => { poses[state.gesture] = {} })
    btn("export poses.json", () => exportPoses())
    ed.appendChild(buttons)

    const cov = poseCoverage(poses)
    ed.appendChild(el("div", {
        className: "sub", style: "margin:6px 0 0",
        textContent: `${cov.authored.length} authored · ${cov.fromClip.length} from clips · ` +
            `${cov.missing.length} to do`,
    }))

    const colour = group(panel, "habitat colours")
    addRow(colour, "legs", sprayPopdown(() => state.legs, (v) => { state.legs = v }))
    addRow(colour, "torso", sprayPopdown(() => state.torso, (v) => { state.torso = v }))
    addRow(colour, "sleeves", sprayPopdown(() => state.arms, (v) => { state.arms = v }))
    addRow(colour, "wildcard", select(colourOptions(),
        () => String(state.wildcard), (v) => { state.wildcard = Number(v) }))
    addRow(colour, "skin", select(colourOptions(),
        () => String(state.skin), (v) => { state.skin = Number(v) }))

    const dither = group(panel, "dither")
    // Screen space is what the C64 did — rgbaFromNibble keys the pattern on the pixel's position on
    // screen, so the dither stays put and the figure moves through it, which shimmers. Object space
    // glues the pattern to the surface: stable, but it reads as a texture rather than as a dither.
    // Neither is wrong; that is why this is a switch.
    addRow(dither, "space", select([["screen", "screen (C64)"], ["object", "object (glued)"]],
        () => state.ditherSpace, (v) => { state.ditherSpace = v }))
    addRow(dither, "cell px", ...slider(1, 8, 1, () => state.ditherScale, (v) => { state.ditherScale = v }))
    addRow(dither, "obj scale", ...slider(5, 120, 1, () => state.objDitherScale, (v) => { state.objDitherScale = v }))

    const retro = group(panel, "retro dial")
    addRow(retro, "pixel size", ...slider(1, 8, 1, () => state.pixelSize, (v) => { state.pixelSize = v }))
    addRow(retro, "quantize", checkbox(() => state.quantize, (v) => { state.quantize = v }))
    addRow(retro, "outline", checkbox(() => state.outline, (v) => { state.outline = v }))
    addRow(retro, "shading", checkbox(() => state.shade, (v) => { state.shade = v }))

    const head = group(panel, "head")
    addRow(head, "head", select(headList.map((h) => [h, h.replace(/^heads\/|\.bin$/g, "")]),
        () => state.head, (v) => setHead(v)))
    addRow(head, "hair", sprayPopdown(() => state.hair, (v) => { state.hair = v; rebuildHead() }))
    // 0.45 is what the C64 actually did (a 26-unit head on a 58-unit avatar); 0.13 is human.
    // The interesting answers are in between, which is why the slider spans both.
    addRow(head, "head/body", ...slider(0.08, 0.5, 0.01,
        () => state.headFraction, (v) => { state.headFraction = v }))
    addRow(head, "lift", ...slider(-8, 8, 0.25, () => state.headLift, (v) => { state.headLift = v }))
    addRow(head, "pack head", checkbox(() => state.packHead, (v) => { state.packHead = v }))

    const hand = group(panel, "held object")
    addRow(hand, "prop", select(
        [["(none)", "(none)"], ...propList.map((p) => [p, p.replace(/^props\/|\.bin$/g, "")])],
        () => state.held, (v) => setHeld(v)))
    addRow(hand, "size", ...slider(0.04, 0.4, 0.01,
        () => state.heldFraction, (v) => { state.heldFraction = v }))
}

const buildReport = () => {
    const host = document.getElementById("matreport")
    host.textContent = ""
    const roles = ["transparent", "wild (clothing)", "black (outline)", "skin"]
    const table = el("table")
    const head = el("tr")
    for (const h of ["mesh", "material", "role", "decided by"]) head.appendChild(el("th", { textContent: h }))
    table.appendChild(head)
    for (const r of figure.report) {
        const tr = el("tr")
        tr.appendChild(el("td", { textContent: r.mesh ?? "" }))
        tr.appendChild(el("td", { textContent: r.name }))
        tr.appendChild(el("td", { textContent: roles[r.nibble] ?? String(r.nibble) }))
        tr.appendChild(el("td", { textContent: r.rule, className: r.rule === "override" ? "" : "warn" }))
        table.appendChild(tr)
    }
    host.appendChild(table)
}

// ── main loop ────────────────────────────────────────────────────────────────────────────────
const tick = () => {
    requestAnimationFrame(tick)
    if (!figure) return
    const dt = clock.getDelta()
    // Only advance the mixer in clip mode. In gesture mode an update would overwrite the pose with
    // whatever the last action left bound, and the sliders would appear to do nothing.
    if (mixer && state.playing && state.mode === "clip") mixer.update(dt * state.speed)
    if (state.autorotate) {
        state.yaw = (state.yaw + dt * 40) % 360
        kit.sync()
    }
    pivot.rotation.y = THREE.MathUtils.degToRad(state.yaw)
    postfx.render(scene, camera)
}

// ── the automation seam ──────────────────────────────────────────────────────────────────────
// check-figure3d.mjs drives the lab through this rather than through the DOM, so the check and the
// panel can never disagree about what is being rendered.
const labApi = {
    get ready() { return !!figure },
    getState: () => ({ ...state }),
    async setState(patch) {
        const headChanged = "head" in patch && patch.head !== state.head
        const heldChanged = "held" in patch && patch.held !== state.held
        Object.assign(state, patch)
        if (headChanged) await setHead(patch.head)
        else if ("hair" in patch) rebuildHead()
        if (heldChanged) await setHeld(patch.held)
        if ("clip" in patch || "gesture" in patch || "mode" in patch) applyMode()
        rebuild()
        kit.sync()
    },
    /** Render one frame synchronously at the current settings, autorotate suspended. */
    renderNow() {
        pivot.rotation.y = THREE.MathUtils.degToRad(state.yaw)
        if (mixer && state.mode === "clip") mixer.update(0)
        postfx.render(scene, camera)
    },
    /** Set one bone's delta directly — how the axis probe and any scripted authoring drive it. */
    poseBone(gesture, bone, xyz) {
        state.mode = "gesture"
        state.gesture = gesture
        ;(poses[gesture] ??= {})[bone] = xyz
        applyPose()
    },
    clearPose(gesture) {
        poses[gesture] = {}
        if (state.gesture === gesture) applyPose()
    },
    coverage: () => poseCoverage(poses),
    report: () => figure?.report ?? [],
    /** Rig geometry in world space — what the head mount has to be reconciled against. */
    rigProbe() {
        if (!figure) return null
        figure.root.updateWorldMatrix(true, true)
        const deg = (q) => {
            const e = new THREE.Euler().setFromQuaternion(q, "XYZ")
            return [e.x, e.y, e.z].map((v) => Math.round(THREE.MathUtils.radToDeg(v)))
        }
        const of = (o) => o ? {
            pos: o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3)),
            rotDeg: deg(o.getWorldQuaternion(new THREE.Quaternion())),
            scale: o.getWorldScale(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3)),
        } : null
        return {
            figureBox: { min: figure.box.min.toArray(), max: figure.box.max.toArray() },
            figureHeight,
            headHullHeight,
            root: of(figure.root),
            headBone: of(figure.headBone),
            neckBone: of(figure.bone("Neck")),
            chestBone: of(figure.bone("Chest")),
            handBone: of(figure.handBone),
            shoulderL: of(figure.bone("Shoulder.L")),
            shoulderR: of(figure.bone("Shoulder.R")),
            headMeshScale: headMesh ? headMesh.scale.x : null,
            mode: state.mode,
            yaw: state.yaw,
        }
    },
    clipNames: () => figure?.clipNames ?? [],
    boneNames: () => figure ? [...figure.bones.keys()] : [],
    /** The pose-editor bones as [name, resolved?] — a false means the rig is missing that joint. */
    poseBoneStatus: () => (figure?.poseBones() ?? []).map(({ name, bone }) => [name, !!bone]),
    canvasSize: () => ({ w: canvas.width, h: canvas.height }),
}
window.__figure3d = labApi

// ── boot ─────────────────────────────────────────────────────────────────────────────────────
const boot = async () => {
    try {
        figure = await loadFigure(THREE, GLTFLoader, FIGURE_URL)
    } catch (e) {
        statusEl.className = "bad"
        statusEl.textContent = `could not load ${FIGURE_URL}\n${e.message}`
        window.__figure3dError = String(e?.stack ?? e)
        throw e
    }

    // Centre on the figure's own middle so the turntable spins rather than orbits.
    const c = figure.box.getCenter(new THREE.Vector3())
    figure.root.position.sub(c)
    pivot.add(figure.root)

    figureHeight = Math.max(figure.box.max.y - figure.box.min.y, 1e-6)
    const sphere = figure.box.getBoundingSphere(new THREE.Sphere())
    frameCamera(sphere.radius)

    // Rest rotations FIRST, before the mixer exists and before anything is played. A pose is a
    // delta from rest, so a rest captured after a clip has run once is not rest — it is frame 0 of
    // whatever happened to play, and every authored pose would be silently offset by it.
    bindPose = [...figure.bones.values()].map((bone) => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }))
    for (const name of POSE_BONES) {
        const bone = figure.bone(name)
        if (bone) restRotations[name] = [bone.rotation.x, bone.rotation.y, bone.rotation.z]
    }
    poses = await (await fetch(new URL("../render3d/poses.json", import.meta.url))).json()

    mixer = new THREE.AnimationMixer(figure.root)
    clock = new THREE.Clock()

    // The mount is a child of the Head BONE, so the head follows the animation for free — a nod, a
    // walk bob and a bow all carry it without a single line of follow code.
    headMount = new THREE.Group()
    if (figure.headBone) {
        figure.root.updateWorldMatrix(true, true)
        const neck = figure.bone("Neck") ?? figure.headBone
        headToNeckWorld = figure.headBone.getWorldPosition(new THREE.Vector3()).y
            - neck.getWorldPosition(new THREE.Vector3()).y
        figure.headBone.add(headMount)
    } else {
        statusEl.textContent = "no Head bone on this rig — the Habitat head has nowhere to mount"
    }

    heldMount = new THREE.Group()
    heldScale = new THREE.Group()
    heldMount.add(heldScale)
    if (figure.handBone) figure.handBone.add(heldMount)

    headList = await (await getFile(HEADS_INDEX)).json()
    propList = await (await getFile(PROPS_INDEX)).json()
    await setHead(state.head)
    await setHeld(state.held)

    buildControls()
    buildReport()
    rebuild()
    applyMode()

    const unexplained = figure.report.filter((r) => r.rule !== "override").length
    statusEl.className = unexplained ? "warn" : "ok"
    statusEl.textContent =
        `${figure.meshes.length} primitives · ${figure.bones.size} bones · ${figure.clipNames.length} clips` +
        (unexplained ? ` · ${unexplained} material(s) classified by heuristic, not by the table` : "")

    tick()
    window.__figure3dReady = true
}

boot().catch((e) => { window.__figure3dError ??= String(e?.stack ?? e) })
