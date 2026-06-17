import { html } from "./view.js"
import { createContext } from "preact"
import { useState, useEffect, useContext } from "preact/hooks"
import { emptyBitmap, horizontalLine } from "./codec.js"
import { makeCanvas } from "./shim.js"

// C64 RGB values generated from https://www.colodore.com/ with default settings
export const c64Colors = [
    0x000000, 0xffffff, 0x813338, 0x75cec8, 0x8e3c97, 0x56ac4d, 
    0x2e2c9b, 0xedf171, 0x8e5029, 0x553800, 0xc46c71, 0x4a4a4a,
    0x7b7b7b, 0xa9ff9f, 0x706deb, 0xb2b2b2
]

// from paint.m:447
export const celPatterns = [
    [0x00, 0x00, 0x00, 0x00],
    [0xaa, 0xaa, 0xaa, 0xaa],
    [0xff, 0xff, 0xff, 0xff],
    [0xe2, 0xe2, 0xe2, 0xe2],
    [0x8b, 0xbe, 0x0f, 0xcc],
    [0xee, 0x00, 0xee, 0x00],
    [0xf0, 0xf0, 0x0f, 0x0f],
    [0x22, 0x88, 0x22, 0x88],
    [0x32, 0x88, 0x23, 0x88],
    [0x00, 0x28, 0x3b, 0x0c],
    [0x33, 0xcc, 0x33, 0xcc],
    [0x08, 0x80, 0x0c, 0x80],
    [0x3f, 0x3f, 0xf3, 0xf3],
    [0xaa, 0x3f, 0xaa, 0xf3],
    [0xaa, 0x00, 0xaa, 0x00],
    [0x55, 0x55, 0x55, 0x55]
]

export const canvasForSpace = ({ minX, maxX, minY, maxY }) => makeCanvas((maxX - minX) * 8, maxY - minY)

export const defaultColors = {
    wildcard: 6,
    skin: 10,
    pattern: 15
}

export const rgbaFromNibble = (nibble, x, y, colors) => {
    const { wildcard, pattern, skin } = colors
    const patternColors = [6, wildcard, 0, skin]
    // TODO: What is pattern 255?
    const patbyte = celPatterns[pattern < 0 || pattern > 15 ? 15 : pattern][y % 4]
    let color
    if (nibble == 0) { // transparent
        return 0
    } else if (nibble == 1) { // wild
        const shift = (x % 4) * 2
        color = patternColors[(patbyte & (0xc0 >> shift)) >> (6 - shift)]
    } else {
        color = patternColors[nibble]
    }
    return (c64Colors[color] << 8) | 0xff
}

export const canvasFromBitmap = (bitmap, colors = {}, canvas = null) => {
    if (bitmap.length == 0 || bitmap[0].length == 0) {
        return null
    }
    colors = { ...defaultColors, ...colors }
    const h = bitmap.length
    const w = bitmap[0].length * 2
    if (canvas) {
        canvas.width = w
        canvas.height = h
    } else {
        canvas = makeCanvas(w, h)
    }
    const ctx = canvas.getContext("2d")
    const img = ctx.createImageData(w, h)
    
    const putpixel = (x, y, r, g, b, a) => {
        const i = (x * 8) + (y * w * 4)
        img.data[i]     = r
        img.data[i + 1] = g
        img.data[i + 2] = b
        img.data[i + 3] = a
        img.data[i + 4] = r
        img.data[i + 5] = g
        img.data[i + 6] = b
        img.data[i + 7] = a
    }

    for (let y = 0; y < bitmap.length; y ++) {
        const line = bitmap[y]
        for (let x = 0; x < line.length; x ++) {
            const rgba = rgbaFromNibble(line[x], x, y, colors)
            putpixel(x, y, ((rgba & 0xff000000) >> 24) & 0xff, (rgba & 0xff0000) >> 16, (rgba & 0xff00) >> 8, rgba & 0xff)
        }
    }
    ctx.putImageData(img, 0, 0)
    return canvas
}

export const celsFromMask = (prop, celMask) => {
    const cels = []
    for (let icel = 0; icel < 8; icel ++) {
        const celbit = 0x80 >> icel
        if ((celMask & celbit) != 0) {
            cels.push(prop.cels[icel])
        }
    }
    return cels
}

