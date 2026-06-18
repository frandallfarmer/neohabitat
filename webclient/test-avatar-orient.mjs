// Mirrors walkOrientationForStep from lib/avatar-chore.js (browser ESM; codec dep blocks node import).
const walkOrientationForStep = (orient, x, toX) => {
    const fx = x > 208 ? x - 256 : x
    const tx = toX > 208 ? toX - 256 : toX
    if (fx === tx) return orient
    let o = orient & ~0x01
    if (fx > tx) o |= 0x01
    return o
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

let o = 1
o = walkOrientationForStep(o, 80, 96)
o = walkOrientationForStep(o, 84, 96)
o = walkOrientationForStep(o, 88, 96)
o = walkOrientationForStep(o, 92, 96)
o = walkOrientationForStep(o, 96, 96)
assert(o === 0, `walk right should end facing right, got ${o}`)

o = 0
o = walkOrientationForStep(o, 96, 80)
o = walkOrientationForStep(o, 92, 80)
o = walkOrientationForStep(o, 88, 80)
o = walkOrientationForStep(o, 84, 80)
o = walkOrientationForStep(o, 80, 80)
assert(o === 1, `walk left should end facing left, got ${o}`)

o = 1
o = walkOrientationForStep(o, 80, 80)
assert(o === 1, `Y-only walk should keep facing, got ${o}`)

// Old bug: resetting to baseOrient at destination would snap back to 1 here.
assert(walkOrientationForStep(1, 96, 96) === 1, "at destination keep chained orient, not baseOrient")

const FACE_LEFT = 254
const FACE_RIGHT = 255
const STAND_FRONT = 146

const displayOrientForActivity = (activity, orient) => {
    switch (activity) {
        case FACE_LEFT:
        case 251:
            return (orient & ~0x01) | 0x01
        case FACE_RIGHT:
        case 252:
            return orient & ~0x01
        case STAND_FRONT:
        case 157:
            return orient | 0x02
        case 143:
            return orient | 0x02
        default:
            return orient
    }
}

const sideActivityFromOrient = (orient) => ((orient & 0x01) ? FACE_LEFT : FACE_RIGHT)

assert(displayOrientForActivity(FACE_LEFT, 16) === 17, "FACE_LEFT forces bit 0 even when server orient lacks it")
assert(sideActivityFromOrient(0) === FACE_RIGHT, "walk end rightward sets FACE_RIGHT activity")
assert(sideActivityFromOrient(1) === FACE_LEFT, "walk end leftward sets FACE_LEFT activity")
assert(displayOrientForActivity(STAND_FRONT, 1) === 3, "STAND_FRONT sets front bit")

console.log("test-avatar-orient: ok")