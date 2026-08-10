// check-avatar3d.mjs — cardinal fidelity check for the solid avatar, through the REAL pipeline.
//
// Deliberately NOT named test-*.mjs: `node --test` must stay dependency-free, and this needs a
// browser. habirender/region.js imports preact and (in node) node-canvas, so the only way to
// compare the solid against the shipping compositor — rather than against a second copy of it —
// is to run both in a page. avatar3d.html already does exactly that for its diff panel; this
// script just drives it and reads the numbers back out of window.__avatarvox.
//
//   node webclient/check-avatar3d.mjs [--url URL] [--headed] [--screenshot DIR] [--gif DIR]
//
// Needs `playwright` importable from this directory; it is NOT a webclient dependency (the
// webclient deliberately has none) so this check is opt-in and separate from `npm test`.
//
// WHAT IS ASSERTED, AND WHY IT IS NOT "ALL FOUR VIEWS ARE EXACT":
//
//   front ("+z")  STRICT — must be alpha-identical to composeAvatarFrameAt. This holds today for
//                 every body, head and pose in the table below.
//   side  ("-x")  BUDGETED — the side cels are drawn 2–8 rows taller than the front cels (see the
//                 sideProfileRows note in voxel.js), so no single solid can reproduce both. The
//                 measured error is ~8% at stand and ~14% mid-walk; the budget here is a
//                 REGRESSION GUARD, not a fidelity claim.
//   back  ("-z")  REPORTED ONLY — a solid's shadow is the same along +Z and −Z, so the front and
//                 back silhouettes cannot both be honoured. The back art paints, it does not carve.
//   "+x"          REPORTED ONLY — the mirrored side, compared against a mirrored reference.

import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFile, writeFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const argv = process.argv.slice(2)
const arg = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : fallback
}
const HEADED = argv.includes("--headed")

const MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".json": "application/json", ".css": "text/css", ".bin": "application/octet-stream",
    ".woff2": "font/woff2", ".map": "application/json", ".mud": "text/plain", ".m": "text/plain",
}

// A throwaway static server rooted at webclient/, so the check needs no external setup.
const serve = () => new Promise((resolve) => {
    const server = createServer(async (req, res) => {
        try {
            const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "")
            const path = join(HERE, rel === "/" ? "avatar3d.html" : rel)
            const buf = await readFile(path)
            res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" })
            res.end(buf)
        } catch {
            res.writeHead(404).end("not found")
        }
    })
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }))
})

// Headroom over the worst measured case (mid-walk, ~14%): tight enough to catch a real regression,
// loose enough that it is not re-asserting the art disagreement as a bug.
const SIDE_BUDGET_PCT = 20

// Applied under every case so the cases stay INDEPENDENT — lab state is shared in the page, and a
// leftover `female: true` from an earlier case would silently change the one after it.
const BASE = {
    style: 0, head: "heads/head0.bin", pose: "stand", frameIndex: 0,
    height: 2, female: false, hair: 6, legs: 6, torso: 6, arms: 8, roundLimb: 0.45, roundHead: 1,
}

// A spread of figures rather than one: registration bugs hide behind a single lucky combination.
// head0 has only two cel states (its back reuses the front); wizard0 composes several cels; the
// non-human bodies are headless (headCelNumber 255) and exercise the no-head path.
const CASES = [
    { label: "human / head0 / stand", style: 0, head: "heads/head0.bin", pose: "stand" },
    { label: "human / wizard0 / stand", style: 0, head: "heads/wizard0.bin", pose: "stand" },
    { label: "human / tiger / stand", style: 0, head: "heads/tiger.bin", pose: "stand" },
    { label: "human / head0 / walk f0", style: 0, head: "heads/head0.bin", pose: "walk", frameIndex: 0 },
    { label: "human / head0 / walk f3", style: 0, head: "heads/head0.bin", pose: "walk", frameIndex: 3 },
    { label: "human / head0 / sit", style: 0, head: "heads/head0.bin", pose: "sit" },
    { label: "human / head0 / tall female", style: 0, head: "heads/head0.bin", pose: "stand", height: 6, female: true },
    { label: "spider (headed)", style: 2, head: "heads/head0.bin", pose: "stand" },
    { label: "penguin (headless)", style: 1, head: "heads/head0.bin", pose: "stand" },
    { label: "tentacle (headless)", style: 6, head: "heads/head0.bin", pose: "stand" },
]

