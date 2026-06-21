// A held Ctrl-# gesture must freeze on its FINAL animation cel — the stop-bit cel the
// looping cycle skips (Main/chore.m set_chore background_activity). The bug: the held pose
// showed endState-1 (jump still in-air, bend-over not fully bent) instead of endState.

import assert from "node:assert"
import { test } from "node:test"
import { animationsAtStart, advanceAnimations, animationsAtEnd } from "./habirender/chore-frames.js"

// A limb whose gesture cels are 0,1,2,3 (endState = 3 is the final, held pose).
const mk = () => [{ startState: 0, endState: 3 }]

test("the looping cycle shows startState..endState-1 (endState never shown)", () => {
    const a = animationsAtStart(mk())
    const shown = [a[0].current]
    while (advanceAnimations(a) !== a.length) shown.push(a[0].current)
    assert.deepEqual(shown, [0, 1, 2]) // endState (3) is the wrap point, omitted
})

test("the held gesture's final pose is the endState cel the loop omits", () => {
    // The last loop frame is endState-1 — jump in-air / bend-over incomplete...
    const loop = animationsAtStart(mk())
    let last = loop[0].current
    while (advanceAnimations(loop) !== loop.length) last = loop[0].current
    assert.equal(last, 2)
    // ...so holding the loop's last frame is NOT the completed pose. The held pose must be
    // the endState cel (3).
    const held = animationsAtEnd(mk())
    assert.equal(held[0].current, 3)
    assert.notEqual(held[0].current, last)
})
