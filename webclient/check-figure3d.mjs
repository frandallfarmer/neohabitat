// check-figure3d.mjs — headless checks for the Habitat Figure Lab.
//
//   node webclient/check-figure3d.mjs [--url URL] [--headed] [--screenshot [DIR]]
//
// Deliberately NOT named test-*.mjs, for the same reason check-avatar3d.mjs is not: `node --test`
// stays dependency-free, and this needs a browser and a GPU. `playwright` must be importable from
// this directory; it is not a webclient dependency.
//
// WHAT IS ASSERTED, AND WHY THESE TWO THINGS.
//
// "Does it look like Habitat?" is not checkable and this file does not pretend otherwise. But the
// two properties the retro pass is *for* are exactly checkable, and if either silently stops
// holding, the look is gone and nothing else would notice:
//
//   PALETTE   with quantize on, every pixel in the framebuffer must be one of the 16 colodore
//             colours. Antialiasing, tone mapping, an sRGB conversion sneaking back in, a stray
//             lit material — all of them break this and all of them are invisible by eye until the
//             image is subtly not-C64 any more.
//   PIXEL GRID at pixel size N the framebuffer must be constant over every aligned N×N block. This
//             is what distinguishes a genuinely low-resolution render from a full-resolution one
//             with a blur, and it is easy to lose to a half-texel offset in the composite.
//
// Everything else here is a smoke check: the figure loads, the rig is the rig we vendored, the
// clips are the clips, and no pose leaves the frame empty.

import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFile, mkdir } from "node:fs/promises"
import { extname, join, normalize, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"

import { c64Colors } from "./habirender/palette.js"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const argv = process.argv.slice(2)
const arg = (name, fallback) => {
    const i = argv.indexOf(name)
    if (i < 0) return fallback
    const next = argv[i + 1]
    return (next === undefined || next.startsWith("--")) ? true : next
}
const HEADED = argv.includes("--headed")
const DEFAULT_OUT = join(HERE, "out")

const outDir = async (flag) => {
    if (!flag) return null
    const dir = flag === true ? DEFAULT_OUT : resolvePath(flag)
    await mkdir(dir, { recursive: true })
    return dir
}

const MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".json": "application/json", ".css": "text/css", ".bin": "application/octet-stream",
    ".glb": "model/gltf-binary", ".woff2": "font/woff2", ".map": "application/json",
}

const serve = () => new Promise((resolve) => {
    const server = createServer(async (req, res) => {
        try {
            const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "")
            const path = join(HERE, rel === "/" ? "figure3d.html" : rel)
            const buf = await readFile(path)
            res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" })
            res.end(buf)
        } catch {
            res.writeHead(404).end("not found")
        }
    })
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }))
})

// What we vendored, from assets3d/CREDITS.md. Pinned here so that swapping the GLB for another
// character is a decision someone has to make on purpose rather than something that quietly
// changes what the lab is showing.
const EXPECT = {
    primitives: 10,
    bones: 62,
    clips: 24,
    someClips: ["Idle", "Walk", "Wave", "Punch_Right"],
}

// Four yaws and a spread of settings. The palette and grid properties must hold at every one of
// them — a violation that only appears at yaw 45 is exactly the kind a single-angle check misses.
// Palette indices every ordinary frame must contain, by the role that puts them there. If skin
// stops appearing, the arms have gone missing; if the wildcard stops appearing, the clothing has;
// if dark grey stops appearing, the clear colour has been colour-managed again (it once quantized
// to black, which hid the black keyline against a black background and looked like nothing at all
// was wrong). Each is a real failure that renders as "still looks fine, roughly".
const ROLE_COLOURS = { wildcard: 6, skin: 10, outline: 0, background: 11 }

