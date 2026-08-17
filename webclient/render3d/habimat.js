// habimat.js — Habitat's coloring model, ported off the C64 and onto an arbitrary 3D mesh.
//
// `habirender/render.js rgbaFromNibble` is the whole of how a Habitat avatar is colored, and it is
// only four values deep:
//
//     patternColors = [6, wildcard, 0, skin]        // 6 is a fixed dark blue
//     nibble 0 → transparent
//     nibble 1 → WILD: two bits out of celPatterns[pattern][y%4], selected by (x%4)*2,
//                index into patternColors — i.e. a 4×4 ordered dither between blue,
//                the player's chosen colour, black and skin
//     nibble 2 → colour 0 (black)
//     nibble 3 → skin
//
// That is *not* a texture in the modern sense. It is an index map plus three player-controlled
// values, which is exactly why a Habitat avatar could be recoloured by a spray can in 1986 on a
// machine with 38911 bytes free. Everything in this file exists to make a glTF mesh obey it.
//
// THE PORT IS TESTED, NOT ASSERTED. `resolveNibble` below must agree with `rgbaFromNibble` for
// every combination of nibble, x%4, y%4 and pattern — test-habimat.mjs proves it exhaustively. The
// GLSL is written to mirror `resolveNibble` line for line, so the shader inherits that proof.
//
// TWO INPUTS, TWO DIFFERENT SOURCES. A surface needs both:
//
//   uNibble     which of the four roles this surface plays — from the glTF MATERIAL
//   aLimbClass  which of Habitat's four pattern slots colours it — from the DOMINANT BONE
//
// They cannot come from the same place. The Quaternius shirt is one material but its short sleeves
// belong to Habitat's ARM slot while its body belongs to TORSO, and the bare arm below the sleeve
// is skin on the same mesh. Material answers "is this cloth, skin, or outline"; the skeleton
// answers "which garment". See habirig.js for where each is read.
//
// The nibble is a uniform rather than an attribute because GLTFLoader already gives us one mesh per
// glTF primitive and a primitive has exactly one material — so nibble is constant over a draw call
// by construction. Limb class is not, hence the attribute.
//
// No Three import here on purpose — same rule as voxel.js, so `node --test` can reach it.

// ../habirender/palette.js and NOT render.js: same tables, same rgbaFromNibble, but without the
// preact import that would put this module out of reach of `node --test`.
import { celPatterns, c64Colors } from "../habirender/palette.js"

// ── the four nibble roles (render.js rgbaFromNibble) ─────────────────────────────────────────
export const NIBBLE = { TRANSPARENT: 0, WILD: 1, BLACK: 2, SKIN: 3 }

// ── Habitat's four pattern slots (equates.m; region.js limbPatternsFromMod returns them in this
// order, and PATTERN_FOR_LIMB maps body cels onto them) ──────────────────────────────────────
export const LIMB_CLASS = { LEG: 0, TORSO: 1, ARM: 2, FACE: 3 }

/**
 * Resolve one texel to a C64 palette index, or -1 for transparent.
 *
 * A line-for-line port of rgbaFromNibble, differing only in returning the palette INDEX rather
 * than a packed RGBA — the index is what the shader needs, and keeping it symbolic is what lets
 * the ramp shading pick a neighbouring palette entry later.
 *
 * x and y are texel coordinates and must be non-negative, which is the only regime rgbaFromNibble
 * is ever called in (bitmap coordinates). Negative inputs are not meaningful and are not defined
 * here either.
 */
export const resolveNibble = (nibble, x, y, { wildcard = 6, skin = 10, pattern = 15 } = {}) => {
    if (nibble === NIBBLE.TRANSPARENT) return -1
    const patternColors = [6, wildcard, 0, skin]
    if (nibble !== NIBBLE.WILD) return patternColors[nibble]
    const p = (pattern < 0 || pattern > 15) ? 15 : pattern
    const patbyte = celPatterns[p][y % 4]
    const shift = (x % 4) * 2
    // (b & (0xc0 >> s)) >> (6 - s) is the same two bits as (b >> (6 - s)) & 3 for s ∈ {0,2,4,6};
    // the shader uses the second form because GLSL has no cheap byte masking.
    return patternColors[(patbyte & (0xc0 >> shift)) >> (6 - shift)]
}

// ── material → nibble ────────────────────────────────────────────────────────────────────────

