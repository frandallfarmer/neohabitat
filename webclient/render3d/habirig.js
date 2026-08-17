// habirig.js — the glTF side of the Habitat figure: load it, read the skeleton, and dress every
// primitive in the C64 material.
//
// habimat.js is the colour model and knows nothing about Three; this module is where that model
// meets a real rigged mesh. THREE is passed in rather than imported, the same arrangement scene.js
// uses, so the pure half stays reachable from `node --test`.
//
// What the vendored character actually contains is written down in assets3d/CREDITS.md — verified
// by decoding the file, not read off a store page. The short version:
//
//   4 meshes (Legs, Feet, Body, Head) over ONE 62-joint skeleton, 9 flat-colour materials,
//   NO texture images at all, 24 animation clips prefixed "CharacterArmature|".
//
// The absence of textures is the happy accident this whole approach rests on. A Habitat cel is an
// index map — four roles per pixel, not colours — and a mesh whose surface is already partitioned
// into nine flat regions is an index map that someone else drew. There is nothing to classify per
// texel; there are nine decisions, and CASUAL_MATERIAL_NIBBLES makes them explicitly.

import {
    NIBBLE, LIMB_CLASS, boneLimbClass, classifyMaterials,
    paletteTexData, patternTexData, rampTexData,
    HABIMAT_VERTEX, HABIMAT_FRAGMENT, defaultUniformValues,
    CASUAL_MATERIAL_NIBBLES,
} from "./habimat.js"

export const CLIP_PREFIX = "CharacterArmature|"

/** Strip the exporter's armature prefix so clip names read as clip names. */
export const clipLabel = (name) => name.startsWith(CLIP_PREFIX) ? name.slice(CLIP_PREFIX.length) : name

// GLTFLoader runs every node name through PropertyBinding.sanitizeNodeName, which deletes the
// characters the animation-binding path syntax reserves — so the file's `UpperArm.L` arrives as
// `UpperArmL`. Rather than write the mangled names everywhere and have them silently stop matching
// if that sanitizer ever changes, bones are looked up on a normalized key. Names in this codebase
// stay the ones in the glTF and in assets3d/CREDITS.md.
export const normalizeBoneName = (name = "") => name.toLowerCase().replace(/[^a-z0-9]/g, "")

// The bones worth putting a slider on. 62 joints is mostly fingers, and a Habitat gesture is a
// whole-arm shape — nobody poses a Habitat wave with the middle knuckle. Order is the order the
// pose editor lists them: spine up, then arms, then legs.
export const POSE_BONES = [
    "Hips", "Abdomen", "Torso", "Chest", "Neck", "Head",
    "Shoulder.L", "UpperArm.L", "LowerArm.L", "Wrist.L",
    "Shoulder.R", "UpperArm.R", "LowerArm.R", "Wrist.R",
    "UpperLeg.L", "LowerLeg.L", "Foot.L",
    "UpperLeg.R", "LowerLeg.R", "Foot.R",
]

export const HEAD_BONE = "Head"
export const HAND_BONE = "Wrist.R"

/** A 16×N nearest-sampled RGBA lookup. Everything habimat reads with texelFetch comes through here. */
const dataTexture = (THREE, data, w, h) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
    t.minFilter = THREE.NearestFilter
    t.magFilter = THREE.NearestFilter
    t.generateMipmaps = false
    // NoColorSpace, emphatically: these are lookup tables, not pictures. Let Three treat the
    // palette as sRGB and it will "correct" the colodore values into something else, and the
    // framebuffer stops containing the 16 colours the whole exercise is about.
    t.colorSpace = THREE.NoColorSpace
    t.needsUpdate = true
    return t
}

/**
 * The shared uniform bag. One object drives every primitive on the figure, so a spray-can change is
 * a single assignment rather than a walk over the scene graph — except uNibble, which is per
 * primitive and therefore lives on each material rather than in here.
 */
export const createSharedUniforms = (THREE) => {
    const v = defaultUniformValues()
    return {
        uPalette: { value: dataTexture(THREE, paletteTexData(), 16, 1) },
        uPatterns: { value: dataTexture(THREE, patternTexData(), 16, 4) },
        uRamp: { value: dataTexture(THREE, rampTexData(), 16, 3) },
        uWildcard: { value: v.uWildcard },
        uSkin: { value: v.uSkin },
        uLimbPattern: { value: new THREE.Vector4(...v.uLimbPattern) },
        uDitherSpace: { value: v.uDitherSpace },
        uDitherScale: { value: new THREE.Vector2(...v.uDitherScale) },
        uObjDitherScale: { value: v.uObjDitherScale },
        uShadeStrength: { value: v.uShadeStrength },
        uLightDir: { value: new THREE.Vector3(...v.uLightDir) },
    }
}

