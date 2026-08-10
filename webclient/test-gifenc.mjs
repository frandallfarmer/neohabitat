// Node tests for the GIF encoder (render3d/gifenc.js).
//
// The load-bearing part is LZW: an off-by-one in when the code width grows produces a file that
// still *looks* structurally fine and decodes to garbage. So this round-trips through a decoder
// written here from the DECODER side of the spec — it widens when its table reaches 1<<codeSize,
// which is the rule the encoder has to stay in lockstep with, derived independently rather than
// mirrored from the encoder.
//
// A decoder written by the same hand can of course share a misreading, so check-avatar3d.mjs
// --gif also makes Chromium decode a real exported rotation. That is the actual arbiter; this is
// the fast one.

import { lzwEncode, encodeGif, quantizeFrames } from "./render3d/gifenc.js"

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${a}, want ${b})`)

// ── a GIF LZW decoder, written to the spec, not to the encoder ───────────────────────────────
const lzwDecode = (bytes, minCodeSize) => {
    const clearCode = 1 << minCodeSize
    const endCode = clearCode + 1
    let bitPos = 0
    const readCode = (codeSize) => {
        let code = 0
        for (let i = 0; i < codeSize; i++) {
            const byte = bytes[bitPos >> 3]
            if (byte === undefined) return null
            code |= ((byte >> (bitPos & 7)) & 1) << i   // LSB-first
            bitPos++
        }
        return code
    }

    const out = []
    let table = null
    let codeSize = minCodeSize + 1
    let prev = null
    const reset = () => {
        table = []
        for (let i = 0; i < clearCode; i++) table.push([i])
        table.push(null, null)  // clear + end occupy indices but decode to nothing
        codeSize = minCodeSize + 1
        prev = null
    }
    reset()

    for (;;) {
        const code = readCode(codeSize)
        if (code === null || code === endCode) break
        if (code === clearCode) { reset(); continue }

        let entry
        if (code < table.length && table[code]) entry = table[code]
        else if (code === table.length && prev) entry = [...prev, prev[0]]
        else throw new Error(`lzwDecode: bad code ${code} (table ${table.length}, codeSize ${codeSize})`)

        out.push(...entry)
        if (prev) {
            table.push([...prev, entry[0]])
            // Widen as soon as the table can produce a code that no longer fits.
            if (table.length === (1 << codeSize) && codeSize < 12) codeSize++
        }
        prev = entry
    }
    return out
}

// ── LZW round-trips, including across a code-width growth and a table reset ──────────────────
{
    const cases = {
        "empty": [],
        "single pixel": [5],
        "flat run": new Array(600).fill(3),
        "two colours alternating": Array.from({ length: 1000 }, (_, i) => i % 2),
        "short repeating motif": Array.from({ length: 4000 }, (_, i) => [1, 2, 3, 2][i % 4]),
        "16-colour ramp": Array.from({ length: 5000 }, (_, i) => i % 16),
    }
    for (const [name, pixels] of Object.entries(cases)) {
        for (const minCodeSize of [2, 4, 8]) {
            if (pixels.some((p) => p >= (1 << minCodeSize))) continue
            const decoded = lzwDecode(lzwEncode(pixels, minCodeSize), minCodeSize)
            eq(decoded.length, pixels.length, `${name} @${minCodeSize}: length round-trips`)
            assert(decoded.every((v, i) => v === pixels[i]), `${name} @${minCodeSize}: pixels round-trip`)
        }
    }

    // Enough distinct sequences to blow past 4096 codes and force a mid-stream clear.
    const big = Array.from({ length: 90000 }, (_, i) => (i * 7 + (i >> 5) * 13) % 16)
    const decodedBig = lzwDecode(lzwEncode(big, 4), 4)
    eq(decodedBig.length, big.length, "table-overflow case round-trips (length)")
    assert(decodedBig.every((v, i) => v === big[i]), "table-overflow case round-trips (pixels)")
}

// ── LZW actually compresses (a sanity floor, not a benchmark) ────────────────────────────────
{
    const flat = new Array(10000).fill(7)
    const encoded = lzwEncode(flat, 4)
    assert(encoded.length < flat.length / 10, `a flat field should compress hard (got ${encoded.length} bytes)`)
}

// ── container structure ──────────────────────────────────────────────────────────────────────
{
    const width = 4, height = 3
    const palette = [[0, 0, 0], [255, 0, 0], [0, 255, 0]]
    const frames = [
        { indices: new Uint8Array(width * height).fill(0), delayMs: 60 },
        { indices: new Uint8Array(width * height).fill(1), delayMs: 60 },
        { indices: new Uint8Array(width * height).fill(2), delayMs: 60 },
    ]
    const gif = encodeGif({ width, height, palette, frames })

    eq(String.fromCharCode(...gif.slice(0, 6)), "GIF89a", "magic")
    eq(gif[6] | (gif[7] << 8), width, "screen width is little-endian")
    eq(gif[8] | (gif[9] << 8), height, "screen height is little-endian")
    assert((gif[10] & 0x80) !== 0, "global colour table flag is set")
    // 3 colours → the table must round up to the next power of two (4 entries → size field 1).
    eq(gif[10] & 0x07, 1, "GCT size field covers 4 entries")
    eq(gif[13], 0, "first palette entry is black")
    eq(gif[16], 255, "second palette entry is red")
    eq(gif[13 + 3 * 4 - 3 + 1], 0, "unused palette slots are zero-filled")
    eq(gif[gif.length - 1], 0x3b, "trailer")

    const text = String.fromCharCode(...gif)
    assert(text.includes("NETSCAPE2.0"), "loop extension present")
    let gceCount = 0
    for (let i = 0; i < gif.length - 1; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9) gceCount++
    eq(gceCount, 3, "one graphic control extension per frame")
    let imgCount = 0
    for (let i = 0; i < gif.length; i++) if (gif[i] === 0x2c) imgCount++
    assert(imgCount >= 3, "at least one image descriptor per frame")
}

// ── transparency flips disposal, because otherwise frames composite into a smear ─────────────
{
    const base = { width: 2, height: 2, palette: [[0, 0, 0], [1, 2, 3]], frames: [{ indices: new Uint8Array(4), delayMs: 50 }] }
    const opaque = encodeGif(base)
    const clear = encodeGif({ ...base, transparentIndex: 0 })
    const gceAt = (g) => { for (let i = 0; i < g.length - 1; i++) if (g[i] === 0x21 && g[i + 1] === 0xf9) return i + 3 }
    eq(opaque[gceAt(opaque)] & 0x01, 0, "opaque: transparency flag clear")
    eq((opaque[gceAt(opaque)] >> 2) & 0x07, 1, "opaque: disposal 1 (do not dispose)")
    eq(clear[gceAt(clear)] & 0x01, 1, "transparent: transparency flag set")
    eq((clear[gceAt(clear)] >> 2) & 0x07, 2, "transparent: disposal 2 (restore to background)")
}

// ── delays are hundredths of a second ────────────────────────────────────────────────────────
{
    const gif = encodeGif({
        width: 1, height: 1, palette: [[0, 0, 0], [1, 1, 1]],
        frames: [{ indices: new Uint8Array(1), delayMs: 80 }],
    })
    let i = 0
    while (!(gif[i] === 0x21 && gif[i + 1] === 0xf9)) i++
    eq(gif[i + 4] | (gif[i + 5] << 8), 8, "80 ms → 8 hundredths")
}

// ── quantization is EXACT for palette art, and reserves index 0 for the background ───────────
{
    const px = (...rgbs) => {
        const d = new Uint8ClampedArray(rgbs.length * 4)
        rgbs.forEach(([r, g, b], i) => { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255 })
        return d
    }
    const bg = [0x4a, 0x4a, 0x55]
    const frames = [
        px(bg, [0xc4, 0x6c, 0x71], [0x2e, 0x2c, 0x9b], bg),
        px(bg, bg, [0x00, 0x00, 0x00], [0xc4, 0x6c, 0x71]),
    ]
    const q = quantizeFrames(frames, { backgroundRGB: bg })
    assert(q.exact, "a C64-palette rotation quantizes with no approximation")
    eq(q.backgroundIndex, 0, "background is reserved at index 0")
    eq(q.palette.length, 4, "exactly the distinct colours present")
    eq(q.indexed.length, 2, "one indexed frame per input frame")
    eq(q.indexed[0][0], 0, "background pixels map to index 0")
    eq(q.indexed[0][1], q.indexed[1][3], "the same colour gets the same index across frames")
    assert(q.indexed[0][1] !== q.indexed[0][2], "different colours get different indices")

    // Round-trip the whole pipeline: quantize → encode → LZW-decode the first frame's pixels.
    const gif = encodeGif({ width: 2, height: 2, palette: q.palette, frames: q.indexed.map((indices) => ({ indices, delayMs: 60 })) })
    assert(gif.length > 0 && gif[gif.length - 1] === 0x3b, "pipeline produces a terminated GIF")
}

// ── guards ───────────────────────────────────────────────────────────────────────────────────
{
    const ok = { width: 1, height: 1, palette: [[0, 0, 0], [1, 1, 1]], frames: [{ indices: new Uint8Array(1) }] }
    const throws = (fn, what) => {
        try { fn(); throw new Error(`expected a throw: ${what}`) } catch (e) {
            assert(!/^expected a throw/.test(e.message), e.message)
        }
    }
    throws(() => encodeGif({ ...ok, frames: [] }), "no frames")
    throws(() => encodeGif({ ...ok, width: 0 }), "zero width")
    throws(() => encodeGif({ ...ok, palette: new Array(300).fill([0, 0, 0]) }), "palette over 256")
}

console.log("test-gifenc: ok")
