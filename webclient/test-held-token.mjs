// Held token: decodeProp animation table parses tok.bin cycle 0→4.
import { readFileSync } from "fs"

const decodeAnimations = (data, startEndTableOff, nextBlockOff, stateCount) => {
    const animations = []
    if (startEndTableOff !== 0) {
        for (let frameOff = startEndTableOff;
            (startEndTableOff > nextBlockOff) || (frameOff < nextBlockOff);
            frameOff += 2) {
            const cycle = (data.getUint8(frameOff) & 0x80) !== 0
            const startState = data.getUint8(frameOff) & 0x7f
            const endState = data.getUint8(frameOff + 1)
            if (startState >= stateCount || endState >= stateCount) break
            animations.push({ cycle, startState, endState })
        }
    }
    return animations
}

const buf = readFileSync("habirender/props/tok.bin")
const data = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const stateCount = (data.getUint8(0) & 0x3f) + 1
const graphicStateOff = data.getUint8(2)
const contentsXYOff = data.getUint8(3) & 0x7f
const celMasksOff = 7
const celOffsetsOff = celMasksOff + stateCount
let allCelsMask = 0
for (let i = 0; i < stateCount; i++) allCelsMask |= data.getUint8(celMasksOff + i)
let firstCelOff = Infinity
for (let off = celOffsetsOff; allCelsMask !== 0; off += 2) {
    firstCelOff = Math.min(firstCelOff, data.getUint16(off, true))
    allCelsMask = (allCelsMask << 1) & 0xff
}
const animEndBound = (contentsXYOff === 0 || contentsXYOff < graphicStateOff)
    ? firstCelOff : contentsXYOff
const animations = decodeAnimations(data, graphicStateOff, animEndBound, stateCount)

if (animations.length !== 1) {
    throw new Error(`tok.bin: expected 1 animation, got ${animations.length}`)
}
const anim = animations[0]
if (!anim.cycle || anim.startState !== 0 || anim.endState !== 4) {
    throw new Error(`tok.bin: expected cycle 0→4, got ${JSON.stringify(anim)}`)
}
const cycleLen = anim.endState - anim.startState + 1
if (cycleLen !== 5) throw new Error(`tok cycle length: expected 5, got ${cycleLen}`)
console.log("test-held-token: ok")