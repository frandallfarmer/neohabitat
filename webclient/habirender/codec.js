const LE = true // little-endian

// JS bitmap format: array of scanlines, each scanline being an array of numbers from 0-3
export const emptyBitmap = (w, h, color = 0) => {
    const bitmap = []
    for (let y = 0; y < h; y ++) {
        const scanline = []
        for (let x = 0; x < w; x ++) {
            scanline.push(color)
            scanline.push(color)
            scanline.push(color)
            scanline.push(color)
        }
        bitmap.push(scanline)
    }
    return bitmap
}

export const drawByte = (bitmap, x, y, byte, transparent = false) => {
    const putpixel = (x, pixel) => {
        if (pixel != 0 || !transparent) {
            bitmap[y][x] = pixel
        }
    }
    putpixel(x,     (byte & 0xc0) >> 6)
    putpixel(x + 1, (byte & 0x30) >> 4)
    putpixel(x + 2, (byte & 0x0c) >> 2)
    putpixel(x + 3, (byte & 0x03))
}

export const signedByte = (byte) => {
    if ((byte & 0x80) != 0) {
        const complement = (byte ^ 0xff) + 1
        return -complement
    } else {
        return byte
    }
}

const decodeHowHeld = (byte) => {
    const heldVal = byte & 0xc0
    if (heldVal == 0) {
        return "swing"
    } else if (heldVal == 0x40) {
        return "out"
    } else if (heldVal == 0x80) {
        return "both"
    } else {
        return "at_side"
    }
}

const encodeHowHeld = (howHeld) => {
    if (howHeld == "swing") {
        return 0x00
    } else if (howHeld == "out") {
        return 0x40
    } else if (howHeld == "both") {
        return 0x80
    } else if (howHeld == "at_side") {
        return 0xc0
    } else {
        throw new Error(`Unknown hold "${howHeld}"`)
    }
}

const decodeCelType = (byte) => {
    const typeVal = byte & 0xc0
    if (typeVal == 0x00) {
        if ((byte & 0x20) == 0) {
            return "bitmap"
        } else {
            return "text"
        }
    } else if (typeVal == 0x40) {
        return "trap"
    } else if (typeVal == 0x80) {
        return "box"
    } else {
        return "circle"
    }
}

const encodeCelType = (type) => {
    if (type == "bitmap") {
        return 0x00
    } else if (type == "text") {
        return 0x20
    } else if (type == "trap") {
        return 0x40
    } else if (type == "box") {
        return 0x80
    } else if (type == "circle") {
        return 0xc0
    } else {
        throw new Error(`Unknown cel type "${type}"`)
    }
}

const celDecoder = {}
const celEncoder = {}

celDecoder.bitmap = (data, cel) => {
    // bitmap cells are RLE-encoded vertical strips of bytes. Decoding starts from the bottom-left
    // and proceeds upwards until the top of the bitmap is hit; then then next vertical strip is decoded.
    // Each byte describes four 2-bit pixels.
    const bitmap = emptyBitmap(cel.width, cel.height)
    let ibmp = 0
    const end = cel.width * cel.height
    const putByte = (byte) => {
        const x = Math.floor(ibmp / cel.height) * 4
        const y = (cel.height - (ibmp % cel.height)) - 1
        drawByte(bitmap, x, y, byte)
        ibmp ++
    }
    let i = 6
    while (ibmp < end) {
        const byte = data.getUint8(i)
        i ++
        if (byte == 0) {
            // A zero byte denotes the start of a run of identical bytes. The second
            // byte denotes the number of repetitions.
            const count = data.getUint8(i)
            i ++
            if ((count & 0x80) == 0) {
                // if the high bit of the count is not set, we read a third byte to
                // determine the byte to repeat.
                const val = data.getUint8(i)
                i ++
                for (let repeat = 0; repeat < count; repeat ++) {
                    putByte(val)
                }
            } else {
                // if the high bit of the count is set, the lower 7 bits are used as
                // the count, and a fully transparent byte is repeated.
                for (let repeat = 0; repeat < (count & 0x7f); repeat ++) {
                    putByte(0)
                }
            }
        } else {
            // non-zero bytes are raw bitmap data
            putByte(byte)
        }
    }
    cel.bitmap = bitmap
}

