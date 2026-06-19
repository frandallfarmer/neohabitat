// Stand/walk hand anchor + paper paint position sanity check.
// Open live.html, import this module in devtools, or: node won't load codec (browser-only).
import { decodeBody } from "./habirender/codec.js"

const findCelXY = (x, y, xRel, yRel) => (xRel === 0 && yRel === 0 ? { x, y } : { x: x + xRel, y: y - yRel })

const chainForAction = (body, actionName) => {
    const choreIndex = body.actions[actionName]
    const animations = body.limbs.map((l) => ({ ...l.animations[0], current: l.animations[0].startState }))
    for (const ov of body.choreography[choreIndex] ?? []) {
        const na = body.limbs[ov.limb]?.animations[ov.animation]
        if (na) { animations[ov.limb].startState = na.startState; animations[ov.limb].endState = na.endState; animations[ov.limb].current = na.startState }
    }
    let x = 0, y = 0, xRel = 0, yRel = 0
    let handTabX = 0, handTabY = 0, handRelX = 0, handRelY = 0
    const out = { cx: [], cy: [], hand: null, handCel: null }
    for (let i = 0; i < body.limbs.length; i++) {
        const frame = animations[i].current
        const istate = body.limbs[i].frames[frame]
        const cel = istate >= 0 ? body.limbs[i].cels[istate] : null
        const pos = findCelXY(x, y, xRel, yRel)
        out.cx[i] = pos.x
        out.cy[i] = pos.y
        if (i === 5 && cel) {
            handTabX = pos.x
            handTabY = pos.y
            handRelX = cel.xRel
            handRelY = cel.yRel
            out.handCel = { xOffset: cel.xOffset, yOffset: cel.yOffset, height: cel.height }
        }
        x = pos.x; y = pos.y
        xRel = cel?.xRel ?? 0
        yRel = cel?.yRel ?? 0
    }
    out.hand = findCelXY(handTabX, handTabY, handRelX, handRelY)
    out.placeY = out.cy[5] + (out.handCel?.yRel ?? 0)
    return out
}

// Held props are not pre-flipped; flipComposedFrame mirrors the whole avatar on side view.
const heldPaintX = (handX, xOffset) => handX - 2 * xOffset

export const logHeldComposeCheck = async () => {
    const res = await fetch("habirender/bodies/Avatar.bin")
    const body = decodeBody(new DataView(await res.arrayBuffer()))
    const { decodeProp } = await import("./habirender/codec.js")
    for (const [label, file] of [["paper", "props/paper.bin"], ["tokens", "props/tok.bin"]]) {
        const prop = decodeProp(new DataView(await (await fetch(`habirender/${file}`)).arrayBuffer()))
        const pc = prop.cels[0]
        for (const action of ["stand", "walk"]) {
            const { hand, handCel, cy } = chainForAction(body, action)
            const placeY = cy[5] + (handCel?.yRel ?? 0)
            const placeX = heldPaintX(hand.x, pc.xOffset)
            const heldTop = placeY + pc.yOffset
            const heldBottom = heldTop - pc.height
            console.log(label, action, {
                handX: hand.x,
                placeX,
                xOffset: pc.xOffset,
                paintLeft: placeX + pc.xOffset,
                c64PaintLeft: hand.x - pc.xOffset,
                placeY,
                heldTop,
                heldBottom,
                inBody: heldTop >= 0 && heldBottom <= 60,
            })
            console.assert(placeX + pc.xOffset === hand.x - pc.xOffset,
                `${label} held X should match paint.m cel_x - xOffset`)
        }
    }
}