// Explicit answers for the character we vendored. Heuristics get you started on an unknown asset;
// they are not what you ship, because the luminances here do not separate cleanly — Quaternius
// bakes dark linear base colours, and the jeans (LightBlue, relative luminance 0.038) sit *between*
// the hair (0.028) and the shoe accent (0.048). No threshold survives that. Names do.
export const CASUAL_MATERIAL_NIBBLES = {
    LightBlue: NIBBLE.WILD,     // jeans        → legs
    LightBrown: NIBBLE.WILD,    // shirt        → torso + sleeves, split by bone
    White: NIBBLE.WILD,         // shoe body    → legs
    Red_Dark: NIBBLE.BLACK,     // shoe accent  → reads as the cel outline it resembles
    Skin: NIBBLE.SKIN,
    Skin_Darker: NIBBLE.SKIN,
    Eyebrows: NIBBLE.BLACK,
    Eye: NIBBLE.BLACK,
    Hair: NIBBLE.BLACK,
}

// Match WORDS, not substrings. The first version of this tested /brow/ and duly classified the
// shirt — "LightBrown" — as an eyebrow. Splitting on separators *and* camel-case boundaries turns
// "LightBrown" into Light + Brown and "Skin_Darker" into Skin + Darker, which is what the naming
// convention actually means.
const nameTokens = (name) =>
    name.split(/[^A-Za-z]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean).map((s) => s.toLowerCase())

const SKIN_TOKENS = new Set(["skin", "flesh", "face", "hand", "hands"])
const DARK_TOKENS = new Set([
    "outline", "black", "eye", "eyes", "eyebrow", "eyebrows",
    "eyelash", "eyelashes", "lash", "lashes", "pupil", "pupils", "hair",
])

const relLuminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * Assign a nibble to every glTF material.
 *
 * Returns one entry per material carrying the nibble AND the rule that produced it, because when a
 * figure comes out miscoloured the first question is always "why did this material get that role",
 * and the lab prints the answer rather than making you re-derive it.
 *
 * `materials` is [{ name, color: [r,g,b] }] with colour in glTF's LINEAR baseColorFactor space.
 */
export const classifyMaterials = (materials, { overrides = {} } = {}) =>
    materials.map(({ name = "", color = [0.5, 0.5, 0.5] }) => {
        if (Object.hasOwn(overrides, name)) return { name, nibble: overrides[name], rule: "override" }
        const tokens = nameTokens(name)
        if (tokens.some((t) => SKIN_TOKENS.has(t))) return { name, nibble: NIBBLE.SKIN, rule: "name:skin" }
        if (tokens.some((t) => DARK_TOKENS.has(t))) return { name, nibble: NIBBLE.BLACK, rule: "name:dark" }
        if (relLuminance(color) < 0.02) return { name, nibble: NIBBLE.BLACK, rule: "luminance" }
        return { name, nibble: NIBBLE.WILD, rule: "default" }
    })

// ── bone → limb class ────────────────────────────────────────────────────────────────────────

// Quaternius' universal rig, mapped onto Habitat's four spray slots. Order matters: the first
// pattern that matches wins, so the arm rules must precede the torso rule or `Shoulder.L` would be
// caught by nothing and `UpperArm` by the wrong one.
//
// The choices worth defending:
//   Shoulder → TORSO. It is inside the shirt body, not the sleeve.
//   UpperArm/LowerArm → ARM. Habitat's "arm" colour is the SLEEVE colour (custom.m F8), and the
//     upper arm is where a sleeve lives. Vertices there that the material marked SKIN stay skin —
//     limb class only selects which pattern colours the *wild* texels, exactly as on the C64.
//   Wrist and fingers → FACE. Hands are bare skin, and FACE is Habitat's skin-adjacent slot; this
//     only matters if a glove-like material ever marks them wild.
//   Hips → LEG. The trousers start there.
const BONE_CLASS_RULES = [
    [/^(UpperLeg|LowerLeg|Foot|Toe|PT|Hips)/i, LIMB_CLASS.LEG],
    [/^(UpperArm|LowerArm|Elbow)/i, LIMB_CLASS.ARM],
    [/^(Wrist|Hand|Index|Middle|Ring|Pinky|Thumb)/i, LIMB_CLASS.FACE],
    [/^(Neck|Head|Jaw|Eye)/i, LIMB_CLASS.FACE],
    [/^(Shoulder|Chest|Torso|Abdomen|Spine|Body|Root)/i, LIMB_CLASS.TORSO],
]

