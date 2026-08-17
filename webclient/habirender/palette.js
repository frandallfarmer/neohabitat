// palette.js — the C64 palette, the dither patterns, and the one function that turns a cel nibble
// into a colour. Pure data and pure arithmetic; no preact, no canvas.
//
// Split out of render.js because render3d/habimat.js ports `rgbaFromNibble` to GLSL and proves the
// port by running the two against each other under `node --test` — which it cannot do while
// importing that function also imports the view layer. Keeping the *reference implementation*
// reachable from node is the point; a copy of it would defeat the exercise.
//
// render.js re-exports every name here, so existing importers are unaffected.

// C64 RGB values generated from https://www.colodore.com/ with default settings
export const c64Colors = [
    0x000000, 0xffffff, 0x813338, 0x75cec8, 0x8e3c97, 0x56ac4d,
    0x2e2c9b, 0xedf171, 0x8e5029, 0x553800, 0xc46c71, 0x4a4a4a,
    0x7b7b7b, 0xa9ff9f, 0x706deb, 0xb2b2b2
]

// from paint.m:447
export const celPatterns = [
    [0x00, 0x00, 0x00, 0x00],
    [0xaa, 0xaa, 0xaa, 0xaa],
    [0xff, 0xff, 0xff, 0xff],
    [0xe2, 0xe2, 0xe2, 0xe2],
    [0x8b, 0xbe, 0x0f, 0xcc],
    [0xee, 0x00, 0xee, 0x00],
    [0xf0, 0xf0, 0x0f, 0x0f],
    [0x22, 0x88, 0x22, 0x88],
    [0x32, 0x88, 0x23, 0x88],
    [0x00, 0x28, 0x3b, 0x0c],
    [0x33, 0xcc, 0x33, 0xcc],
    [0x08, 0x80, 0x0c, 0x80],
    [0x3f, 0x3f, 0xf3, 0xf3],
    [0xaa, 0x3f, 0xaa, 0xf3],
    [0xaa, 0x00, 0xaa, 0x00],
    [0x55, 0x55, 0x55, 0x55]
]

export const defaultColors = {
    wildcard: 6,
    skin: 10,
    pattern: 15
}

export const rgbaFromNibble = (nibble, x, y, colors) => {
    const { wildcard, pattern, skin } = colors
    const patternColors = [6, wildcard, 0, skin]
    // TODO: What is pattern 255?
    const patbyte = celPatterns[pattern < 0 || pattern > 15 ? 15 : pattern][y % 4]
    let color
    if (nibble == 0) { // transparent
        return 0
    } else if (nibble == 1) { // wild
        const shift = (x % 4) * 2
        color = patternColors[(patbyte & (0xc0 >> shift)) >> (6 - shift)]
    } else {
        color = patternColors[nibble]
    }
    return (c64Colors[color] << 8) | 0xff
}