const habimatMaterial = (THREE, shared, nibble) => new THREE.ShaderMaterial({
    uniforms: { ...shared, uNibble: { value: nibble } },
    vertexShader: HABIMAT_VERTEX,
    fragmentShader: HABIMAT_FRAGMENT,
    // Habitat has no transparency and no backfaces to speak of; FrontSide keeps the outline pass
    // (postfx.js, which draws the same geometry inside out) from fighting the figure.
    side: THREE.FrontSide,
})

/**
 * Per-vertex limb class, from whichever bone moves the vertex most.
 *
 * The dominant weight is the honest reading of "which body part is this": a vertex on the sleeve
 * hem is 70% upper arm and 30% chest, and it should be sleeve-coloured. Doing it by bone rather
 * than by submesh is what lets one shirt material carry both TORSO and ARM colours, which is the
 * split Habitat's spray can expects and Quaternius' mesh does not provide.
 */
export const limbClassAttribute = (THREE, geometry, boneNames) => {
    const joints = geometry.getAttribute("skinIndex")
    const weights = geometry.getAttribute("skinWeight")
    const n = geometry.getAttribute("position").count
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
        let bestJoint = 0, bestWeight = -1
        for (const c of ["x", "y", "z", "w"]) {
            const w = weights ? weights[`get${c.toUpperCase()}`](i) : 0
            if (w > bestWeight) { bestWeight = w; bestJoint = joints ? joints[`get${c.toUpperCase()}`](i) : 0 }
        }
        out[i] = boneLimbClass(boneNames[bestJoint] ?? "")
    }
    return new THREE.BufferAttribute(out, 1)
}

/**
 * Load a figure and put it in Habitat's clothes.
 *
 * Returns everything the lab needs to drive it, plus a `report` — the material table with the rule
 * that decided each nibble. That report is not decoration: when a figure comes out miscoloured, the
 * first question is always "why did THAT surface get that role", and printing the answer beats
 * re-deriving it from the shader.
 */
export const loadFigure = async (THREE, GLTFLoader, url, { overrides = CASUAL_MATERIAL_NIBBLES } = {}) => {
    const gltf = await new GLTFLoader().loadAsync(url)
    const root = gltf.scene

    const bones = new Map()
    const byKey = new Map()
    root.traverse((o) => {
        if (!o.isBone) return
        bones.set(o.name, o)
        byKey.set(normalizeBoneName(o.name), o)
    })
    const bone = (name) => bones.get(name) ?? byKey.get(normalizeBoneName(name)) ?? null

    const shared = createSharedUniforms(THREE)
    const meshes = []
    const materials = []
    root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o) })
    for (const m of meshes) materials.push({ name: m.material?.name ?? "", color: colorOf(m.material) })

    const report = classifyMaterials(materials, { overrides })

    meshes.forEach((mesh, i) => {
        const { nibble } = report[i]
        if (mesh.isSkinnedMesh) {
            const boneNames = mesh.skeleton.bones.map((b) => b.name)
            mesh.geometry.setAttribute("aLimbClass", limbClassAttribute(THREE, mesh.geometry, boneNames))
        } else {
            // A static mesh has no skeleton to ask, so everything on it is torso. Nothing in the
            // vendored figure takes this path; it is here so a static prop cannot crash the loader.
            const n = mesh.geometry.getAttribute("position").count
            mesh.geometry.setAttribute("aLimbClass",
                new THREE.BufferAttribute(new Float32Array(n).fill(LIMB_CLASS.TORSO), 1))
        }
        mesh.material = habimatMaterial(THREE, shared, nibble)
        // The pack's head is a Quaternius head. Habitat avatars wear Habitat heads, so it goes
        // away — but stays in the graph, because the neck bone under it is the mount point.
        if (/head/i.test(mesh.name)) mesh.visible = false
        report[i].mesh = mesh.name
    })

    const clips = gltf.animations ?? []
    const box = new THREE.Box3().setFromObject(root)

    return {
        root, bones, meshes, clips, shared, report, box, bone,
        headBone: bone(HEAD_BONE),
        handBone: bone(HAND_BONE),
        /** The pose-editor bones, resolved. A null means the rig does not have that joint. */
        poseBones: () => POSE_BONES.map((name) => ({ name, bone: bone(name) })),
        clipNames: clips.map((c) => clipLabel(c.name)),
        clipByLabel: (label) => clips.find((c) => clipLabel(c.name) === label) ?? null,
    }
}

// glTF baseColorFactor, in the linear space classifyMaterials expects. Three has already converted
// the factor into material.color by the time we see it, so read it back without color management.
const colorOf = (material) => {
    if (!material?.color) return [0.5, 0.5, 0.5]
    return [material.color.r, material.color.g, material.color.b]
}

/** Show or hide the pack's own head mesh — for comparing it against the Habitat hull head. */
export const setPackHeadVisible = (figure, visible) => {
    for (const m of figure.meshes) if (/head/i.test(m.name)) m.visible = visible
}

export { NIBBLE, LIMB_CLASS }