celDecoder.box = (data, cel) => {
    const bitmap = emptyBitmap(cel.width, cel.height)
    cel.borderLR = (data.getUint8(0) & 0x20) != 0
    cel.borderTB = (data.getUint8(0) & 0x10) != 0
    cel.pattern = data.getUint8(6)
    for (let y = 0; y < cel.height; y ++) {
        for (let x = 0; x < cel.width; x ++) {
            if (cel.borderTB && (y == 0 || y == (cel.height - 1))) {
                drawByte(bitmap, x * 4, y, 0xaa)
            } else {
                drawByte(bitmap, x * 4, y, cel.pattern)
            }
        }
        if (cel.borderLR) {
            const line = bitmap[y]
            line[0] = 2
            line[line.length - 1] = 2
        }
    }
    cel.bitmap = bitmap
}

export const horizontalLine = (bitmap, xa, xb, y, patternByte) => {
    const xStart = xa - (xa % 4)
    const xEnd = (xb + (3 - (xb % 4))) - 3
    for (let x = xStart + 4; x < xEnd; x += 4) {
        drawByte(bitmap, x, y, patternByte)
    }
    const startBit = ((xa - xStart) * 2)
    const endBit = (((xEnd + 3) - xb) * 2)
    if (xStart != xEnd) {
        const startByte = (0xff >> startBit) & patternByte
        const endByte = (0xff << endBit) & patternByte
        drawByte(bitmap, xStart, y, startByte, true)
        drawByte(bitmap, xEnd, y, endByte, true)
    } else {
        const byte = (0xff >> startBit) & (0xff << endBit) & patternByte
        drawByte(bitmap, xStart, y, byte, true)
    }
}

export const trapTextureToBitmap = (texW, texH, getByte) => {
    const texture = emptyBitmap(texW, texH)
    let i = 0
    // dline.m:111 - the y position into the texture is calculated by
    // ANDing y1 with the height mask; thus, unlike prop bitmaps, we decode
    // from the top down
    for (let y = 0; y < texH; y ++) {
        for (let x = 0; x < texW; x ++) {
            drawByte(texture, x * 4, y, getByte(i))
            i ++
        }
    }
    return texture
}

celDecoder.trap = (data, cel) => {
    cel.border = false
    // trap.m:21 - high-bit set means "draw a border"
    // It looks like this was used as a flag and the real height
    // was ORed with 0x80 - see house2.m, sign2.m
    // There are also trapezoids that use 0x80 as their height - 
    // bwall6.m, bwall7.m, bwall9.m, magic_wall.m
    // This appears to be special-cased to mean "no border" at trap.m:26
    // mix.m:253 appears to have the logic to calculate y2, extracting
    // the height by ANDing with 0x7f (when not 0x80)
    if ((cel.height & 0x80) != 0 && cel.height != 0x80) {
        cel.border = true
        cel.height = cel.height & 0x7f
    }
    if ((data.getUint8(0) & 0x10) == 0) {
        // shape_pattern is a repeating 4-pixel colour, same as box
        cel.pattern = data.getUint8(6)
    } else {
        // shape_pattern is 0xff, and the pattern is a bitmap that follows
        // the trapezoid definition
        // dline.m:103 - first two bytes are bitmasks used for efficiently calculating
        // offsets into the texture. This means that the dimensions will be a power of 
        // two, and we can get the width and height simply by adding one to the mask.
        const texW = data.getUint8(11) + 1
        const texH = data.getUint8(12) + 1
        cel.texture = trapTextureToBitmap(texW, texH, i => data.getUint8(13 + i))
    }

    cel.raw = {
        width: cel.width,
        x1a: data.getUint8(7),
        x1b: data.getUint8(8),
        x2a: data.getUint8(9),
        x2b: data.getUint8(10)
    }
}

celDecoder.text = (data, cel) => {
    cel.pattern = data.getUint8(6)
    cel.fineXOffset = data.getInt8(7)
}

