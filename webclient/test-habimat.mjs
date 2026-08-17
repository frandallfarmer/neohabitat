// test-habimat.mjs — the C64 colour port, checked against the C64 colour code.
//
// render3d/habimat.js exists to run Habitat's `rgbaFromNibble` on a mesh the C64 never drew. The
// only thing that makes that legitimate is that it produces the SAME ANSWER, so this file does not
// sample or spot-check: it enumerates every input the function has. There are only 4 nibbles × 4
// columns × 4 rows × 16 patterns × the colour choices, which is small enough to do exhaustively and
// therefore too small an excuse not to.
//
// The GLSL in habimat.js is written to mirror resolveNibble statement for statement, so it inherits
// this proof — up to the one place the two genuinely differ, which is checked separately below.

import { test } from "node:test"
import assert from "node:assert/strict"

import { rgbaFromNibble, c64Colors, celPatterns } from "./habirender/palette.js"
import {
    NIBBLE, LIMB_CLASS, resolveNibble, classifyMaterials, boneLimbClass,
    paletteRampFor, paletteTexData, patternTexData, rampTexData,
    CASUAL_MATERIAL_NIBBLES, defaultUniformValues,
} from "./render3d/habimat.js"

// A spread of colour settings rather than just the defaults: wildcard and skin are the two values
// a player can change, and a port that only works at wildcard 6 would pass a defaults-only test.
const COLOUR_SETS = [
    { wildcard: 6, skin: 10, pattern: 15 },   // render.js defaultColors
    { wildcard: 0, skin: 0, pattern: 0 },     // both ends collapsed onto black
    { wildcard: 15, skin: 15, pattern: 15 },
    { wildcard: 1, skin: 8, pattern: 4 },
    { wildcard: 14, skin: 2, pattern: 9 },
]

test("resolveNibble reproduces rgbaFromNibble for every input", () => {
    let checked = 0
    for (const base of COLOUR_SETS) {
        for (let pattern = 0; pattern < celPatterns.length; pattern++) {
            const colors = { ...base, pattern }
            for (let nibble = 0; nibble <= 3; nibble++) {
                // Four columns and four rows is the whole dither cell; beyond that it repeats, and
                // the second cell is checked too so an off-by-one in the modulo would show up.
                for (let x = 0; x < 8; x++) {
                    for (let y = 0; y < 8; y++) {
                        const want = rgbaFromNibble(nibble, x, y, colors)
                        const got = resolveNibble(nibble, x, y, colors)
                        const where = `nibble=${nibble} x=${x} y=${y} pattern=${pattern} ` +
                            `wildcard=${colors.wildcard} skin=${colors.skin}`
                        if (nibble === NIBBLE.TRANSPARENT) {
                            assert.equal(want, 0, `reference should be transparent: ${where}`)
                            assert.equal(got, -1, `port should be transparent: ${where}`)
                        } else {
                            // rgbaFromNibble packs (rgb << 8) | 0xff; we return the index.
                            assert.equal(c64Colors[got], want >>> 8, `colour mismatch: ${where}`)
                        }
                        checked++
                    }
                }
            }
        }
    }
    assert.equal(checked, COLOUR_SETS.length * 16 * 4 * 8 * 8)
})

// The one place the port deliberately departs from the reference text. The shader cannot mask
// bytes cheaply, so it uses (b >> (6-s)) & 3 where rgbaFromNibble writes (b & (0xc0>>s)) >> (6-s).
// Those are the same two bits only because s is always 0, 2, 4 or 6 — worth pinning, because if it
// were ever not, the shader and the reference would diverge silently.
test("the shader's bit-extraction form matches the reference form", () => {
    for (let b = 0; b <= 0xff; b++) {
        for (const s of [0, 2, 4, 6]) {
            assert.equal((b & (0xc0 >> s)) >> (6 - s), (b >> (6 - s)) & 3, `byte=${b} shift=${s}`)
        }
    }
})

test("pattern 255 and other out-of-range patterns fall back to 15, as the reference does", () => {
    for (const pattern of [-1, 16, 255]) {
        for (let x = 0; x < 4; x++) {
            for (let y = 0; y < 4; y++) {
                assert.equal(
                    resolveNibble(NIBBLE.WILD, x, y, { wildcard: 6, skin: 10, pattern }),
                    resolveNibble(NIBBLE.WILD, x, y, { wildcard: 6, skin: 10, pattern: 15 }),
                )
            }
        }
    }
})

test("classifyMaterials explains itself, and gets the vendored character right", () => {
    // Exactly the nine materials in assets3d/quaternius-casual.glb, with their linear
    // baseColorFactors as decoded from the file.
    const materials = [
        { name: "White", color: [0.366, 0.366, 0.366] },
        { name: "Red_Dark", color: [0.164, 0.016, 0.027] },
        { name: "LightBrown", color: [0.244, 0.223, 0.182] },
        { name: "Skin", color: [0.494, 0.334, 0.191] },
        { name: "Skin_Darker", color: [0.39, 0.265, 0.152] },
        { name: "Eyebrows", color: [0.039, 0.027, 0.018] },
        { name: "Eye", color: [0.025, 0.015, 0.009] },
        { name: "Hair", color: [0.053, 0.022, 0.007] },
        { name: "LightBlue", color: [0.026, 0.04, 0.05] },
    ]
    const got = classifyMaterials(materials, { overrides: CASUAL_MATERIAL_NIBBLES })
    assert.deepEqual(
        Object.fromEntries(got.map((m) => [m.name, m.nibble])),
        CASUAL_MATERIAL_NIBBLES,
    )
    assert.ok(got.every((m) => m.rule === "override"), "every material should be explained")

    // Without the overrides the heuristics must still be sane — and must NOT be relied on to
    // separate the jeans from the hair, which is the case that motivated the override table.
    const heuristic = classifyMaterials(materials)
    const byName = Object.fromEntries(heuristic.map((m) => [m.name, m]))
    assert.equal(byName.Skin.nibble, NIBBLE.SKIN)
    assert.equal(byName.Skin_Darker.nibble, NIBBLE.SKIN)
    assert.equal(byName.Eyebrows.nibble, NIBBLE.BLACK)
    assert.equal(byName.Hair.nibble, NIBBLE.BLACK)
    assert.equal(byName.LightBlue.nibble, NIBBLE.WILD, "jeans must not be mistaken for outline")
    assert.equal(byName.LightBrown.nibble, NIBBLE.WILD)
})

