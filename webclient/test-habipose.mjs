// test-habipose.mjs — the gesture table, checked for the failures that are otherwise silent.
//
// A wrong pose looks wrong and you fix it. The failures worth a test are the ones that render as
// *nothing happening*: a gesture keyed by a name Habitat does not have, a bone name that does not
// exist on the rig, a coverage gap nobody noticed. All three produce a figure standing calmly in
// its rest pose, which is indistinguishable from "this gesture is subtle".

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { choreographyActions } from "./habirender/codec.js"
import { POSE_BONES, normalizeBoneName } from "./render3d/habirig.js"
import {
    GESTURES, CLIP_FOR_GESTURE, resolvePose, compactPose, poseCoverage, validatePoses,
} from "./render3d/habipose.js"

const poses = JSON.parse(await readFile(new URL("./render3d/poses.json", import.meta.url), "utf8"))

test("the gesture list is derived from the C64 chore table, not retyped", () => {
    // Every gesture must BE a chore action. The list is filtered from choreographyActions at import
    // time, so this is really asserting that the filter did not typo an exclusion into an addition.
    for (const g of GESTURES) {
        assert.ok(choreographyActions.includes(g), `"${g}" is not in choreographyActions`)
    }
    // The excluded six, and why: init/nop are machinery, and the *_front/*_back entries are facings
    // of stand and walk that a rotatable figure gets from the turntable.
    for (const excluded of ["init", "nop", "stand_front", "stand_back", "walk_front", "walk_back"]) {
        assert.ok(!GESTURES.includes(excluded), `"${excluded}" should not be a gesture`)
    }
    assert.equal(GESTURES.length, choreographyActions.length - 6)
    // The ones a Habitat player would name if asked what their avatar can do.
    for (const g of ["wave", "point", "bend_over", "jump", "punch", "frown", "gimme"]) {
        assert.ok(GESTURES.includes(g), `"${g}" missing from the gesture list`)
    }
})

test("every clip mapping names a gesture and a clip the pack actually ships", () => {
    // The clip names come from assets3d/quaternius-casual.glb, verified by decoding it.
    const packClips = new Set([
        "Death", "Gun_Shoot", "HitRecieve", "HitRecieve_2", "Idle", "Idle_Gun", "Idle_Gun_Pointing",
        "Idle_Gun_Shoot", "Idle_Neutral", "Idle_Sword", "Interact", "Kick_Left", "Kick_Right",
        "Punch_Left", "Punch_Right", "Roll", "Run", "Run_Back", "Run_Left", "Run_Right",
        "Run_Shoot", "Sword_Slash", "Walk", "Wave",
    ])
    for (const [gesture, clip] of Object.entries(CLIP_FOR_GESTURE)) {
        assert.ok(GESTURES.includes(gesture), `"${gesture}" is not a gesture`)
        assert.ok(packClips.has(clip), `clip "${clip}" is not in the vendored pack`)
    }
})

test("poses.json is well formed and keyed by bones this rig has", () => {
    const errors = validatePoses(poses, POSE_BONES)
    assert.deepEqual(errors, [], `poses.json:\n  ${errors.join("\n  ")}`)
})

test("every pose bone resolves to a distinct normalized key", () => {
    // habirig looks bones up on a normalized key because GLTFLoader strips the dot out of
    // "UpperArm.L". Two pose bones that normalize to the same key would silently collide.
    const keys = POSE_BONES.map(normalizeBoneName)
    assert.equal(new Set(keys).size, keys.length, `collision among ${keys.join(", ")}`)
})

test("coverage is reported honestly", () => {
    const c = poseCoverage(poses)
    assert.equal(c.total, GESTURES.length)
    assert.equal(c.authored.length + c.fromClip.length + c.missing.length, c.total,
        "every gesture must be accounted for exactly once")
    // Not an assertion that the table is complete — it will not be for a while, and pretending
    // otherwise is worse than saying so. This only pins that the gestures with no possible clip
    // have actually been authored, because those are the ones that would otherwise never move.
    for (const g of ["wave", "point", "bend_over"]) {
        assert.ok(c.authored.includes(g) || c.fromClip.includes(g),
            `"${g}" has neither a pose nor a clip — it would render as a T-pose`)
    }
    console.log(`  poses: ${c.authored.length} authored, ${c.fromClip.length} from clips, ` +
        `${c.missing.length} still to do (${c.missing.join(", ") || "none"})`)
})

test("resolvePose adds degrees to a radian rest pose", () => {
    const rest = { Chest: [0, 0, 0], "UpperArm.R": [0.5, 0, 0] }
    const out = resolvePose({ "UpperArm.R": [90, 0, 0] }, rest)
    // Bones the pose does not mention keep their rest value — that is what lets a pose be four
    // bones instead of twenty.
    assert.deepEqual(out.Chest, [0, 0, 0])
    assert.ok(Math.abs(out["UpperArm.R"][0] - (0.5 + Math.PI / 2)) < 1e-9)
    assert.equal(out["UpperArm.R"][1], 0)

    // A pose naming a bone with no rest entry is applied from zero rather than dropped, so a typo
    // shows up as a bone flying off instead of as nothing at all.
    const orphan = resolvePose({ Nose: [180, 0, 0] }, {})
    assert.ok(Math.abs(orphan.Nose[0] - Math.PI) < 1e-9)
})

test("compactPose keeps only what was authored", () => {
    assert.deepEqual(
        compactPose({ A: [0, 0, 0], B: [0, 12.34567, 0], C: [-1e-9, 0, 0] }),
        { B: [0, 12.3, 0] },
    )
})

test("validatePoses catches the three silent failures", () => {
    assert.ok(validatePoses({ notAChore: { Chest: [0, 0, 0] } })
        .some((e) => e.includes("not a Habitat chore action")))
    assert.ok(validatePoses({ wave: { Chest: [0, 0] } })
        .some((e) => e.includes("three finite numbers")))
    assert.ok(validatePoses({ wave: { Chest: [0, NaN, 0] } })
        .some((e) => e.includes("three finite numbers")))
    assert.ok(validatePoses({ wave: { Elbow: [0, 1, 0] } }, ["Chest"])
        .some((e) => e.includes("no such bone")))
    assert.deepEqual(validatePoses({ wave: { Chest: [1, 2, 3] } }, ["Chest"]), [])
})
