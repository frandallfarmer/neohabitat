// Client-side avatar motion — walks, gestures, and other transient choreography.
//
// The C64 client advances animation and (for walks) position on its render cadence
// (walkto.m moves x by 4 / y by 1–2 per step). habiworld applies WALK$ as an
// instant x/y jump; we replay the walk locally from the pre-move position.

import { signal } from "@preact/signals"
import { choreographyActions } from "../habirender/codec.js"

export const FRAME_MS = 250

// Avatar.java / Constants.java — activity encodes facing; orientation bit 0 may lag.
export const FACE_BACK = 143
export const STAND_FRONT = 146
export const STAND_LEFT = 251
export const STAND_RIGHT = 252
export const FACE_LEFT = 254
export const FACE_RIGHT = 255

export const choreographyNameFromAvAct = (avAct) => {
    const a = avAct ?? 129
    if (a === FACE_BACK) return "stand_back"
    if (a === STAND_FRONT) return "stand_front"
    if (a === 157) return "sit_front" // SIT_FRONT
    if (a === FACE_LEFT || a === FACE_RIGHT || a === STAND_LEFT || a === STAND_RIGHT) return "stand"
    const index = a & 0x7f
    if (index >= choreographyActions.length) return "stand"
    if (index >= 123) return "stand"
    const name = choreographyActions[index]
    return name === "init" || name === "nop" ? "stand" : name
}

// Entry (FACE_LEFT) and walk-end facing use activity; bit 0 alone is not enough.
export const displayOrientForActivity = (activity, orient) => {
    switch (activity) {
        case FACE_LEFT:
        case STAND_LEFT:
            return (orient & ~0x01) | 0x01
        case FACE_RIGHT:
        case STAND_RIGHT:
            return orient & ~0x01
        case STAND_FRONT:
        case 157: // SIT_FRONT
            return orient | 0x02
        case FACE_BACK:
            return orient | 0x02
        default:
            return orient
    }
}

export const sideActivityFromOrient = (orient) => ((orient & 0x01) ? FACE_LEFT : FACE_RIGHT)

export const choreographyNameFromMod = (mod, motion) => {
    if (motion?.action) return motion.action
    // Server POSTURE updates activity, not action (Avatar.java POSTURE).
    return choreographyNameFromAvAct(mod.activity ?? mod.action)
}

export const headFacingFromAction = (actionName) => {
    if (actionName === "stand_front" || actionName === "walk_front" || actionName === "sit_front") return 1
    if (actionName === "stand_back" || actionName === "walk_back") return 3
    return 0
}

// walkto.m chore_at_end — facing follows the axis being stepped, not overall delta.
// X steps use AV_ACT_walk (side); Y steps use walk_front / walk_back (carry on CPY).
const walkActionForStep = (x, y, toX, toY) => {
    const fy = y & 127, ty = toY & 127
    const fx = x > 208 ? x - 256 : x
    const tx = toX > 208 ? toX - 256 : toX
    if (fx !== tx) return "walk"
    if (fy !== ty) return fy >= ty ? "walk_front" : "walk_back"
    return "stand"
}

// walkto.m x_change — set orient_left from horizontal step direction.
// Chain from the current orient each step; at destination (fx === tx) keep the last facing.
export const walkOrientationForStep = (orient, x, toX) => {
    const fx = x > 208 ? x - 256 : x
    const tx = toX > 208 ? toX - 256 : toX
    if (fx === tx) return orient
    let o = orient & ~0x01
    if (fx > tx) o |= 0x01
    return o
}

const habitatXByte = (nx) => (nx < 0 ? nx + 256 : nx)

// walkto.m: change X by ±4 first; then Y by ±1 or ±2.
const walkStep = (x, y, toX, toY) => {
    const fg = y & 128
    let nx = x > 208 ? x - 256 : x
    let ny = y & 127
    const ty = toY & 127
    const tx = toX > 208 ? toX - 256 : toX
    if (nx !== tx) {
        nx += nx < tx ? 4 : -4
        if ((nx < tx && nx + 4 > tx) || (nx > tx && nx - 4 < tx)) nx = tx
    } else if (ny !== ty) {
        const dy = ty - ny
        const step = Math.abs(dy) >= 2 ? 2 : 1
        ny += dy > 0 ? step : -step
        if ((dy > 0 && ny > ty) || (dy < 0 && ny < ty)) ny = ty
    }
    return { x: habitatXByte(nx), y: fg | ny, done: nx === tx && ny === ty }
}