const CASES = [
    { label: "idle, front, px3", clip: "Idle", yaw: 0, pixelSize: 3, mustContain: ROLE_COLOURS },
    { label: "idle, side, px3", clip: "Idle", yaw: 90, pixelSize: 3 },
    { label: "idle, back, px3", clip: "Idle", yaw: 180, pixelSize: 3 },
    { label: "idle, 45°, px3", clip: "Idle", yaw: 45, pixelSize: 3 },
    { label: "walk, front, px1", clip: "Walk", yaw: 0, pixelSize: 1 },
    { label: "walk, 45°, px6", clip: "Walk", yaw: 45, pixelSize: 6 },
    { label: "wave, side, px4", clip: "Wave", yaw: 90, pixelSize: 4 },
    { label: "idle, object dither", clip: "Idle", yaw: 30, pixelSize: 3, ditherSpace: "object" },
    { label: "idle, shading on", clip: "Idle", yaw: 30, pixelSize: 3, shade: true },
    { label: "idle, no outline", clip: "Idle", yaw: 0, pixelSize: 3, outline: false },
    // Heads. head0 has only two cel states (its back reuses the front); wizard0 composes several
    // cels and has a distinct back; tiger is a non-human head. Between them they cover the shapes
    // the hull code has to handle, and they must survive the palette check too — the head's colours
    // come off the cels rather than out of the shader, so it is a second, independent path into the
    // framebuffer and a second chance to leak a non-palette colour.
    { label: "head0, front, px3", clip: "Idle", yaw: 0, pixelSize: 3, head: "heads/head0.bin" },
    { label: "wizard0, 45°, px3", clip: "Idle", yaw: 45, pixelSize: 3, head: "heads/wizard0.bin" },
    { label: "tiger, side, px3", clip: "Idle", yaw: 90, pixelSize: 3, head: "heads/tiger.bin" },
    // Authored gestures. These go through a different path from the clips — bind-pose restore plus
    // euler deltas — and the thing that would break silently is the restore, which leaves the
    // figure subtly rotated by whatever played last. Running a gesture straight after a clip case
    // is what would catch that.
    { label: "gesture wave", mode: "gesture", gesture: "wave", yaw: 20, pixelSize: 3 },
    { label: "gesture bend_over", mode: "gesture", gesture: "bend_over", yaw: 20, pixelSize: 3 },
    { label: "gesture point", mode: "gesture", gesture: "point", yaw: 20, pixelSize: 3 },
    // A held prop is a third independent path into the framebuffer (a CanvasTexture rather than the
    // shader or the hull's vertex colours), so it gets its own palette check.
    { label: "holding a torch", clip: "Idle", yaw: 20, pixelSize: 3,
        held: "props/torch0.bin", heldFraction: 0.25 },
]

// Applied under every case so the cases stay INDEPENDENT. Lab state lives in the page, so a `held`
// or a `gesture` left over from an earlier case would silently change the one after it — and the
// case that then failed would not be the case with the bug.
const BASE = {
    autorotate: false, playing: false, quantize: true, outline: true, shade: false,
    ditherSpace: "screen", legs: 6, torso: 6, arms: 8, wildcard: 6, skin: 10,
    head: "heads/head0.bin", hair: 6, headFraction: 0.3, headLift: 0, packHead: false,
    mode: "clip", clip: "Idle", held: "(none)", heldFraction: 0.14,
}

/**
 * Read the canvas back and measure it. Runs IN THE PAGE and returns only numbers — 520×520×4 bytes
 * across the playwright bridge per case would dominate the runtime for no benefit.
 */
const measure = (palette) => {
    const canvas = document.getElementById("stage")
    const off = document.createElement("canvas")
    off.width = canvas.width
    off.height = canvas.height
    const ctx = off.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(canvas, 0, 0)
    const { data, width: w, height: h } = ctx.getImageData(0, 0, off.width, off.height)

    const allowed = new Set(palette)
    const px = window.__figure3d.getState().pixelSize
    const seen = new Set()
    let offPalette = 0
    let offPaletteExample = null
    const blocks = new Map()
    let blockViolations = 0

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
            seen.add(rgb)
            if (!allowed.has(rgb)) {
                offPalette++
                if (!offPaletteExample) {
                    offPaletteExample = { x, y, rgb: "#" + rgb.toString(16).padStart(6, "0") }
                }
            }
            // gl_FragCoord counts from the BOTTOM, so a block's row index is measured from there
            // too. Doing it from the top would report false violations whenever the canvas height
            // is not a multiple of the pixel size.
            const key = `${Math.floor(x / px)},${Math.floor((h - 1 - y) / px)}`
            const prev = blocks.get(key)
            if (prev === undefined) blocks.set(key, rgb)
            else if (prev !== rgb) blockViolations++
        }
    }

    // A frame that is entirely background would satisfy both properties trivially, so the count of
    // distinct colours doubles as "something was actually drawn".
    return {
        distinct: seen.size,
        present: [...seen],
        offPalette,
        offPaletteExample,
        blockViolations,
        pixelSize: px,
        width: w,
        height: h,
    }
}