// canvas coordinate spaces have the top-left corner at 0,0, x increasing to the right, y increasing down.
// habitat coordinate spaces have the object origin at 0,0, x increasing to the right, y increasing _up_.
// In addition, 1 unit horizontally in habitat coordinate space corresponds to 8 pixels horizontally in canvas space.
export const translateSpace = ({ minX, maxX, minY, maxY, ...extra }, dx, dy) => {
    return { ...extra, minX: minX + dx, maxX: maxX + dx, minY: minY + dy, maxY: maxY + dy }
}

export const compositeSpaces = (spaces) => {
    return { minX: Math.min(...spaces.map((f) => f ? f.minX : Math.min())),
             maxX: Math.max(...spaces.map((f) => f ? f.maxX : Math.max())),
             minY: Math.min(...spaces.map((f) => f ? f.minY : Math.min())),
             maxY: Math.max(...spaces.map((f) => f ? f.maxY : Math.max())) }
}

export const topLeftCanvasOffset = (outerSpace, innerSpace) => {
    if (innerSpace) {
        return [(innerSpace.minX - outerSpace.minX) * 8, outerSpace.maxY - innerSpace.maxY]
    } else {
        return [0, 0]
    }
}

export const drawInSpace = (ctx, canvas, ctxSpace, canvasSpace) => {
    const [x, y] = topLeftCanvasOffset(ctxSpace, canvasSpace)
    ctx.drawImage(canvas, x, y)
}

export const compositeLayers = (layers, xCorrect = 0, yCorrect = 0) => {
    const space = compositeSpaces(layers)

    const canvas = canvasForSpace(space)
    const ctx = canvas.getContext("2d")
    for (const layer of layers) {
        if (layer && layer.canvas) {
            drawInSpace(ctx, layer.canvas, space, layer)
        }
    }
    return {...translateSpace(space, -xCorrect, -yCorrect), canvas: canvas }
}

const TXTCMD = {
    halfSpace: 128 + 0,
    doubleSpace: 128 + 15,
    incWidth: 128 + 1,
    decWidth: 128 + 2,
    incHeight: 128 + 3,
    decHeight: 128 + 4,
    halfSize: 128 + 5,
    halfCharDown: 128 + 11,
    inverse: 128 + 12,
    cursorRight: 128 + 7,
    cursorLeft: 128 + 8,
    cursorUp: 128 + 9,
    cursorDown: 128 + 10,
    carriageReturn: 128 + 6,
    space: 0x20,
}

export const bitmapFromChar = (charset, byte, colors = {}) => {
    const { pixelWidth = 1, pixelHeight = 1, halfSize = false, inverse = true, pattern } = { ...defaultColors, ...colors }
    const charWidth = pixelWidth * (halfSize ? 4 : 8)
    const charHeight = pixelHeight * 8
    const masks = halfSize ? [0x80, 0x20, 0x08, 0x02] : [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01]
    if (halfSize && "BMWJwm".indexOf(String.fromCharCode(byte)) < 0) {
        masks[3] = 0x04
    }
    const char = charset[byte]
    const bitmap = emptyBitmap(charWidth / 4, charHeight)
    let x = 0
    let y = 0
    for (const rawrow of char) {
        const row = inverse ? rawrow ^ 0xff : rawrow
        for (let repeat = 0; repeat < pixelHeight; repeat ++) {
            for (const mask of masks) {
                if ((mask & row) != 0) {
                    horizontalLine(bitmap, x, x + pixelWidth - 1, y, pattern)
                }
                x += pixelWidth
            }
            x = 0
            y ++
        }
    }
    return bitmap
}

export const stringFromText = (bytes) => {
    let string = ""
    for (const byte of bytes) {
        if (byte >= 128) {
            const entry = Object.entries(TXTCMD).find(([k, v]) => v == byte)
            string += `<${entry ? entry[0] : byte}>`
        } else {
            string += String.fromCharCode(byte)
        }
    }
    return string
}