export const boneLimbClass = (name = "") => {
    for (const [re, cls] of BONE_CLASS_RULES) if (re.test(name)) return cls
    return LIMB_CLASS.TORSO
}

// ── palette ramps for shading ────────────────────────────────────────────────────────────────

const hsl = (rgb) => {
    const r = ((rgb >> 16) & 0xff) / 255, g = ((rgb >> 8) & 0xff) / 255, b = (rgb & 0xff) / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
    if (max === min) return { h: 0, s: 0, l }
    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    const h = (max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
    return { h, s, l }
}

const HSL = c64Colors.map(hsl)
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

// Greys keep company with greys; everything else with its own hue. 0.12 saturation is where the
// colodore palette actually separates — black, the two greys, light grey and white all sit under
// it, and nothing chromatic does.
const sameFamily = (c, base, isGrey) =>
    isGrey ? c.s < 0.12 : (c.s >= 0.12 && hueGap(c.h, base.h) <= 45)

/**
 * A dark → base → light ramp for one palette index, chosen out of the 16 C64 colours.
 *
 * Derived, not hand-tabled. Habitat has no lighting, but an unlit low-poly humanoid at three
 * quarters has no readable form at all — the 1986 artists solved that by painting the difference
 * between the side and front cels, which a mesh the C64 never drew cannot inherit. So: find the
 * palette entries that share this colour's hue (or, for a grey, the other greys), sort by
 * lightness, and take the nearest neighbour on each side. Shading then stays inside the palette
 * instead of inventing colours, which is the whole point.
 *
 * A colour with no neighbour on one side repeats itself there, so a ramp is always length 3 and
 * always non-decreasing in lightness.
 */
export const paletteRampFor = (index) => {
    const base = HSL[index]
    const isGrey = base.s < 0.12
    const family = HSL
        .map((c, i) => ({ i, ...c }))
        .filter((c) => sameFamily(c, base, isGrey))
        .sort((a, b) => a.l - b.l)
    const at = family.findIndex((c) => c.i === index)
    const dark = at > 0 ? family[at - 1].i : index
    const light = at >= 0 && at < family.length - 1 ? family[at + 1].i : index
    return [dark, index, light]
}

// ── data textures ────────────────────────────────────────────────────────────────────────────
// All RGBA/UNSIGNED_BYTE so no format juggling is needed, and all read with texelFetch, so they
// must be NearestFilter with no mipmaps. They are tiny; the wasted channels cost nothing.

/** 16×1 RGBA — the colodore palette, straight out of habirender/render.js. */
export const paletteTexData = () => {
    const d = new Uint8Array(16 * 4)
    for (let i = 0; i < 16; i++) {
        d[i * 4] = (c64Colors[i] >> 16) & 0xff
        d[i * 4 + 1] = (c64Colors[i] >> 8) & 0xff
        d[i * 4 + 2] = c64Colors[i] & 0xff
        d[i * 4 + 3] = 255
    }
    return d
}

/** 16×4 RGBA, .r = the celPatterns byte for [pattern][row]. */
export const patternTexData = () => {
    const d = new Uint8Array(16 * 4 * 4)
    for (let p = 0; p < 16; p++) {
        for (let row = 0; row < 4; row++) {
            const i = (row * 16 + p) * 4
            d[i] = celPatterns[p][row]
            d[i + 3] = 255
        }
    }
    return d
}

/** 16×3 RGBA — row 0 dark, row 1 base, row 2 light, as literal RGB. */
export const rampTexData = () => {
    const d = new Uint8Array(16 * 3 * 4)
    for (let c = 0; c < 16; c++) {
        const ramp = paletteRampFor(c)
        for (let row = 0; row < 3; row++) {
            const rgb = c64Colors[ramp[row]]
            const i = (row * 16 + c) * 4
            d[i] = (rgb >> 16) & 0xff
            d[i + 1] = (rgb >> 8) & 0xff
            d[i + 2] = rgb & 0xff
            d[i + 3] = 255
        }
    }
    return d
}

// ── GLSL ─────────────────────────────────────────────────────────────────────────────────────
// A ShaderMaterial rather than onBeforeCompile on a stock material, because the output has to be
// byte-exact: any tone mapping, any sRGB conversion, any lighting term added behind our back turns
// "every pixel is one of sixteen colours" from a property into a coincidence. Skinning still comes
// from Three — `USE_SKINNING` is defined automatically for any material on a SkinnedMesh
// (WebGLPrograms: `skinning: object.isSkinnedMesh === true`), so the chunk includes below get
// bindMatrix and boneTexture uploaded for free.

export const HABIMAT_VERTEX = /* glsl */`
#include <common>
#include <skinning_pars_vertex>

attribute float aLimbClass;

varying float vLimbClass;
varying vec3 vNormalV;
varying vec3 vObj;

void main() {
    vLimbClass = aLimbClass;
    // Rest-pose position, deliberately: an object-space dither anchored here is glued to the
    // surface and travels with the limb, which is what "the pattern is painted on" should mean.
    vObj = position;

    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    vNormalV = normalize(transformedNormal);

    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
}
`

export const HABIMAT_FRAGMENT = /* glsl */`
precision highp float;

uniform sampler2D uPalette;   // 16×1  colodore RGB
uniform sampler2D uPatterns;  // 16×4  celPatterns bytes in .r
uniform sampler2D uRamp;      // 16×3  dark / base / light RGB per palette index

uniform float uNibble;        // this primitive's role: 0 transparent, 1 wild, 2 black, 3 skin
uniform float uWildcard;      // player colour, palette index 0..15
uniform float uSkin;          // palette index 0..15
uniform vec4  uLimbPattern;   // celPatterns index per limb class: LEG, TORSO, ARM, FACE

uniform float uDitherSpace;   // 0 = screen space (C64-authentic shimmer), 1 = object space
uniform vec2  uDitherScale;   // screen: pixels per dither cell. A C64 multicolor pixel is 2×1.
uniform float uObjDitherScale;// object space: dither cells per world unit

uniform float uShadeStrength; // 0 = flat, as the C64 was. 1 = full dark/base/light banding.
uniform vec3  uLightDir;

varying float vLimbClass;
varying vec3 vNormalV;
varying vec3 vObj;

// The two bits rgbaFromNibble pulls out of celPatterns, in the (b >> (6-s)) & 3 form.
float wildSlot(float pattern, vec2 cell) {
    int row = int(mod(cell.y, 4.0));
    int p = int(clamp(pattern, 0.0, 15.0));
    float bits = texelFetch(uPatterns, ivec2(p, row), 0).r * 255.0;
    float shift = mod(cell.x, 4.0) * 2.0;
    return mod(floor(bits / exp2(6.0 - shift)), 4.0);
}

void main() {
    if (uNibble < 0.5) discard;                       // nibble 0 — transparent

    // patternColors = [6, wildcard, 0, skin]
    float slot;
    if (uNibble < 1.5) {                              // nibble 1 — wild, dithered
        vec2 cell = (uDitherSpace < 0.5)
            ? floor(gl_FragCoord.xy / uDitherScale)
            : floor(vObj.xy * uObjDitherScale);
        int cls = int(clamp(vLimbClass, 0.0, 3.0));
        float pattern = cls == 0 ? uLimbPattern.x
                      : cls == 1 ? uLimbPattern.y
                      : cls == 2 ? uLimbPattern.z
                                 : uLimbPattern.w;
        slot = wildSlot(pattern, cell);
    } else {
        slot = uNibble;                               // nibble 2 → slot 2, nibble 3 → slot 3
    }

    float ci = slot < 0.5 ? 6.0
             : slot < 1.5 ? uWildcard
             : slot < 2.5 ? 0.0
                          : uSkin;

    // Shading stays inside the palette: pick a neighbour on this colour's own ramp.
    float lambert = clamp(dot(normalize(vNormalV), normalize(uLightDir)) * 0.5 + 0.5, 0.0, 1.0);
    float band = floor(lambert * 2.999);              // 0, 1 or 2
    float row = mix(1.0, band, clamp(uShadeStrength, 0.0, 1.0) > 0.5 ? 1.0 : 0.0);

    gl_FragColor = vec4(texelFetch(uRamp, ivec2(int(ci), int(row)), 0).rgb, 1.0);
}
`

/** The uniform bag, with Habitat's defaults (render.js defaultColors). */
export const defaultUniformValues = () => ({
    uWildcard: 6,
    uSkin: 10,
    uLimbPattern: [15, 15, 15, 15],
    uDitherSpace: 0,
    uDitherScale: [2, 1],
    uObjDitherScale: 40,
    uShadeStrength: 0,
    uLightDir: [-0.4, 0.7, 1.0],
})