const run = async () => {
    const { server, port } = await serve()
    const fallbackUrl = `http://127.0.0.1:${port}/figure3d.html`
    const urlArg = arg("--url", fallbackUrl)
    const url = typeof urlArg === "string" ? urlArg : fallbackUrl
    const shotDir = await outDir(arg("--screenshot", false))

    const browser = await chromium.launch({ headless: !HEADED, args: ["--use-gl=swiftshader"] })
    const page = await browser.newPage()
    const consoleErrors = []
    page.on("pageerror", (e) => consoleErrors.push(String(e)))
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })

    const failures = []
    const fail = (msg) => { failures.push(msg); console.log(`FAIL ${msg}`) }

    await page.goto(url, { waitUntil: "load" })
    await page.waitForFunction(() => window.__figure3dReady || window.__figure3dError, null, { timeout: 60000 })
    const bootError = await page.evaluate(() => window.__figure3dError)
    if (bootError) throw new Error(`lab failed to boot:\n${bootError}`)

    // ── the rig is the rig we vendored ───────────────────────────────────────────────────────
    const rig = await page.evaluate(() => ({
        clips: window.__figure3d.clipNames(),
        bones: window.__figure3d.boneNames(),
        poseBones: window.__figure3d.poseBoneStatus(),
        report: window.__figure3d.report().map((r) => ({ name: r.name, nibble: r.nibble, rule: r.rule })),
    }))

    if (rig.clips.length !== EXPECT.clips) {
        fail(`clip count ${rig.clips.length}, expected ${EXPECT.clips}`)
    }
    for (const c of EXPECT.someClips) {
        if (!rig.clips.includes(c)) fail(`missing clip "${c}"`)
    }
    if (rig.bones.length !== EXPECT.bones) {
        fail(`bone count ${rig.bones.length}, expected ${EXPECT.bones}`)
    }
    // Every bone the pose editor wants a slider for must actually resolve. This is checked through
    // habirig's normalized lookup rather than by string equality, because GLTFLoader mangles
    // `UpperArm.L` into `UpperArmL` and a literal comparison would only be testing the mangling.
    for (const [name, ok] of rig.poseBones) {
        if (!ok) fail(`pose bone "${name}" does not resolve on this rig`)
    }
    if (rig.report.length !== EXPECT.primitives) {
        fail(`primitive count ${rig.report.length}, expected ${EXPECT.primitives}`)
    }
    // Every material should be answered by the override table, not guessed at. A material that
    // falls through to a heuristic is a material nobody looked at.
    for (const r of rig.report) {
        if (r.rule !== "override") fail(`material "${r.name}" classified by ${r.rule}, not by the table`)
    }
    console.log(`rig: ${rig.report.length} primitives, ${rig.bones.length} bones, ${rig.clips.length} clips`)

    // ── the two properties ───────────────────────────────────────────────────────────────────
    const palette = c64Colors
    for (const c of CASES) {
        const { label, mustContain, ...patch } = c
        await page.evaluate(async (s) => {
            // setState is async because switching head decodes a .bin; rendering before it settles
            // would screenshot the previous head and quietly pass.
            await window.__figure3d.setState(s)
            window.__figure3d.renderNow()
        }, { ...BASE, ...patch })

        const m = await page.evaluate(measure, palette)

        const notes = []
        if (m.offPalette > 0) {
            fail(`${label}: ${m.offPalette} pixel(s) outside the C64 palette ` +
                `(first at ${m.offPaletteExample.x},${m.offPaletteExample.y} = ${m.offPaletteExample.rgb})`)
        }
        if (m.blockViolations > 0) {
            fail(`${label}: pixel grid broken — ${m.blockViolations} pixel(s) differ from their ` +
                `${m.pixelSize}×${m.pixelSize} block`)
        }
        if (m.distinct < 2) {
            fail(`${label}: frame is a single flat colour — nothing was drawn`)
        }
        for (const [role, index] of Object.entries(mustContain ?? {})) {
            if (!m.present.includes(c64Colors[index])) {
                fail(`${label}: no ${role} pixels (palette ${index}, ` +
                    `#${c64Colors[index].toString(16).padStart(6, "0")}) anywhere in the frame`)
            }
        }
        console.log(
            `ok   ${label.padEnd(24)} colours=${String(m.distinct).padStart(2)} ` +
            `offPalette=${m.offPalette} gridBreaks=${m.blockViolations}${notes.join(" ")}`)

        if (shotDir) {
            const file = join(shotDir, `figure3d-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`)
            await page.locator("#stage").screenshot({ path: file })
        }
    }

    if (consoleErrors.length) {
        for (const e of consoleErrors) fail(`console: ${e}`)
    }

    await browser.close()
    server.close()

    if (failures.length) {
        console.log(`\ncheck-figure3d: ${failures.length} failure(s)`)
        process.exitCode = 1
    } else {
        console.log(`\ncheck-figure3d: ok${shotDir ? ` (screenshots in ${shotDir})` : ""}`)
    }
}

run().catch((e) => { console.error(e); process.exitCode = 1 })