// Avatar.java POSTURE — persistent facing/stance (not a transient anim cycle).
const PERSISTENT_POSTURES = new Set([
    129, // STAND
    132, 133, 157, // SIT_GROUND, SIT_CHAIR, SIT_FRONT
    143, 146, // stand_back, STAND_FRONT
    251, 252, // STAND_LEFT, STAND_RIGHT
    254, 255, // FACE_LEFT, FACE_RIGHT
])

export const orientForPosture = (posture, orient) =>
    displayOrientForActivity(posture, orient)

const OP_GESTURE = {
    "OPENCONTAINER$": () => "bend_over",
    "CLOSECONTAINER$": () => "bend_back",
}

export function createAvatarMotion({ frameMs = FRAME_MS } = {}) {
    const tick = signal(0)
    /** @type {Map<number, object>} */
    const states = new Map()
    /** @type {Map<number, object[]>} */
    const gestureQueues = new Map()
    /** WALK$ never updates server orientation/activity — client tracks both after walks. */
    const orientOverrides = new Map()
    const activityOverrides = new Map()
    let timer = null

    const bump = () => { tick.value++ }

    const startGestureNow = (noid, action, serverOrient, serverActivity, holdActivity = null) => {
        const startOrient = getOrient(noid, serverOrient)
        const startActivity = getActivity(noid, serverActivity)
        states.set(noid, {
            type: "gesture", action, startOrient, startActivity, holdActivity,
            animFrame: 0, cycleLen: null,
        })
        startTimer()
        bump()
    }

    const drainGestureQueue = (noid) => {
        const q = gestureQueues.get(noid)
        if (!q?.length) {
            gestureQueues.delete(noid)
            return
        }
        const next = q.shift()
        startGestureNow(noid, next.action, next.serverOrient, next.serverActivity, next.holdActivity)
    }

    const getOrient = (noid, serverOrient = 0) => orientOverrides.get(noid) ?? serverOrient

    const getActivity = (noid, serverActivity = 129) => activityOverrides.get(noid) ?? serverActivity

    const startTimer = () => {
        if (timer) return
        timer = setInterval(() => {
            let changed = false
            for (const [noid, s] of states) {
                if (s.type === "walk") {
                    const step = walkStep(s.x, s.y, s.toX, s.toY)
                    s.x = step.x
                    s.y = step.y
                    s.action = walkActionForStep(s.x, s.y, s.toX, s.toY)
                    s.orient = walkOrientationForStep(s.orient ?? s.startOrient, s.x, s.toX)
                    s.animFrame++
                    if (step.done) {
                        const activity = sideActivityFromOrient(s.orient)
                        activityOverrides.set(noid, activity)
                        orientOverrides.set(noid, displayOrientForActivity(activity, s.orient))
                        states.delete(noid)
                        drainGestureQueue(noid)
                    }
                    changed = true
                } else if (s.type === "gesture" && !s.frozen) {
                    s.animFrame++
                    if (s.cycleLen != null && s.animFrame >= s.cycleLen) {
                        orientOverrides.set(noid, s.startOrient)
                        if (s.holdActivity != null) {
                            // Ctrl-# gesture: hold the FINAL animation frame
                            // (background_activity) until the next action, rather than
                            // reverting or snapping to the chore's resting frame.
                            s.frozen = true
                            s.animFrame = s.cycleLen - 1
                            activityOverrides.set(noid, s.holdActivity)
                        } else {
                            // a normal action chore reverts to the pose it started from
                            if (s.startActivity != null) activityOverrides.set(noid, s.startActivity)
                            states.delete(noid)
                            drainGestureQueue(noid)
                        }
                    }
                    changed = true
                }
            }
            if (changed) bump()
        }, frameMs)
    }

    const get = (noid) => states.get(noid) ?? null

    // animate.m clear_wait: the C64 blocks on animation_wait_bit until the chore/walk reaches its
    // end. We have the real engine, so resolve when the avatar has no active (non-frozen)
    // animation — the faithful replacement for habiworld's distance→time estimate (walkWaitMillis),
    // which is a headless-bot approximation. A held Ctrl-# gesture is `frozen` (done, holding its
    // final frame), so it counts as idle. fallbackMs is a safety net so a dropped frame can never
    // hang a behavior on the wait.
    const isAnimating = (noid) => { const s = states.get(noid); return !!s && !s.frozen }
    const whenIdle = (noid, { fallbackMs = 15000 } = {}) => {
        if (noid == null || !isAnimating(noid)) return Promise.resolve()
        return new Promise((resolve) => {
            let timer = null
            let unsub = null
            const finish = () => {
                if (timer) clearTimeout(timer)
                if (unsub) unsub()
                resolve()
            }
            timer = setTimeout(finish, fallbackMs)
            unsub = tick.subscribe(() => { if (!isAnimating(noid)) finish() })
        })
    }

    const noteCycleLength = (noid, len) => {
        const s = states.get(noid)
        if (s?.type === "gesture" && s.cycleLen == null && len > 0) s.cycleLen = len
    }

    const beginWalk = (noid, fromRec, msg) => {
        if (noid == null || !fromRec?.mod) return
        const fromX = fromRec.mod.x
        const fromY = fromRec.mod.y
        const toX = msg.x
        const toY = msg.y
        const fy = fromY & 127, ty = toY & 127
        const fx = fromX > 208 ? fromX - 256 : fromX
        const tx = toX > 208 ? toX - 256 : toX
        if (fx === tx && fy === ty) return
        const startOrient = getOrient(noid, fromRec.mod.orientation ?? 0)
        states.set(noid, {
            type: "walk",
            action: walkActionForStep(fromX, fromY, toX, toY),
            startOrient,
            orient: walkOrientationForStep(startOrient, fromX, toX),
            x: fromX,
            y: fromY,
            toX,
            toY,
            animFrame: 0,
        })
        startTimer()
        bump()
    }

    const applyPersistentPosture = (noid, posture, serverOrient = 0, serverActivity = 129) => {
        if (noid == null || !PERSISTENT_POSTURES.has(posture)) return false
        const base = getOrient(noid, serverOrient)
        activityOverrides.set(noid, posture)
        orientOverrides.set(noid, orientForPosture(posture, base))
        states.delete(noid)
        bump()
        return true
    }

    // chore.m inner_set_chore change_orient: a face_left/face_right command does NOT
    // change posture. Walking → ignore; stand_front/back → turn to the side; ANY other
    // posture (notably sitting) → just flip the orientation bit and KEEP the activity,
    // so a seated avatar mirrors in place instead of standing up.
    const SIT_POSTURES = new Set([132, 133, 157]) // SIT_GROUND, SIT_CHAIR, SIT_FRONT
    const faceCursor = (noid, faceLeft, serverOrient = 0, serverActivity = 129) => {
        if (noid == null) return
        if (states.get(noid)?.type === "walk") return // C64: no facing change while walking
        const activity = getActivity(noid, serverActivity)
        if (SIT_POSTURES.has(activity)) {
            const base = getOrient(noid, serverOrient)
            orientOverrides.set(noid, faceLeft ? (base | 0x01) : (base & ~0x01))
            bump()
            return
        }
        // Standing (incl. stand_front/back): track facing as a persistent posture; this
        // forces the orient bit via displayOrientForActivity and renders 'stand'.
        applyPersistentPosture(noid, faceLeft ? FACE_LEFT : FACE_RIGHT, serverOrient, serverActivity)
    }

    const beginGesture = (noid, action, serverOrient = 0, serverActivity = 129, holdActivity = null) => {
        if (noid == null || !action || action === "stand") return
        const item = { action, serverOrient, serverActivity, holdActivity }
        const active = states.get(noid)
        if (active && !active.frozen) {
            if (!gestureQueues.has(noid)) gestureQueues.set(noid, [])
            gestureQueues.get(noid).push(item)
            return
        }
        startGestureNow(noid, action, serverOrient, serverActivity, holdActivity) // replaces a held (frozen) gesture
    }

    const noteServerFacing = (noid) => {
        if (noid == null) return
        orientOverrides.delete(noid)
        activityOverrides.delete(noid)
    }

    const onOp = (msg, serverOrient = 0, serverActivity = 129) => {
        if (!msg?.op || msg.noid == null) return
        if (msg.op === "WALK$") return // handled before world.apply in live.js
        if (msg.op === "POSTURE$" && msg.new_posture != null) {
            if (applyPersistentPosture(msg.noid, msg.new_posture, serverOrient, serverActivity)) return
        }
        const fn = OP_GESTURE[msg.op]
        if (fn) beginGesture(msg.noid, fn(msg), serverOrient, serverActivity)
    }

    const clear = () => {
        states.clear()
        gestureQueues.clear()
        orientOverrides.clear()
        activityOverrides.clear()
        bump()
    }

    return {
        tick, get, getOrient, getActivity, noteCycleLength, noteServerFacing,
        beginWalk, beginGesture, applyPersistentPosture, faceCursor, onOp, clear, FRAME_MS: frameMs,
        isAnimating, whenIdle,
    }
}