// chore.m special_hold: non-swing held props use hold-out arm anim (19/20), not swing (0/1/11).
const AVATAR_HAND = 5
const HOLD_OUT_SIDE = 19
const HOLD_OUT_FRONT = 20

const applySpecialHoldOverride = (ov, howHeld) => {
    if (howHeld === "swing" || howHeld == null || ov.limb !== AVATAR_HAND) return ov
    if (ov.animation === 0 || ov.animation === 1) return { limb: AVATAR_HAND, animation: HOLD_OUT_SIDE }
    if (ov.animation === 11) return { limb: AVATAR_HAND, animation: HOLD_OUT_FRONT }
    return ov
}

const walkHand = { limb: 5, animation: 1 }
const walkFrontHand = { limb: 5, animation: 11 }
const standHand = { limb: 5, animation: 0 }

if (applySpecialHoldOverride(walkHand, "swing").animation !== 1) {
    throw new Error("swing held should keep walk hand swing")
}
if (applySpecialHoldOverride(walkHand, "out").animation !== HOLD_OUT_SIDE) {
    throw new Error("out held should use hold-out side on walk")
}
if (applySpecialHoldOverride(standHand, "out").animation !== HOLD_OUT_SIDE) {
    throw new Error("out held should use hold-out side on stand")
}
if (applySpecialHoldOverride(walkFrontHand, "out").animation !== HOLD_OUT_FRONT) {
    throw new Error("out held should use hold-out front on walk_front")
}
if (applySpecialHoldOverride(walkHand, "at_side").animation !== HOLD_OUT_SIDE) {
    throw new Error("at_side held should use hold-out (any non-swing)")
}

console.log("test-held-chore: ok")