export const frameFromText = (x, y, bytes, charset, pattern, fineXOffset, colors = null) => {
    const initialX = x
    const layers = []
    let pixelWidth = 1
    let pixelHeight = 1
    let halfSize = true
    let inverse = true

    for (const byte of bytes) {
        const charWidth = pixelWidth * (halfSize ? 1 : 2)
        const charHeight = pixelHeight * 8
        if (byte == TXTCMD.halfSize) {
            halfSize = !halfSize
        } else if (byte == TXTCMD.inverse) {
            inverse = !inverse
        } else if (byte == TXTCMD.incWidth) {
            pixelWidth ++
        } else if (byte == TXTCMD.decWidth) {
            pixelWidth --
        } else if (byte == TXTCMD.incHeight) {
            pixelHeight ++
        } else if (byte == TXTCMD.decHeight) {
            pixelHeight --
        } else if (byte == TXTCMD.carriageReturn) {
            x = initialX
            y -= charHeight
        } else if (byte == TXTCMD.space) {
            x += charWidth
        } else if (byte == TXTCMD.doubleSpace) {
            x += (charWidth * 2)
        } else if (byte == TXTCMD.halfSpace) {
            x += (charWidth / 2)
        } else if (byte == TXTCMD.cursorUp) {
            y += charHeight
        } else if (byte == TXTCMD.cursorDown) {
            y -= charHeight
        } else if (byte == TXTCMD.halfCharDown) {
            y -= (charHeight / 2)
        } else if (byte == TXTCMD.cursorLeft) {
            x -= charWidth
        } else {
            const bitmap = bitmapFromChar(charset, byte, {...(colors ?? {}), pattern, pixelWidth, pixelHeight, halfSize, inverse })
            const canvas = canvasFromBitmap(bitmap, colors)
            layers.push({ canvas, minX: x + (fineXOffset / 4), maxX: x + charWidth + (fineXOffset / 4), minY: y - charHeight, maxY: y })
            x += charWidth
        }
    }
    return compositeLayers(layers)
}

const celLayerRenderer = {}
celLayerRenderer.default = (cel, colors, x, y) => {
    if (cel.bitmap) {
        return { canvas: canvasFromBitmap(cel.bitmap, colors), minX: x, minY: y - cel.height, maxX: x + cel.width, maxY: y }
    } else {
        return null
    }
}

celLayerRenderer.text = (cel, colors, x, y) => {
    const textColors = {...colors}
    let pattern = cel.pattern
    if (pattern == 0) {
         // TODO: this is a bit of a hack; the C64 code would accept a pattern of 0q0101
         // which would mean blue / wild / blue / wild. but canvasFromBitmap is not currently written
         // in such a way that this would work. In practice, the pattern byte is always one of four values.
        textColors.pattern = 15
        textColors.wildcard = 6
        pattern = 0x55
    }
    if (colors.charset) {
        return frameFromText(x, y, colors.bytes, colors.charset, pattern, cel.fineXOffset, textColors)
    } else {
        return null
    }
}

