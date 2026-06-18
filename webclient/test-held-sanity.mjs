// Sanity-check held anchor vs limb tab over a full walk choreography cycle.
// Walk bob is single-digit pixels: hand yRel varies during hand anim (limb 5, anim 1);
// cy_tab[5] barely moves. Do NOT advance only the hand limb in isolation.
// In browser devtools on live.html:
//   const m = await import("./test-held-sanity.mjs"); await m.logHeldSanity()
import { decodeBody } from "./habirender/codec.js"

const walkCycleLength = (body) => {
    const choreIndex = body.actions.walk
    const animations = body.limbs.map((l) => ({ ...l.animations[0], current: l.animations[0].startState }))
    for (const ov of body.choreography[choreIndex] ?? []) {
        const na = body.limbs[ov.limb]?.animations[ov.animation]
        if (na) { animations[ov.limb].startState = na.startState; animations[ov.limb].endState = na.endState }
    }
    const scratch = animations.map((a) => ({ ...a }))
    let count = 0
    for (;;) {
        count++
        let restarted = 0
        for (const a of scratch) {
            a.current = a.current ?? a.startState
            a.current++
            if (a.current > a.endState) { a.current = a.startState; restarted++ }
        }
        if (restarted === scratch.length) break
    }
    return count
}

const findCelXY = (x, y, xRel, yRel) => (xRel === 0 && yRel === 0 ? { x, y } : { x: x + xRel, y: y - yRel })
const findCelXYHeld = (tabX, tabY, xRel, yRel, ox, oy) =>
    (xRel === 0 && yRel === 0 ? { x: ox, y: oy } : findCelXY(tabX, tabY, xRel, yRel))

const chainAt = (body, actionName, frameIndex) => {
    const choreIndex = body.actions[actionName]
    const animations = body.limbs.map((l) => ({ ...l.animations[0], current: l.animations[0].startState }))
    for (const ov of body.choreography[choreIndex] ?? []) {
        const na = body.limbs[ov.limb]?.animations[ov.animation]
        if (na) {
            animations[ov.limb].startState = na.startState
            animations[ov.limb].endState = na.endState
            animations[ov.limb].current = na.startState
        }
    }
    for (let i = 0; i < frameIndex; i++) {
        let restarted = 0
        for (const a of animations) {
            a.current++
            if (a.current > a.endState) { a.current = a.startState; restarted++ }
        }
        if (restarted === animations.length) break
    }
    let x = 0, y = 0, xRel = 0, yRel = 0
    let tab = null, hand = null, handCel = null
    for (let i = 0; i < body.limbs.length; i++) {
        const frame = animations[i].current ?? animations[i].startState
        const istate = body.limbs[i].frames[frame]
        const cel = istate >= 0 ? body.limbs[i].cels[istate] : null
        const pos = findCelXY(x, y, xRel, yRel)
        if (i === 5 && cel) {
            tab = { x: pos.x, y: pos.y }
            hand = findCelXYHeld(tab.x, tab.y, cel.xRel, cel.yRel, tab.x, tab.y)
            handCel = cel
        }
        x = pos.x; y = pos.y
        xRel = cel?.xRel ?? 0
        yRel = cel?.yRel ?? 0
    }
    return { tab, hand, handCel, limbFrames: animations.map((a, i) => `${i}:${a.current ?? a.startState}`) }
}

export const logHeldSanity = async () => {
    const res = await fetch("habirender/bodies/Avatar.bin")
    const body = decodeBody(new DataView(await res.arrayBuffer()))
    const cycle = walkCycleLength(body)
    const tabYs = [], handYs = [], yRels = []
    for (let f = 0; f < cycle; f++) {
        const { tab, hand, handCel, limbFrames } = chainAt(body, "walk", f)
        tabYs.push(tab.y); handYs.push(hand.y); yRels.push(handCel.yRel)
        console.log(`walk f${f}`, { limbFrames: limbFrames.join(" "), tabY: tab.y, handY: hand.y,
            yRel: handCel.yRel, yOff: handCel.yOffset })
    }
    const span = (arr) => Math.max(...arr) - Math.min(...arr)
    const spans = { tabY: span(tabYs), handY: span(handYs), yRel: span(yRels) }
    console.log("walk Y spans (expect single digits for handY/yRel bob):", spans)
    console.assert(spans.handY <= 12, `handY bob should be ~single digits, got span ${spans.handY}`)
    console.assert(spans.tabY <= 4, `cy_tab[5] should barely move during walk, got span ${spans.tabY}`)
    console.assert(spans.handY === spans.yRel, "handY bob tracks hand cel yRel via find_cel_xy")
    console.log("held placeY bob = yRel delta from stand (expect ~7px during walk)")
}