const run = async () => {
    const { server, port } = await serve()
    const url = arg("--url", `http://127.0.0.1:${port}/avatar3d.html`)
    const browser = await chromium.launch({ headless: !HEADED, args: ["--use-gl=swiftshader"] })
    const page = await browser.newPage()
    const consoleErrors = []
    page.on("pageerror", (e) => consoleErrors.push(String(e)))
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })

    await page.goto(url, { waitUntil: "load" })
    await page.waitForFunction(() => window.__avatarvoxReady || window.__avatarvoxError, null, { timeout: 30000 })
    const bootError = await page.evaluate(() => window.__avatarvoxError)
    if (bootError) throw new Error(`lab failed to boot:\n${bootError}`)

    const failures = []
    for (const c of CASES) {
        const result = await page.evaluate(async (c) => {
            const api = window.__avatarvoxLab
            await api.setState(c)   // loads a new body/head file — must be awaited before rebuilding
            return api.rebuild()
        }, { ...BASE, ...c })
        const pct = (r) => r.total ? (100 * r.alphaMismatch / r.total) : 0
        const line = result.map((r) => `${r.label}:${r.alphaMismatch}`).join("  ")
        const partCount = await page.evaluate(() => window.__avatarvox.parts.length)

        const bad = []
        const front = result.find((r) => r.axis === "+z")
        const side = result.find((r) => r.axis === "-x")
        if (front && front.alphaMismatch > 0) {
            bad.push(`${c.label}: FRONT is not pixel-exact — ${front.alphaMismatch}/${front.total} px ` +
                `(${pct(front).toFixed(1)}%). This one is meant to be zero.`)
        }
        if (side && pct(side) > SIDE_BUDGET_PCT) {
            bad.push(`${c.label}: side error ${pct(side).toFixed(1)}% exceeds the ` +
                `${SIDE_BUDGET_PCT}% regression budget (${side.alphaMismatch}/${side.total} px)`)
        }
        if (partCount === 0) bad.push(`${c.label}: produced no parts at all`)

        console.log(`${bad.length === 0 ? "ok  " : "FAIL"} ${c.label.padEnd(28)} ` +
            `parts=${String(partCount).padStart(2)}  ${line}   side ${pct(side).toFixed(1)}%`)
        failures.push(...bad)
    }

    // --screenshot: numbers say the silhouette is right; they cannot say the figure reads well in
    // the round. Emit a yaw sweep so the in-between angles — the whole point of the experiment —
    // can actually be looked at.
    const shotDir = arg("--screenshot", null)
    if (shotDir) {
        await page.evaluate(async () => {
            await window.__avatarvoxLab.setState({ style: 0, head: "heads/wizard0.bin", pose: "stand" })
            window.__avatarvoxLab.rebuild()
        })
        await page.screenshot({ path: join(shotDir, "lab.png"), fullPage: true })
        for (const yaw of [0, 30, 45, 60, 90, 135, 180, 225, 270]) {
            await page.evaluate((y) => window.__avatarvoxLab.setYaw(y), yaw)
            await page.waitForTimeout(120)
            await page.locator("#stage").screenshot({ path: join(shotDir, `yaw-${String(yaw).padStart(3, "0")}.png`) })
        }
        console.log(`screenshots → ${shotDir}`)
    }

    // --gif: export a real rotation, hand the bytes back to the browser's OWN decoder, and write
    // the file out. A hand-written GIF encoder can produce something that round-trips through a
    // hand-written decoder and is still not a valid GIF; only an independent decoder settles it.
    const gifDir = arg("--gif", null)
    if (gifDir) {
        for (const [name, patch, opts] of [
            ["rotation-opaque", { head: "heads/wizard0.bin" }, { frames: 24, delayMs: 60 }],
            ["rotation-transparent", { head: "heads/wizard0.bin" }, { frames: 24, delayMs: 60, transparent: true }],
            ["rotation-walk", { head: "heads/head0.bin", pose: "walk" }, { frames: 36, delayMs: 60 }],
        ]) {
            const r = await page.evaluate(async ({ patch, opts }) => {
                await window.__avatarvoxLab.setState(patch)
                window.__avatarvoxLab.rebuild()
                const out = await window.__avatarvoxLab.exportGif(opts)
                // Decode it with the browser, from the exact bytes we are about to write to disk.
                const blob = await (await fetch(`data:image/gif;base64,${out.base64}`)).blob()
                try {
                    const bmp = await createImageBitmap(blob)
                    out.decoded = { width: bmp.width, height: bmp.height }
                } catch (e) {
                    out.decodeError = String(e)
                }
                return out
            }, { patch: { ...BASE, ...patch }, opts })

            const file = join(gifDir, `${name}.gif`)
            await writeFile(file, Buffer.from(r.base64, "base64"))
            const okSize = r.decoded && r.decoded.width === r.width && r.decoded.height === r.height
            const verdict = r.decodeError ? `UNDECODABLE (${r.decodeError})`
                : okSize ? "decodes ok" : `decoded to the wrong size ${r.decoded.width}×${r.decoded.height}`
            console.log(`gif ${name.padEnd(22)} ${r.frames} frames · ${r.width}×${r.height} · ` +
                `${r.colors} colours${r.exact ? "" : " (APPROXIMATED)"} · ` +
                `${(r.bytes / 1024).toFixed(0)} KB · ${verdict}`)
            if (!okSize) failures.push(`${name}.gif: ${verdict}`)
            if (!r.exact) failures.push(`${name}.gif: colours were approximated — the render is no longer pure C64 palette`)
        }
        console.log(`gifs → ${gifDir}`)
    }

    // Colour agreement is reported, never asserted: where limbs overlap, the solid resolves by real
    // depth while the 2D compositor paints in frontFacingLimbOrder, so some disagreement is
    // expected and is itself informative.
    const colour = await page.evaluate(() => window.__avatarvox.summary
        .filter((s) => s.strict)
        .map((s) => `${s.label} ${s.colorMismatch}/${s.total}`).join("  "))
    console.log(`\ncolour agreement (last case, reported not asserted): ${colour}`)

    await browser.close()
    server.close()

    if (consoleErrors.length) {
        console.error("\npage errors:")
        for (const e of consoleErrors) console.error("  " + e)
    }
    if (failures.length) {
        console.error("\ncheck-avatar3d: FAILED")
        for (const f of failures) console.error("  " + f)
        process.exit(1)
    }
    if (consoleErrors.length) process.exit(1)
    console.log("\ncheck-avatar3d: ok")
}

run().catch((e) => { console.error(e); process.exit(1) })