celLayerRenderer.trap = (cel, colors, x, y) => {
    const xOrigin = colors.xOrigin ?? 0

    cel.x1a = (cel.raw.x1a + ((xOrigin + x) * 4)) % 256
    cel.x1b = (cel.raw.x1b + ((xOrigin + x) * 4)) % 256
    cel.x2a = (cel.raw.x2a + ((xOrigin + x) * 4)) % 256
    cel.x2b = (cel.raw.x2b + ((xOrigin + x) * 4)) % 256
    if (cel.x1b < cel.x1a) { cel.x1b += 256 }
    if (cel.x2b < cel.x2a) { cel.x2b += 256 }
    cel.xCorrection = Math.floor(Math.min(cel.x1a, cel.x2a) / 4)
    cel.x1a -= cel.xCorrection * 4
    cel.x1b -= cel.xCorrection * 4
    cel.x2a -= cel.xCorrection * 4
    cel.x2b -= cel.xCorrection * 4

    // trapezoid-drawing algorithm:
    // draw_line: draws a line from x1a,y1 to x1b, y1
    // handles border drawing (last/first line, edges)
    // decreases vcount, then jumps to cycle1 if there
    // are more lines
    // cycle1: run bresenham, determine if x1a (left edge) needs to be incremented
    // or decremented (self-modifying code! the instruction in inc_dec1 is
    // written at trap.m:52)
    // has logic to jump back to cycle1 if we have a sharp enough angle that
    // we need to move more than one pixel horizontally
    // cycle2: same thing, but for x2a (right edge)
    // at the end, increments y1 and jumps back to the top of draw_line
    cel.width = Math.floor(Math.max(cel.x1a, cel.x1b, cel.x2a, cel.x2b) / 4) + 1
    // trap.m:32 - delta_y and vcount are calculated by subtracting y2 - y1.
    // mix.m:253: y2 is calculated as cel_y + cel_height
    // mix.m:261: y1 is calculated as cel_y + 1
    // So for a one-pixel tall trapezoid, deltay is 0, because y1 == y2.
    // vcount is decremented until it reaches -1, compensating for the off-by-one.
    const deltay = cel.height - 1
    cel.bitmap = emptyBitmap(cel.width, cel.height)
    const dxa = Math.abs(cel.x1a - cel.x2a)
    const dxb = Math.abs(cel.x1b - cel.x2b)
    const countMaxA = Math.max(dxa, deltay)
    const countMaxB = Math.max(dxb, deltay)
    const inca = cel.x1a < cel.x2a ? 1 : -1
    const incb = cel.x1b < cel.x2b ? 1 : -1
    let x1aLo = Math.floor(countMaxA / 2)
    let y1aLo = x1aLo
    let x1bLo = Math.floor(countMaxB / 2)
    let y1bLo = x1bLo
    let xa = cel.x1a
    let xb = cel.x1b

    if (deltay === 0) {
        throw new Error("Trapezoids with height 1 will cause an infinite loop in the C64 renderer")
    }

    for (let y = 0; y < cel.height; y ++) {
        const line = cel.bitmap[y]
        if (cel.border && (y == 0 || y == (cel.height - 1))) {
            // top and bottom border line
            horizontalLine(cel.bitmap, xa, xb, y, 0xaa, true)
        } else {
            if (cel.texture) {
                const texLine = cel.texture[y % cel.texture.length]
                for (let x = xa; x <= xb; x ++) {
                    line[x] = texLine[x % texLine.length]
                }
            } else {
                horizontalLine(cel.bitmap, xa, xb, y, cel.pattern, cel.border)
            }
        }
        
        if (cel.border) {
            line[xa] = 2
            line[xb] = 2
        }

        // cycle1: move xa
        do {
            x1aLo += dxa
            if (x1aLo >= countMaxA) {
                x1aLo -= countMaxA
                xa += inca
            }
            y1aLo += deltay
        } while (y1aLo < countMaxA)
        y1aLo -= countMaxA

        // cycle2: move xb
        do {
            x1bLo += dxb
            if (x1bLo >= countMaxB) {
                x1bLo -= countMaxB
                xb += incb
            }
            y1bLo += deltay
        } while (y1bLo < countMaxB)
        y1bLo -= countMaxB
    }
    const celColors = { ...colors }
    if (cel.texture) {
        // dline.m:132: ; convert wild color to blue
        // you can't have a trapezoid with a texture _and_ a pattern
        celColors.pattern = 15
    }
    const canvas = canvasFromBitmap(cel.bitmap, celColors)
    return { canvas, minX: cel.xCorrection - xOrigin, minY: y - cel.height, maxX: cel.xCorrection - xOrigin + cel.width, maxY: y }
}

// We try to consistently model Habitat's coordinate space in our rendering code as y=0 for the bottom, with increasing y meaning going up.
// However, the graphics code converts this internally to a coordinate space where increasing y means going down, and many internal
// coordinates (cel offsets, etc.) assume this.
export const frameFromCels = (cels, { colors: celColors, paintOrder, firstCelOrigin = true, flipHorizontal }) => {
    if (cels.length == 0) {
        return null
    }
    let xRel = 0
    let yRel = 0
    let xCorrect = 0
    let yCorrect = 0
    let layers = []
    for (const [icel, cel] of cels.entries()) {
        if (cel) {
            if (firstCelOrigin) {
                xCorrect = cel.xOffset
                yCorrect = cel.yOffset - cel.height
                firstCelOrigin = false
            }
            const x = cel.xOffset + xRel
            const y = cel.yOffset + yRel
            const colors = (Array.isArray(celColors) ? celColors[icel] : celColors) ?? {}
            layers.push((celLayerRenderer[cel.type] ?? celLayerRenderer.default)(cel, colors, x, y))
            xRel += cel.xRel 
            yRel += cel.yRel
        } else {
            layers.push(null)
        }
    }

    if (paintOrder) {
        const reordered = []
        for (const ilayer of paintOrder) {
            reordered.push(layers[ilayer])
        }
        layers = reordered
    }

    const frame = compositeLayers(layers)
    if (flipHorizontal) {
        frame.canvas = flipCanvas(frame.canvas)
        const { minX, maxX } = frame
        frame.minX = -maxX + 1
        frame.maxX = -minX + 1
    }
    frame.xOrigin = xCorrect
    frame.yOrigin = yCorrect
    return translateSpace(frame, -xCorrect, -yCorrect) 
}

const framesFromAnimation = (animation, frameFromState) => {
    const frames = []
    for (let istate = animation.startState; istate <= animation.endState; istate ++) {
        const frame = frameFromState(istate)
        frames.push(frame)
    }
    return frames
}

