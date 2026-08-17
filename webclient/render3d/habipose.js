// habipose.js — Habitat's gestures as bone poses.
//
// THE PROBLEM THIS SOLVES. Habitat has a fixed vocabulary of 30 chore actions (codec.js
// choreographyActions, from the C64 body files) and a CC0 animation pack has 24 clips with names
// like "Sword_Slash". Three of them line up. `Wave` is a wave, `Walk` is a walk, `Idle` will do for
// stand — and then nothing in any pack is `bend_over`, `gimme`, `unpocket` or `frown`, because
// nothing outside Habitat has those verbs.
//
// So the gestures are authored rather than found. That is much less work than it sounds, because of
// a property of the source material: most Habitat gestures are a SINGLE HELD POSE, not a loop. The
// C64 chore table for `wave` is a handful of cels the client parks on, not a cycle. A pose is
// therefore ~6 numbers per bone for ~4 bones, set by eye against the original cel — which is a
// slider panel and a JSON file, not a Blender pipeline.
//
// WHAT A POSE IS. `{ boneName: [x, y, z] }` in DEGREES, as a DELTA from the rig's rest rotation.
// Deltas rather than absolutes so a pose stays meaningful if the body is ever swapped for another
// humanoid: "raise the right upper arm 80° and bend the elbow 60°" transfers; a quaternion measured
// against Quaternius' T-pose does not.
//
// No Three import — poses are arithmetic on plain objects, which is what makes them testable and
// what lets poses.json be checked for coverage in `node --test` rather than by opening the lab.

import { choreographyActions } from "../habirender/codec.js"

// choreographyActions minus the machinery. `init` and `nop` are not poses. The *_front / *_back
// entries are FACINGS of stand and walk rather than separate gestures — the C64 picked between them
// by which way the avatar was pointing, and a rotatable 3D figure gets that from the turntable, so
// authoring them separately would be authoring the same pose three times.
const NOT_GESTURES = new Set(["init", "nop", "stand_front", "stand_back", "walk_front", "walk_back"])

export const GESTURES = choreographyActions.filter((a) => !NOT_GESTURES.has(a))

// The handful the pack does cover. Using a real clip beats a hand-authored pose wherever one
// exists: `walk` is a cycle and no amount of single-pose authoring makes a convincing gait.
export const CLIP_FOR_GESTURE = {
    stand: "Idle",
    walk: "Walk",
    wave: "Wave",
    punch: "Punch_Right",
    get_shot: "HitRecieve",   // the pack's spelling, not ours
}

const DEG = Math.PI / 180

/**
 * Turn a pose into absolute euler angles, given the rig's rest rotations.
 *
 * `pose` is degrees-from-rest keyed by bone name; `rest` is radians keyed by bone name. Bones the
 * pose does not mention keep their rest rotation, which is what makes a pose a small object rather
 * than a full skeleton dump — `wave` touches four bones and says nothing about the legs.
 */
export const resolvePose = (pose = {}, rest = {}) => {
    const out = {}
    for (const [bone, r] of Object.entries(rest)) {
        const d = pose[bone] ?? [0, 0, 0]
        out[bone] = [r[0] + d[0] * DEG, r[1] + d[1] * DEG, r[2] + d[2] * DEG]
    }
    // A pose may name a bone the caller did not supply a rest for; treating rest as zero is better
    // than dropping the instruction silently.
    for (const [bone, d] of Object.entries(pose)) {
        if (!(bone in out)) out[bone] = [d[0] * DEG, d[1] * DEG, d[2] * DEG]
    }
    return out
}

/** Drop bones whose delta is all zeros — the on-disk form should only carry what was authored. */
export const compactPose = (pose = {}) => {
    const out = {}
    for (const [bone, d] of Object.entries(pose)) {
        if (d.some((v) => Math.abs(v) > 1e-6)) out[bone] = d.map((v) => Math.round(v * 10) / 10)
    }
    return out
}

/**
 * What is authored, what is borrowed from a clip, and what is still missing.
 *
 * The point of reporting `missing` rather than failing on it: a half-authored gesture table is the
 * normal state of this work for as long as it takes, and the lab should say so out loud instead of
 * rendering a T-pose and letting you wonder.
 */
export const poseCoverage = (poses = {}) => {
    const authored = []
    const fromClip = []
    const missing = []
    for (const g of GESTURES) {
        if (poses[g] && Object.keys(poses[g]).length) authored.push(g)
        else if (CLIP_FOR_GESTURE[g]) fromClip.push(g)
        else missing.push(g)
    }
    return { authored, fromClip, missing, total: GESTURES.length }
}

/**
 * Structural check on a pose table. Returns a list of complaints; empty means well-formed.
 *
 * `knownBones` is optional. Passing it is how the test catches the failure mode that actually
 * happens: a pose authored against one rig, keyed by a bone name the next rig does not have, which
 * otherwise fails by doing nothing at all.
 */
export const validatePoses = (poses = {}, knownBones = null) => {
    const errors = []
    const known = knownBones ? new Set(knownBones) : null
    for (const [gesture, pose] of Object.entries(poses)) {
        if (!GESTURES.includes(gesture)) {
            errors.push(`"${gesture}" is not a Habitat chore action`)
        }
        if (pose === null || typeof pose !== "object" || Array.isArray(pose)) {
            errors.push(`${gesture}: pose must be an object of bone → [x,y,z]`)
            continue
        }
        for (const [bone, d] of Object.entries(pose)) {
            if (!Array.isArray(d) || d.length !== 3 || d.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
                errors.push(`${gesture}.${bone}: expected three finite numbers, got ${JSON.stringify(d)}`)
            }
            if (known && !known.has(bone)) {
                errors.push(`${gesture}.${bone}: no such bone on this rig`)
            }
        }
    }
    return errors
}
