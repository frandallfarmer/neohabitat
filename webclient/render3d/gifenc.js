// gifenc.js — a small, dependency-free animated-GIF encoder for C64-palette frames.
//
// Why write one instead of vendoring gif.js: the expensive, bulky part of a general GIF encoder is
// COLOUR QUANTIZATION — reducing millions of colours to 256. We have the opposite problem. A
// Habitat frame is drawn from the 16-entry C64 palette (render.js c64Colors) with no lighting and
// no antialiasing, so a whole rotation contains about seventeen distinct colours. The palette is
// simply the set of colours present, the mapping is exact, and nothing is lost. That turns the
// encoder into a header writer plus LZW, which is small enough to own and to test.
//
// The webclient has no dependencies and no build step, and this keeps it that way.
//
// Spec: GIF89a (https://www.w3.org/Graphics/GIF/spec-gif89a.txt). Multi-byte values are
// little-endian; LZW codes are packed LSB-first and then cut into sub-blocks of at most 255 bytes.

const GIF_MAX_COLORS = 256

// ── LZW ──────────────────────────────────────────────────────────────────────────────────────
// Variable-width LZW as GIF uses it: codes start one bit wider than the pixel depth, the width
// grows as the table fills, and a clear code resets the table when it reaches 4096 entries.
export const lzwEncode = (indices, minCodeSize) => {
    const clearCode = 1 << minCodeSize
    const endCode = clearCode + 1
    const out = []
    let bitBuffer = 0
    let bitCount = 0

    const emit = (code, codeSize) => {
        bitBuffer |= code << bitCount        // LSB-first
        bitCount += codeSize
        while (bitCount >= 8) {
            out.push(bitBuffer & 0xff)
            bitBuffer >>= 8
            bitCount -= 8
        }
    }

    let dict = new Map()
    let codeSize = minCodeSize + 1
    let nextCode = endCode + 1

    emit(clearCode, codeSize)
    if (indices.length === 0) {
        emit(endCode, codeSize)
        if (bitCount > 0) out.push(bitBuffer & 0xff)
        return Uint8Array.from(out)
    }

    let cur = indices[0]
    for (let i = 1; i < indices.length; i++) {
        const k = indices[i]
        const key = (cur << 8) | k          // safe: cur < 4096, k < 256
        const found = dict.get(key)
        if (found !== undefined) {
            cur = found
            continue
        }
        emit(cur, codeSize)
        if (nextCode < 4096) {
            dict.set(key, nextCode)
            nextCode++
            // Widen once the next code no longer fits — the decoder widens at the same moment,
            // which is the whole reason this must be exact.
            if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++
        } else {
            emit(clearCode, codeSize)
            dict = new Map()
            codeSize = minCodeSize + 1
            nextCode = endCode + 1
        }
        cur = k
    }
    emit(cur, codeSize)
    emit(endCode, codeSize)
    if (bitCount > 0) out.push(bitBuffer & 0xff)
    return Uint8Array.from(out)
}

// GIF carries image data in sub-blocks: a length byte (1..255) then that many bytes, ending with a
// zero-length block.
const subBlocks = (bytes) => {
    const out = []
    for (let i = 0; i < bytes.length; i += 255) {
        const chunk = bytes.subarray(i, Math.min(i + 255, bytes.length))
        out.push(chunk.length, ...chunk)
    }
    out.push(0)
    return out
}

// A Global Color Table must hold a power of two entries, at least 2.
const gctSizeFor = (n) => {
    let bits = 1
    while ((1 << bits) < Math.max(n, 2)) bits++
    return bits // table holds 1<<bits entries; the packed field stores bits-1
}

/**
 * Encode indexed frames as one animated GIF.
 *
 *   palette          [[r,g,b], …] up to 256 entries
 *   frames           [{ indices: Uint8Array(width*height), delayMs }]
 *   loop             0 = forever (the default), n = repeat n times
 *   transparentIndex palette index to render as transparent, or null for an opaque GIF
 *
 * Returns a Uint8Array ready for a Blob.
 */