export const framesFromPropAnimation = (animation, prop, options = {}) => {
    const frameFromState = (istate) =>
        frameFromCels(celsFromMask(prop, prop.celmasks[istate]), options)
    return framesFromAnimation(animation, frameFromState)
}

export const framesFromLimbAnimation = (animation, limb, options = {}) => {
    const frameFromState = (istate) => {
        const iframe = limb.frames[istate]
        if (iframe >= 0) {
            return frameFromCels([limb.cels[iframe]], options)
        } else {
            return null
        }
    }
    return framesFromAnimation(animation, frameFromState)
}

const actionOrientations = {
    "stand_back": "back",
    "walk_front": "front",
    "walk_back": "back",
    "stand_front": "front",
    "sit_front": "front"
}

export const framesFromAction = (action, body, options = {}) => {
    const frames = []
    const chore = body.choreography[body.actions[action]]
    const animations = []
    const orientation = actionOrientations[action] ?? "side"
    const limbOrder = orientation == "front" ? body.frontFacingLimbOrder :
                      orientation == "back"  ? body.backFacingLimbOrder : 
                      null // side animations are always displayed in standard limb order
    const limbPatterns = options.limbPatterns ?? []
    for (const limb of body.limbs) {
        if (limb.animations.length > 0) {
            animations.push({ ...limb.animations[0] })
        } else {
            animations.push({ startState: 0, endState: 0 })
        }
    }
    for (const override of chore) {
        const ilimb = override.limb
        const newAnim = body.limbs[ilimb].animations[override.animation]
        animations[ilimb].startState = newAnim.startState
        animations[ilimb].endState = newAnim.endState
    }
    while (true) {
        const cels = []
        const celColors = []
        let restartedCount = 0
        for (const [ilimb, limb] of body.limbs.entries()) {
            const animation = animations[ilimb]
            if (animation.current == undefined) {
                animation.current = animation.startState
            } else {
                animation.current ++
                if (animation.current > animation.endState) {
                    animation.current = animation.startState
                    restartedCount ++
                }
            }
            const istate = limb.frames[animation.current]
            if (istate >= 0) {
                cels.push(limb.cels[istate])
            } else {
                cels.push(null)
            }
            // limb.pattern is not a pattern index, it's a LIMB pattern index
            celColors[ilimb] = {...(options.colors ?? {}), pattern: limbPatterns[limb.pattern] ?? 15 }
        }
        if (restartedCount == animations.length) {
            break
        }
        frames.push(frameFromCels(cels, {...options, colors: celColors, paintOrder: limbOrder, firstCelOrigin: false }))
    }
    return frames
}

export const flipCanvas = (canvas) => {
    const flipped = makeCanvas(canvas.width, canvas.height)
    const ctx = flipped.getContext("2d")
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(canvas, 0, 0)
    return flipped
}

export const Scale = createContext(3)

export const canvasImage = ({ canvas }) => {
    if (canvas) {
        const scale = useContext(Scale)
        return html`
            <img style=${scale > 1 ? "image-rendering: pixelated;" : ""}
                width="${scale * canvas.width}px" height="${scale * canvas.height}px"
                src=${canvas.toDataURL()} />`
    } else {
        return null
    }
}

export const animatedDiv = ({ frames }) => {
    if (!frames || frames.length == 0) {
        return null
    } else if (frames.length == 1) {
        return html`<${canvasImage} canvas=${frames[0]?.canvas}/>`
    }
    const scale = useContext(Scale)
    const [iframe, setFrame] = useState(0)
    const frame = frames[iframe]
    const space = compositeSpaces(frames)
    const w = (space.maxX - space.minX) * 8
    const h = (space.maxY - space.minY)
    const [x, y] = topLeftCanvasOffset(space, frame)
    const r = w - x - (frame ? frame.canvas.width : 0)
    const b = h - y - (frame ? frame.canvas.height : 0)
    useEffect(() => {
        const nextFrame = () => setFrame((iframe + 1) % frames.length)
        const interval = setInterval(nextFrame, 250)
        return () => clearInterval(interval)
    })

    return html`
        <div style="line-height: 0px; width: ${w * scale}px; height: ${h * scale}px; display: inline-block; vertical-align: top;">
            <div style="padding-left: ${x * scale}px; padding-top: ${y * scale}px; padding-right: ${r * scale}px; padding-bottom: ${b * scale}px;">
                <${canvasImage} canvas=${frame?.canvas}/>
            </div>
        </div>`
}