const decodeCel = (data, changesColorRam) => {
    const cel = { 
        data: data,
        changesColorRam: changesColorRam,
        type: decodeCelType(data.getUint8(0)),
        width: data.getUint8(0) & 0x0f,
        height: data.getUint8(1),
        xOffset: data.getInt8(2),
        yOffset: data.getInt8(3),
        xRel: data.getInt8(4),
        yRel: data.getInt8(5)
    }
    if (celDecoder[cel.type]) {
        celDecoder[cel.type](data, cel)
    }
    return cel
}

const decodeSide = (byte) => {
    const side = byte & 0x03
    if (side == 0x00) {
        return "left"
    } else if (side == 0x01) {
        return "right"
    } else if (side == 0x02) {
        return "up"
    } else {
        return "down"
    }
}
const encodeSide = (side) => {
    if (side == "left") {
        return 0x00
    } else if (side == "right") {
        return 0x01
    } else if (side == "up") {
        return 0x02
    } else if (side == "down") {
        return 0x03
    } else {
        throw new Error(`Unknown side "${side}"`)
    }
}

const decodeWalkto = (byte) => {
    return { fromSide: decodeSide(byte), offset: signedByte(byte & 0xfc) }
}

const encodeWalkto = ({ fromSide, offset }) => {
    return encodeSide(fromSide) | (offset & 0xfc)
}

const decodeAnimations = (data, startEndTableOff, nextBlockOff, stateCount) => {
    const animations = []
    // The prop structure also does not encode a count for how many frames there are, so we simply
    // stop parsing once we find one that doesn't make sense.
    // We also use the heuristic that this structure always precedes the first cel, as that seems to be 
    // consistently be the case with all the props in the Habitat source tree. We'll stop reading
    // animation data if we cross that boundary. If we encounter a prop that has the animation data
    // _after_ the cel data, which would be legal but doesn't happen in practice, then we ignore this
    // heuristic rather than failing to parse any animation data.
    // It's possible for there to be no frames, which is represented by an offset of 0 (no_animation)
    if (startEndTableOff != 0) {
        for (let frameOff = startEndTableOff; (startEndTableOff > nextBlockOff) || (frameOff < nextBlockOff); frameOff += 2) {
            // each animation is two bytes: the starting state, and the ending state
            // the first byte can have its high bit set to indicate that the animation should cycle
            const cycle = (data.getUint8(frameOff) & 0x80) != 0
            const startState = data.getUint8(frameOff) & 0x7f
            const endState = data.getUint8(frameOff + 1)
            if (startState >= stateCount || endState >= stateCount) {
                break
            }
            animations.push({ cycle: cycle, startState: startState, endState: endState })
        }
    }
    return animations
}

const decodeContentsXY = (data, off, nextBlockOff) => {
    const offsets = []
    // The prop structure doesn't encode the capacity of an open container - the only way to know
    // how big this block is without digging into other files is to use the offset of the first cel as 
    // a boundary, as, in practice, this should be true of all existing props. (An object's capacity is 
    // defined in beta.mud, but that's per-object, not per-image. Building that association would be more
    // complex than is needed here.)
    // Non-containers and closed containers will have 0 here (no_cont).
    if (off != 0) {
        for (let xyOff = off; xyOff < nextBlockOff; xyOff += 2) {
            offsets.push({ x: data.getInt8(xyOff), y: data.getInt8(xyOff + 1) })
        }
    }
    return offsets
}