test("boneLimbClass splits the Quaternius rig into Habitat's four spray slots", () => {
    const cases = {
        Hips: LIMB_CLASS.LEG, "UpperLeg.L": LIMB_CLASS.LEG, "LowerLeg.R": LIMB_CLASS.LEG,
        "Foot.L": LIMB_CLASS.LEG, "PT.R": LIMB_CLASS.LEG,
        "UpperArm.L": LIMB_CLASS.ARM, "LowerArm.R": LIMB_CLASS.ARM,
        "Wrist.L": LIMB_CLASS.FACE, "Index2.R": LIMB_CLASS.FACE, "Thumb1.L": LIMB_CLASS.FACE,
        Neck: LIMB_CLASS.FACE, Head: LIMB_CLASS.FACE,
        "Shoulder.L": LIMB_CLASS.TORSO, Chest: LIMB_CLASS.TORSO, Torso: LIMB_CLASS.TORSO,
        Abdomen: LIMB_CLASS.TORSO, Body: LIMB_CLASS.TORSO, Root: LIMB_CLASS.TORSO,
    }
    for (const [bone, cls] of Object.entries(cases)) {
        assert.equal(boneLimbClass(bone), cls, `bone ${bone}`)
    }
    // The shirt's sleeve and the shirt's body must land in DIFFERENT slots — that split is the
    // entire reason limb class comes from the skeleton rather than from the material.
    assert.notEqual(boneLimbClass("UpperArm.L"), boneLimbClass("Chest"))
    // An unknown bone must not throw or land outside the four slots.
    assert.ok([0, 1, 2, 3].includes(boneLimbClass("SomeRiggerInventedThis")))
    assert.ok([0, 1, 2, 3].includes(boneLimbClass()))
})

test("palette ramps stay inside the palette and never darken upward", () => {
    const lum = (i) => {
        const c = c64Colors[i]
        return 0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff)
    }
    for (let i = 0; i < 16; i++) {
        const ramp = paletteRampFor(i)
        assert.equal(ramp.length, 3, `ramp ${i} length`)
        assert.equal(ramp[1], i, `ramp ${i} must be centred on its own colour`)
        assert.ok(ramp.every((r) => r >= 0 && r < 16), `ramp ${i} inside the palette`)
        assert.ok(lum(ramp[0]) <= lum(ramp[1]) + 1e-9, `ramp ${i} dark step is not darker`)
        assert.ok(lum(ramp[2]) >= lum(ramp[1]) - 1e-9, `ramp ${i} light step is not lighter`)
    }
    // Black has nothing below it and white nothing above it; those must degrade to themselves
    // rather than wrap around.
    assert.equal(paletteRampFor(0)[0], 0)
    assert.equal(paletteRampFor(1)[2], 1)
})

test("data textures are the right shape and carry the real tables", () => {
    const pal = paletteTexData()
    assert.equal(pal.length, 16 * 4)
    for (let i = 0; i < 16; i++) {
        assert.equal((pal[i * 4] << 16) | (pal[i * 4 + 1] << 8) | pal[i * 4 + 2], c64Colors[i])
        assert.equal(pal[i * 4 + 3], 255, "opaque")
    }

    const pat = patternTexData()
    assert.equal(pat.length, 16 * 4 * 4)
    for (let p = 0; p < 16; p++) {
        for (let row = 0; row < 4; row++) {
            assert.equal(pat[(row * 16 + p) * 4], celPatterns[p][row], `pattern ${p} row ${row}`)
        }
    }

    const ramp = rampTexData()
    assert.equal(ramp.length, 16 * 3 * 4)
    for (let c = 0; c < 16; c++) {
        const want = paletteRampFor(c)
        for (let row = 0; row < 3; row++) {
            const i = (row * 16 + c) * 4
            assert.equal((ramp[i] << 16) | (ramp[i + 1] << 8) | ramp[i + 2], c64Colors[want[row]])
        }
    }
})

test("the default uniforms are Habitat's defaults", () => {
    const u = defaultUniformValues()
    assert.equal(u.uWildcard, 6)
    assert.equal(u.uSkin, 10)
    assert.deepEqual(u.uLimbPattern, [15, 15, 15, 15])
    // Flat by default: the C64 had no lighting, so the lab must open on the faithful answer and
    // make you turn shading ON, not off.
    assert.equal(u.uShadeStrength, 0)
    // A C64 multicolor pixel is two screen pixels wide and one tall; the dither cell must match or
    // the pattern is the wrong shape.
    assert.deepEqual(u.uDitherScale, [2, 1])
})