export const encodeGif = ({ width, height, palette, frames, loop = 0, transparentIndex = null }) => {
    if (!width || !height) throw new Error("encodeGif: width and height are required")
    if (palette.length > GIF_MAX_COLORS) throw new Error(`encodeGif: ${palette.length} colours exceeds 256`)
    if (!frames.length) throw new Error("encodeGif: no frames")

    const bytes = []
    const u8 = (v) => bytes.push(v & 0xff)
    const u16 = (v) => { bytes.push(v & 0xff, (v >> 8) & 0xff) }   // little-endian
    const str = (s) => { for (const ch of s) bytes.push(ch.charCodeAt(0)) }

    const bits = gctSizeFor(palette.length)
    const tableLen = 1 << bits

    str("GIF89a")
    u16(width); u16(height)
    u8(0x80 | ((bits - 1) << 4) | (bits - 1))  // GCT present, colour resolution, GCT size
    u8(0)                                      // background colour index
    u8(0)                                      // pixel aspect ratio: unspecified
    for (let i = 0; i < tableLen; i++) {
        const c = palette[i] ?? [0, 0, 0]
        u8(c[0]); u8(c[1]); u8(c[2])
    }

    // NETSCAPE2.0 application extension — the de-facto loop control.
    str("\x21\xFF\x0B"); str("NETSCAPE2.0")
    u8(3); u8(1); u16(loop); u8(0)

    const minCodeSize = Math.max(2, bits)
    for (const frame of frames) {
        // Graphic Control Extension. Disposal 2 ("restore to background") is required when frames
        // are transparent, or each frame would be composited on top of the last and the rotation
        // would smear into a solid blob. Opaque frames fully overwrite, so disposal 1 is fine.
        const transparent = transparentIndex != null
        const disposal = transparent ? 2 : 1
        str("\x21\xF9"); u8(4)
        u8((disposal << 2) | (transparent ? 1 : 0))
        u16(Math.max(0, Math.round((frame.delayMs ?? 60) / 10)))  // GIF delays are hundredths
        u8(transparent ? transparentIndex : 0)
        u8(0)

        str("\x2C")                       // Image Descriptor
        u16(0); u16(0); u16(width); u16(height)
        u8(0)                             // no local colour table, not interlaced

        u8(minCodeSize)
        bytes.push(...subBlocks(lzwEncode(frame.indices, minCodeSize)))
    }

    u8(0x3B) // trailer
    return Uint8Array.from(bytes)
}

/**
 * Map RGBA frames onto a shared palette.
 *
 * Exact by construction for our art: the renderer draws flat, unlit, unantialiased faces straight
 * from the C64 palette, so the set of distinct colours in a whole rotation is tiny. If a frame ever
 * does exceed 256 colours (a colour-managed round-trip nudging a channel by one, say), the rarest
 * colours are folded into their nearest surviving neighbour rather than failing the export.
 *
 * `backgroundRGB` (optional [r,g,b]) is given its own reserved index so the caller can pass it as
 * `transparentIndex`.
 */
export const quantizeFrames = (rgbaFrames, { backgroundRGB = null } = {}) => {
    const counts = new Map()
    const key = (r, g, b) => (r << 16) | (g << 8) | b
    for (const data of rgbaFrames) {
        for (let i = 0; i < data.length; i += 4) {
            const k = key(data[i], data[i + 1], data[i + 2])
            counts.set(k, (counts.get(k) ?? 0) + 1)
        }
    }

    // Background first so its index is stable and predictable (0 when supplied).
    const ordered = []
    const seen = new Set()
    if (backgroundRGB) {
        const bk = key(backgroundRGB[0], backgroundRGB[1], backgroundRGB[2])
        ordered.push(bk); seen.add(bk)
    }
    for (const [k] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        if (!seen.has(k)) { ordered.push(k); seen.add(k) }
    }

    const kept = ordered.slice(0, GIF_MAX_COLORS)
    const palette = kept.map((k) => [(k >> 16) & 0xff, (k >> 8) & 0xff, k & 0xff])
    const index = new Map(kept.map((k, i) => [k, i]))

    const nearest = (r, g, b) => {
        let best = 0, bestD = Infinity
        for (let i = 0; i < palette.length; i++) {
            const [pr, pg, pb] = palette[i]
            const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
            if (d < bestD) { bestD = d; best = i }
        }
        return best
    }

    let exact = true
    const indexed = rgbaFrames.map((data) => {
        const out = new Uint8Array(data.length / 4)
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const k = key(data[i], data[i + 1], data[i + 2])
            const hit = index.get(k)
            if (hit !== undefined) { out[p] = hit; continue }
            exact = false
            const n = nearest(data[i], data[i + 1], data[i + 2])
            index.set(k, n)          // memoize: the fallback is O(palette) per NEW colour only
            out[p] = n
        }
        return out
    })

    return {
        palette,
        indexed,
        exact,                                   // false ⇒ some colour was approximated
        backgroundIndex: backgroundRGB ? 0 : null,
    }
}