export const decodeProp = (data) => {
    const prop = { 
        data: data,
        howHeld: decodeHowHeld(data.getUint8(0)),
        colorBitmask: data.getUint8(1),
        contentsInFront: (data.getUint8(3) & 0x80) == 0,
        walkto: { left: decodeWalkto(data.getUint8(4)), right: decodeWalkto(data.getUint8(5)), yoff: data.getInt8(6) },
        celmasks: [],
        cels: []
    }
    const stateCount = (data.getUint8(0) & 0x3f) + 1
    const graphicStateOff = data.getUint8(2)
    const celMasksOff = 7
    const celOffsetsOff = celMasksOff + stateCount

    // The prop structure does not directly encode a count for how many cels there are, but each
    // "graphic state" is defined by a bitmask marking which cels are present, and we do know how
    // many states there are. We can assume that all cels are referenced by at least one state,
    // and use that to determine the cel count.
    let allCelsMask = 0
    for (let icelmask = 0; icelmask < stateCount; icelmask ++) {
        const celmask = data.getUint8(celMasksOff + icelmask)
        prop.celmasks.push(celmask)
        allCelsMask |= celmask
    }
    if (allCelsMask != 0x80 && allCelsMask != 0xc0 && allCelsMask != 0xe0 && allCelsMask != 0xf0 &&
        allCelsMask != 0xf8 && allCelsMask != 0xfc && allCelsMask != 0xfe && allCelsMask != 0xff) {
        throw new Error("Inconsistent graphic state cel masks - implies unused cel data")
    }
    let firstCelOff = Number.POSITIVE_INFINITY
    for (let celOffsetOff = celOffsetsOff; allCelsMask != 0; celOffsetOff += 2) {
        const icel = prop.cels.length
        const celbit = 0x80 >> icel
        const celOff = data.getUint16(celOffsetOff, LE)
        firstCelOff = Math.min(celOff, firstCelOff)
        prop.cels.push(decodeCel(new DataView(data.buffer, celOff), (prop.colorBitmask & celbit) != 0))
        allCelsMask = (allCelsMask << 1) & 0xff
    }
    const contentsXYOff = data.getUint8(3) & 0x7f
    prop.animations = decodeAnimations(data, graphicStateOff, contentsXYOff == 0 ? firstCelOff : contentsXYOff, stateCount)
    prop.contentsXY = decodeContentsXY(data, contentsXYOff, firstCelOff)
    return prop
}

const decodeLimb = (data, limb) => {
    let frameCount = data.getUint8(0) + 1
    limb.frames = []
    for (let iframe = 0; iframe < frameCount; iframe ++) {
        limb.frames.push(data.getInt8(3 + iframe))
    }
    const celOffsetsOff = 3 + frameCount
    const maxCelIndex = Math.max(...limb.frames)
    limb.cels = []
    let firstCelOff
    for (let icel = 0; icel <= maxCelIndex; icel ++) {
        const celOff = data.getUint16(celOffsetsOff + (icel * 2), LE)
        if (icel == 0) {
            firstCelOff = celOff
        }
        limb.cels.push(decodeCel(new DataView(data.buffer, data.byteOffset + celOff)))
    }
    limb.animations = decodeAnimations(data, data.getUint8(2), firstCelOff, limb.frames.length)
}

export const choreographyActions = [
    "init", "stand", "walk", "hand_back", "sit_floor", "sit_chair", "bend_over", 
    "bend_back", "point", "throw", "get_shot", "jump", "punch", "wave",
    "frown", "stand_back", "walk_front", "walk_back", "stand_front",
    "unpocket", "gimme", "knife", "arm_get", "hand_out", "operate",
    "arm_back", "shoot1", "shoot2", "nop", "sit_front"
]

