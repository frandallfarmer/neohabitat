// Walk choreography cycle: C64 animate.m/mix.m inc-then-wrap-at-end (end frame never shown).
// composeAvatarFrameAt must not treat the first advance as init-only (that duplicated frame 0).

const animationsAtStart = (animations) => animations.map((a) => ({ ...a, current: a.startState }))

const advanceAnimations = (animations) => {
    let restartedCount = 0
    for (const anim of animations) {
        anim.current++
        if (anim.current >= anim.endState) {
            anim.current = anim.startState
            restartedCount++
        }
    }
    return restartedCount
}

const cycleLength = (animations) => {
    const scratch = animationsAtStart(animations)
    let count = 0
    while (true) {
        count++
        if (advanceAnimations(scratch) === scratch.length) break
    }
    return count
}

const frameSignature = (animations, idx) => {
    const scratch = animationsAtStart(animations)
    for (let i = 0; i < idx; i++) advanceAnimations(scratch)
    return scratch.map((a) => a.current).join(",")
}

const composeCycle = (animations) => {
    const scratch = animationsAtStart(animations)
    const sigs = []
    while (true) {
        sigs.push(scratch.map((a) => a.current).join(","))
        if (advanceAnimations(scratch) === scratch.length) break
    }
    return sigs
}

// Single limb: C64 shows start..end-1 only (end=3 ⇒ states 0,1,2).
const oneLimb = [{ startState: 0, endState: 3 }]
const oneSigs = composeCycle(oneLimb)
if (oneSigs.length !== 3) {
    throw new Error(`one-limb walk cycle: expected 3 frames, got ${oneSigs.length} (${oneSigs.join(" | ")})`)
}
if (oneSigs[0] !== "0" || oneSigs[2] !== "2") {
    throw new Error(`one-limb walk cycle: expected 0,1,2 got ${oneSigs.join(" | ")}`)
}

// Live index 0 and 1 must differ (old init-only first advance duplicated frame 0).
if (frameSignature(oneLimb, 0) === frameSignature(oneLimb, 1)) {
    throw new Error("frame 0 and 1 must not duplicate")
}

// cycleLength matches composed frame count; wrap does not repeat last frame at index 0.
const len = cycleLength(oneLimb)
if (len !== oneSigs.length) {
    throw new Error(`cycle length ${len} !== composed frames ${oneSigs.length}`)
}
for (let i = 0; i < len; i++) {
    if (frameSignature(oneLimb, i) !== oneSigs[i]) {
        throw new Error(`index ${i}: frameSignature mismatch`)
    }
}
if (frameSignature(oneLimb, len) !== oneSigs[0]) {
    throw new Error("cycle wrap should return to first frame")
}
if (frameSignature(oneLimb, len - 1) === frameSignature(oneLimb, 0)) {
    throw new Error("last frame must not duplicate first (end state excluded)")
}

// Walk-like: legs period 4, hand period 2 — full cycle is lcm = 4.
const walkish = [
    { startState: 0, endState: 4 },
    { startState: 0, endState: 2 },
]
const walkLen = cycleLength(walkish)
if (walkLen !== 4) {
    throw new Error(`walkish cycle: expected 4, got ${walkLen}`)
}
const walkSigs = composeCycle(walkish)
if (new Set(walkSigs).size !== walkSigs.length) {
    throw new Error(`walkish cycle has duplicate composed frames: ${walkSigs.join(" | ")}`)
}

console.log("test-walk-cycle: ok")