export const decodeBody = (data) => {
    const body = {
        data: data,
        headCelNumber: data.getUint8(19),
        frozenWhenStands: data.getUint8(20),
        frontFacingLimbOrder: [],
        backFacingLimbOrder: [],
        limbs: [],
        choreography: [],
        actions: {}
    }
    for (let ilimb = 0; ilimb < 6; ilimb ++) {
        body.frontFacingLimbOrder.push(data.getUint8(27 + ilimb))
        body.backFacingLimbOrder.push(data.getUint8(33 + ilimb))
        const limb = {
            pattern: data.getUint8(21 + ilimb),
            affectedByHeight: data.getUint8(39 + ilimb)
        }
        const limbOff = data.getUint16(7 + (ilimb * 2), LE)
        decodeLimb(new DataView(data.buffer, limbOff), limb)
        body.limbs.push(limb)
    }
    const choreographyIndexOff = data.getUint16(0, LE)
    const choreographyTableOff = data.getUint16(2, LE)
    const indexToChoreography = new Map()
    for (const [i, action] of choreographyActions.entries()) {
        let tableIndex = data.getUint8(choreographyIndexOff + i)
        let choreographyIndex = indexToChoreography.get(tableIndex)
        if (choreographyIndex == undefined) {
            choreographyIndex = body.choreography.length
            indexToChoreography.set(tableIndex, choreographyIndex)
            const choreography = []
            body.choreography.push(choreography)
            for (;; tableIndex ++) {
                const state = data.getUint8(choreographyTableOff + tableIndex)
                let limb = (state & 0x70) >> 4
                let animation = state & 0x0f
                if (limb == 6) {
                    limb = 5
                    animation += 0x10
                }
                choreography.push({ limb, animation })
                if ((state & 0x80) != 0) {
                    break
                }
            }
        }
        body.actions[action] = choreographyIndex
    }
    return body
}

export const decodeCharset = (source) => {
    source = source.replaceAll(/;.*/g, "") // strip comments
    const characters = []
    let rows = []
    let irow = 0
    const addByte = (byte) => {
        rows.push(byte)
        if (irow == 7) {
            characters.push(rows)
            rows = []
            irow = 0
        } else {
            irow ++
        }
    }
    for (const match of source.match(/0[^,\s]*/g)) {
        const byte = Number(match)
        if (byte >= 0 && byte < 256) {
            addByte(byte)
        } else {
            throw new Error(`Couldn't parse ${match} as a byte`)
        }
    }
    if (characters.length == 129) {
         // charset.m has an extra blank character at the end for some reason
         // AFAICT, it is truncated when written to disk.
        characters.pop()
    }
    if (characters.length != 128) {
        throw new Error(`Unexpected number of character ${characters.length}`)
    }
    // text.m has no logic to filter out bytes >128 that aren't control codes.
    // As such, if it encounters one, it will draw whatever is stored in RAM
    // after the charset. There are some regions (mostly test regions and bad 
    // dumps) with signs containing these non-characters.
    // The thing that is stored in RAM immediately after the charset is tables.m,
    // containing four simple 256-byte lookup tables. For maximum accuracy,
    // we recreate those tables here.

    const pixelsFromByte = (i) => [
        (i & 0xc0) >> 6,
        (i & 0x30) >> 4,
        (i & 0x0c) >> 2,
        (i & 0x03)
    ]
    const byteFromPixels = (pix1, pix2, pix3, pix4) => (pix1 << 6) | (pix2 << 4) | (pix3 << 2) | pix4

    // reverse_pixels
    for (let i = 0; i < 256; i ++) {
        const [pix1, pix2, pix3, pix4] = pixelsFromByte(i)
        addByte(byteFromPixels(pix4, pix3, pix2, pix1))
    }

    // bluescreen
    for (let i = 0; i < 256; i ++) {
        const [pix1, pix2, pix3, pix4] = pixelsFromByte(i)
        addByte(byteFromPixels(pix1 == 0 ? 3 : 0, pix2 == 0 ? 3 : 0, pix3 == 0 ? 3 : 0, pix4 == 0 ? 3 : 0))
    }

    // ora_table
    for (let i = 0; i < 256; i ++) {
        const [pix1, pix2, pix3, pix4] = pixelsFromByte(i)
        addByte(byteFromPixels(pix1 == 1 ? 0 : pix1, pix2 == 1 ? 0 : pix2, pix3 == 1 ? 0 : pix3, pix4 == 1 ? 0 : pix4))
    }

    // mask_blue
    for (let i = 0; i < 256; i ++) {
        const [pix1, pix2, pix3, pix4] = pixelsFromByte(i)
        addByte(byteFromPixels(pix1 == 1 ? 3 : 0, pix2 == 1 ? 3 : 0, pix3 == 1 ? 3 : 0, pix4 == 1 ? 3 : 0))
    }

    if (irow != 0) {
        throw new Error(`Partial character (${irow}/8)`)
    }
    return characters
}
