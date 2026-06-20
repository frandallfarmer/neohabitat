import { decodeProp, decodeBody } from "./codec.js"
import { choreographyNameFromMod, headFacingFromAction, displayOrientForActivity } from "../lib/avatar-chore.js"
import { shouldPaintFacePlate } from "./face-plate.js"
import { html, catcher } from "./view.js"
import { createContext } from "preact"
import { useContext, useMemo } from "preact/hooks"
import { signal, computed, effect, useSignal, useSignalEffect } from "@preact/signals"
import { contextMap, betaMud, logError, promiseToSignal, until, useBinary, useHabitatJson, charset } from './data.js'
import { translateSpace, topLeftCanvasOffset, Scale, framesFromPropAnimation, framesFromAction, frameFromCels, celsFromMask,
         compositeSpaces, compositeLayers, flipCanvas, animatedDiv, stringFromText, canvasForSpace, canvasImage } from "./render.js"
import { signedByte } from "./codec.js"
import { colorsFromOrientation, javaTypeToMuddleClass } from "./neohabitat.js"
import { getFile } from "./shim.js"

const imageFileMapSignal = signal({ 
    "super_trap.bin": "super_trap.bin",
    "trap0.bin": "trap0.bin",
    "trap1.bin": "trap1.bin",
    "loadState": "unloaded"
})

export const imageFileMap = () => {
    if (imageFileMapSignal.value.loadState == "unloaded") {
        const addToImageFileMap = async (indexFile) => {
            const response = await getFile(indexFile, { cache: "no-cache" })
            const paths = await response.json()
            const newPaths = {}
            for (const path of paths) {
                const filename = path.replace(/.*\//, "")
                newPaths[filename] = path
            }
            imageFileMapSignal.value = { ...newPaths, ...imageFileMapSignal.value }
        }
        
        const buildImageFileMap = async () => {
            imageFileMapSignal.value = { ...imageFileMapSignal.value, loadState: "loading" }
            await Promise.all([
                addToImageFileMap("heads.json"),
                addToImageFileMap("props.json"),
                addToImageFileMap("misc.json"),
                addToImageFileMap("beta.json")
            ])
            imageFileMapSignal.value = { ...imageFileMapSignal.value, loadState: "loaded" }
        }
        buildImageFileMap()
    }
    return imageFileMapSignal.value
}

const remapImagePath = (path) => {
    const filename = path.replace(/.*\//, "")
    const map = imageFileMap()
    return map.loadState == "loaded" ? (map[filename] ?? filename) : map[filename]
}

export const dataEqual = (data1, data2) => {
    if (data1.byteLength !== data2.byteLength) {
        return false
    }
    for (let i = 0; i < data1.byteLength; i ++) {
        if (data1.getUint8(i) !== data2.getUint8(i)) {
            return false
        }
    }
    return true
}
export const trapCache = {}
const decodeTrap = (rawData, fnAugment) => {
    const augmentedData = fnAugment(structuredClone(rawData))
    const prop = decodeProp(augmentedData)
    prop.isTrap = true
    return { prop, rawData, augmentedData }
}

export const useTrap = (ref, url, fnAugment) => {
    const cachedVal = trapCache[ref]?.value?.()
    if (cachedVal && !dataEqual(cachedVal.augmentedData, fnAugment(structuredClone(cachedVal.rawData)))) {
        const newVal = decodeTrap(cachedVal.rawData, fnAugment)
        trapCache[ref] = signal(() => newVal)
    }
    if (!trapCache[ref]) {
        trapCache[ref] = promiseToSignal((async () => {
            try {
                const response = await getFile(url)
                if (!response.ok) {
                    console.error(response)
                    throw new Error(`Failed to download ${url}: ${response.status}`)
                }
                return decodeTrap(new DataView(await response.arrayBuffer()), fnAugment)
            } catch (e) {
                logError(e, ref)
            }
        })(), null)
    }
    return trapCache[ref].value()?.prop
}

export const imageSchemaFromMod = (mod) => {
    const mud = betaMud()
    if (mud == null || imageFileMap().loadState !== "loaded") {
        // we're not ready to parse this yet
        return null
    }
    const classname = javaTypeToMuddleClass(mod.type)
    const cls = mud.class[classname]
    if (!cls) {
        throw new Error(`No class named ${classname}`)
    }

    const style = mod.style ?? 0
    const imageKey = classname == "class_head" ? "head" : "image"
    const imageRef = cls[imageKey][style]
    if (!imageRef) {
        throw new Error(`Invalid style ${mod.style} for ${classname}`)
    }
    const image = mud[imageKey][imageRef.id]
    if (!image) {
        throw new Error(`${classname} refers to invalid image ${imageRef.id}`)
    }
    const args = image.arguments ?? [0, 0]
    return { filename: remapImagePath(image.filename), classname, cls, imageKey, width: args[0], flipOffset: args[1] }
}

// ── webclient (habirender) divergence: avatar/body rendering ──────────────────
// The inspector renders props (decodeProp); avatars are composite *bodies* (decodeBody +
// framesFromAction), never wired into the region view because static region files have no
// avatars. The live client does. Map a body class to its Avatar.bin-style body file; humans
// use bodies/Avatar.bin (other bodies in bodies.json are Phase 3+).
const bodyFileForClass = (classname) => classname === "class_avatar" ? "bodies/Avatar.bin" : null

// Avatar contents slots (C64 dataequates.m): only the HEAD (6, at the neck) and a held
// HANDS item (5) draw on the avatar; all other slots are pocket inventory and are not drawn.
const AVATAR_HAND = 5
const AVATAR_HEAD = 6
// The head (and held item) are composed INTO the avatar frame by composeAvatarFrames (one
// coordinate space, C64 animate.m), so no avatar contents render as separate contained
// items. Empty = regionItemView draws no contents for a body. (Held-item compositing TBD.)
const AVATAR_DRAWN_SLOTS = []
// Attachment offsets. The head attaches at the face cel (C64 headCelNumber=4) lifted up the
// neck; screen-Y is inverted (topLeftCanvasOffset: y = 127 - maxY) and containedItemLayout
// does y = containerY - offsetY, so a NEGATIVE offsetY raises the item. ~-30 ≈ the avatar's
// height (feet→neck). Calibration constants — tune to seat the head on the neck.
const AVATAR_HEAD_OFFSET = { x: 0, y: -30 }
const AVATAR_HAND_OFFSET = { x: 6, y: -14 }

// Limb colors from the avatar's 2 custom bytes, per C64 animate.m get_limb_cel_pattern:
// slots LEG=0, TORSO=1, ARM=2, FACE=3 (equates.m). LEG/TORSO from custom[0] hi/lo nibble,
// ARM/FACE from custom[1] hi/lo. (FACE should follow the head's pattern once heads compose.)
const limbPatternsFromMod = (mod) => {
    const c = mod.custom || [0, 0]
    return [(c[0] >> 4) & 0xf, c[0] & 0xf, (c[1] >> 4) & 0xf, c[1] & 0xf]
}

// Per-view limb draw order (C64 animate.m / simulator DRAW_ORDER). 'head' is the head STEP
// — the head object then the face overlay (head_placeholder, limb 4) on top.
const LIMB_DRAW_ORDER = [0, 1, 2, 3, "head", 5]
const AVATAR_HEAD_CEL = 4   // head_placeholder limb / neck cel (body.headCelNumber)
const AVATAR_HEAD_LIFT = 63 // C64: head at cy_tab[hcn]-63; inspector frame Y is negated → +63

// animate.m pattern_for_limb — maps each body cel (0–5) to its which_limb pattern
// class (pointer.m: which_limb = pattern_for_limb[cel_number]). 0=LEG, 1=TORSO,
// 2=ARM, 3=FACE (equates.m). The pick reads this back to tell SPRAY / avatar_get
// (face-limb redirect) which body part the cursor touched.
const AVATAR_FACE_LIMB = 3
const PATTERN_FOR_LIMB = [0, 0, 2, 1, 3, 2]

const actionView = (actionName) => {
    if (actionName === "stand_back" || actionName === "walk_back") return "back"
    if (actionName === "walk_front" || actionName === "stand_front" || actionName === "sit_front") return "front"
    return "side"
}

const drawOrderForAction = (body, actionName) => {
    const view = actionView(actionName)
    const headStep = (i) => i === AVATAR_HEAD_CEL ? "head" : i
    if (view === "front") return body.frontFacingLimbOrder.map(headStep)
    if (view === "back") return body.backFacingLimbOrder.map(headStep)
    return LIMB_DRAW_ORDER
}

// chore.m special_hold: howHeld from the held prop (byte 0 & hold_mask). Non-swing
// replaces right-arm swing limb_states with hold-out (c5a+3 side, c5a+4 front).
const AVATAR_HAND_LIMB = 5
const HOLD_OUT_SIDE_ANIM = 19   // c5a+3 → limb 5 animation 19
const HOLD_OUT_FRONT_ANIM = 20  // c5a+4 → limb 5 animation 20

const applySpecialHoldOverride = (ov, howHeld) => {
    if (howHeld === "swing" || howHeld == null || ov.limb !== AVATAR_HAND_LIMB) return ov
    if (ov.animation === 0 || ov.animation === 1) {
        return { limb: AVATAR_HAND_LIMB, animation: HOLD_OUT_SIDE_ANIM }
    }
    if (ov.animation === 11) {
        return { limb: AVATAR_HAND_LIMB, animation: HOLD_OUT_FRONT_ANIM }
    }
    return ov
}

const initAnimationsForAction = (body, actionName, handProp) => {
    const choreIndex = body.actions?.[actionName]
    if (choreIndex == null) return null
    const howHeld = handProp?.howHeld
    const animations = body.limbs.map((l) =>
        l.animations.length > 0 ? { ...l.animations[0] } : { startState: 0, endState: 0 })
    for (const ov of body.choreography[choreIndex] ?? []) {
        const adjusted = applySpecialHoldOverride(ov, howHeld)
        const na = body.limbs[adjusted.limb]?.animations[adjusted.animation]
        if (na) {
            animations[adjusted.limb].startState = na.startState
            animations[adjusted.limb].endState = na.endState
        }
    }
    return animations
}

// mix.m find_cel_xy — cel xRel/yRel (bytes 4–5) offset the next anchor; yRel subtracts.
const findCelXY = (x, y, xRel, yRel, flipHorizontal) => {
    if (xRel === 0 && yRel === 0) return { x, y }
    const dx = flipHorizontal ? -xRel : xRel
    return { x: x + dx, y: y - yRel }
}

// animate.m AVATAR_HAND held draw: find_cel_xy(cx_tab+5, cy_tab+5, last_cel_*).
// When both rel bytes are 0, mix.m uses cel_x_origin/cel_y_origin (here cx_tab/cy_tab).
const findCelXYHeld = (tabX, tabY, xRel, yRel, originX, originY, flipHorizontal) => {
    if (xRel === 0 && yRel === 0) return { x: originX, y: originY }
    return findCelXY(tabX, tabY, xRel, yRel, flipHorizontal)
}

// animate.m: avatar_height = (orientation & 0x7f) >> 3; cy_tab += height for limbs
// with body.limbs[i].affectedByHeight (Avatar.bin bytes 39+). Y-up: subtract height
// (C64 cy_tab + height moves down on screen).
const avatarHeightFromMod = (mod) => (mod.orientation & 0x7f) >> 3

// Chain limb origins (cx_tab/cy_tab) at the current animation frame.
// Side-view mirroring is applied once in flipComposedFrame (whole canvas), not here —
// find_cel_xy uses cel_dx on C64, but paint.m also flips each cel; we flip the composite.
// Undrawn limbs (frame → cel −1): C64 skips get_cel_loc_addr so last_cel_x/y_rel and
// cel_x/y_origin persist — e.g. side stand legs_right y_rel=−1 carries to the torso.
const avatarLimbChainAt = (body, animations, avatarMod, actionName) => {
    const avatarHeight = avatarHeightFromMod(avatarMod)
    let x = 0, y = 0, xRel = 0, yRel = 0
    const cx = [], cy = [], cels = []
    let handTabX = 0, handTabY = 0, handRelX = 0, handRelY = 0

    for (let i = 0; i < body.limbs.length; i++) {
        const frame = animations[i].current ?? animations[i].startState
        const istate = body.limbs[i].frames[frame]
        const cel = istate >= 0 ? body.limbs[i].cels[istate] : null
        if (!cel) continue
        const pos = findCelXY(x, y, xRel, yRel, false)
        const heightLift = body.limbs[i].affectedByHeight ? avatarHeight : 0
        cx[i] = pos.x
        cy[i] = pos.y - heightLift
        cels[i] = cel
        if (i === AVATAR_HAND) {
            handTabX = pos.x
            handTabY = pos.y - heightLift
            handRelX = cel.xRel ?? 0
            handRelY = cel.yRel ?? 0
        }
        x = pos.x
        y = pos.y
        xRel = cel.xRel ?? 0
        yRel = cel.yRel ?? 0
    }
    const hand = findCelXYHeld(handTabX, handTabY, handRelX, handRelY, handTabX, handTabY, false)
    return { cx, cy, cels, handX: hand.x, handY: hand.y }
}

const flipComposedFrame = (frame, avatarMod, actionName) => {
    if (actionView(actionName) !== "side" || (avatarMod.orientation & 0x01) === 0) return frame
    frame.canvas = flipCanvas(frame.canvas)
    if (frame.limbCanvas) frame.limbCanvas = flipCanvas(frame.limbCanvas) // keep limb buffer aligned
    const { minX, maxX } = frame
    frame.minX = -maxX + 1
    frame.maxX = -minX + 1
    return frame
}

const headPatternFromMod = (headMod, fallback) => {
    if (!headMod) return fallback
    const c = colorsFromOrientation(headMod.orientation)
    return c.pattern ?? c.wildcard ?? fallback
}

// animinit.m / draw_prop: gr_state indexes prop.animations[]; that entry's
// startState..endState range is the cycling graphic frame (not maskIdx = gr_state).
const heldAnimationForMod = (prop, mod) => {
    if (!prop?.animations?.length) return null
    let grState = mod.gr_state ?? 0
    if (grState >= prop.animations.length) grState = 0
    const anim = prop.animations[grState]
    if (!anim) return null
    const length = anim.endState - anim.startState + 1
    return { startState: anim.startState, length }
}

export const heldAnimationCycleLength = (prop, mod) =>
    heldAnimationForMod(prop, mod)?.length ?? 1

const heldGraphicStateAt = (prop, mod, frameIndex = 0) => {
    const info = heldAnimationForMod(prop, mod)
    if (!info) return 0
    if (info.length <= 1) {
        return Math.min(info.startState, prop.celmasks.length - 1)
    }
    const idx = ((frameIndex % info.length) + info.length) % info.length
    return Math.min(info.startState + idx, prop.celmasks.length - 1)
}

const isWalkAction = (actionName) =>
    actionName === "walk" || actionName === "walk_front" || actionName === "walk_back"

// A limb-id twin of a composited cel layer: identical space/alpha shape, but every
// opaque pixel is painted a solid id color encoding which_limb+1 in the red channel.
// Run through the SAME compositeLayers + flip path as the visible layers, this yields
// a buffer pixel-aligned with the avatar so the pick can recover which_limb (the
// software analog of pointer.m fine_cel_point redrawing each cel). whichLimb === null
// (held item — its own object, not a body limb) leaves the twin fully transparent so
// it still contributes to the composite bounds without claiming a limb.
const idLayerFrom = (layer, whichLimb) => {
    if (!layer?.canvas) return null
    const c = canvasForSpace(layer)
    const ctx = c.getContext("2d", { willReadFrequently: true })
    if (whichLimb != null) {
        ctx.drawImage(layer.canvas, 0, 0)
        const img = ctx.getImageData(0, 0, c.width, c.height)
        const d = img.data
        const id = (whichLimb + 1) & 0xff
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 0) { d[i] = id; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255 }
            else { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0 }
        }
        ctx.putImageData(img, 0, 0)
    }
    return { ...layer, canvas: c }
}

const composeAvatarFrame = (body, avatarMod, headProp, headMod, handProp, handMod, actionName, chain, limbPatterns,
    heldFrameIndex = 0) => {
    const { cx, cy, cels, handX, handY } = chain
    const facing = headFacingFromAction(actionName)
    const facePattern = headPatternFromMod(headMod, limbPatterns[3])
    // walk: legs_right yRel (−1) is the animating paint offset for upper-body cels (like held + hand yRel).
    const walkPaintY = isWalkAction(actionName) ? (cels[0]?.yRel ?? 0) : 0
    const layerFor = (cel, x, y, pattern) =>
        cel ? translateSpace(frameFromCels([cel], { colors: { pattern }, firstCelOrigin: false }), x, y) : null

    // Held: find_cel_xy → handX (animate.m). stand_alone=0 so no even_bottoms (mix.m).
    // Same additive xOffset model as limb layerFor (firstCelOrigin:false): paint left = anchor + xOffset.
    // firstCelOrigin:false keeps the additive Y that matches walk bob (placeY = cy_tab + yRel).
    // Avatar-relative placement only; flipComposedFrame mirrors the whole composite for side view.
    let heldLayer = null
    if (handProp && handMod) {
        const maskIdx = heldGraphicStateAt(handProp, handMod, heldFrameIndex)
        const heldCels = celsFromMask(handProp, handProp.celmasks[maskIdx])
        const held = frameFromCels(heldCels,
            { colors: colorsFromMod(handMod), flipHorizontal: false, firstCelOrigin: false })
        if (held) {
            const handCel = cels[AVATAR_HAND]
            const placeY = cy[AVATAR_HAND] + (handCel?.yRel ?? 0)
            heldLayer = translateSpace(held, handX, placeY)
        }
    }

    // layers (visible) and idLayers (which_limb twins) are pushed in lockstep so the
    // composited limb buffer aligns pixel-for-pixel with the avatar (see idLayerFrom).
    const layers = []
    const idLayers = []
    const push = (layer, whichLimb) => {
        if (!layer) return
        layers.push(layer)
        idLayers.push(idLayerFrom(layer, whichLimb))
    }
    for (const key of drawOrderForAction(body, actionName)) {
        // animate.m AVATAR_HAND: draw_contained_object before paint_limb on limb 5.
        if (key === AVATAR_HAND && heldLayer) {
            push(heldLayer, null) // held item is its own object, not a body limb
        }
        if (key === "head") {
            if (headProp?.celmasks?.length) {
                const anim = headProp.animations?.[facing] ?? headProp.animations?.[0] ?? { startState: 0 }
                const state = Math.min(anim.startState ?? 0, headProp.celmasks.length - 1)
                const headFrame = frameFromCels(celsFromMask(headProp, headProp.celmasks[state]),
                    { colors: headMod ? colorsFromMod(headMod) : { pattern: limbPatterns[3] }, firstCelOrigin: false })
                if (headFrame) {
                    push(translateSpace(headFrame, cx[AVATAR_HEAD_CEL],
                        cy[AVATAR_HEAD_CEL] + AVATAR_HEAD_LIFT + walkPaintY), AVATAR_FACE_LIMB)
                }
            }
            if (shouldPaintFacePlate(headProp, facing)) {
                push(layerFor(cels[AVATAR_HEAD_CEL], cx[AVATAR_HEAD_CEL],
                    cy[AVATAR_HEAD_CEL] + walkPaintY, facePattern), AVATAR_FACE_LIMB)
            }
        } else if (key !== 0) {
            push(layerFor(cels[key], cx[key], cy[key] + walkPaintY,
                limbPatterns[body.limbs[key].pattern]), PATTERN_FOR_LIMB[key])
        } else {
            push(layerFor(cels[key], cx[key], cy[key], limbPatterns[body.limbs[key].pattern]), PATTERN_FOR_LIMB[key])
        }
    }
    const drawn = layers.filter(Boolean)
    if (!drawn.length) return null
    const composite = compositeLayers(drawn)
    // idLayers share the visible layers' spaces, so the id composite lands in the same
    // canvas space — keep it on the frame for the pick to read which_limb back.
    const idDrawn = idLayers.filter(Boolean)
    if (idDrawn.length) composite.limbCanvas = compositeLayers(idDrawn).canvas
    return flipComposedFrame(composite, avatarMod, actionName)
}

const animationsAtStart = (animations) => animations.map((a) => ({ ...a, current: a.startState }))

// C64 animate.m / mix.m: inc graphic frame; if the result equals end → restart at start (end is not shown).
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

const choreographyCycleLength = (body, actionName, handProp) => {
    const animations = initAnimationsForAction(body, actionName, handProp)
    if (!animations) return 0
    const scratch = animationsAtStart(animations)
    let count = 0
    while (true) {
        count++
        if (advanceAnimations(scratch) === scratch.length) break
    }
    return count
}

// Compose every frame of a choreography cycle (walk, wave, stand, …).
export const composeAvatarFrames = (body, avatarMod, headProp, headMod, handProp, handMod, actionName) => {
    actionName = actionName ?? choreographyNameFromMod(avatarMod)
    const animations = animationsAtStart(initAnimationsForAction(body, actionName, handProp))
    if (!animations) return []
    const limbPatterns = limbPatternsFromMod(avatarMod)
    const frames = []
    while (true) {
        const frame = composeAvatarFrame(body, avatarMod, headProp, headMod, handProp, handMod, actionName,
            avatarLimbChainAt(body, animations, avatarMod, actionName), limbPatterns, 0)
        if (frame) frames.push(frame)
        if (advanceAnimations(animations) === animations.length) break
    }
    return frames
}

// One choreography frame at a given index (live motion advances index each FRAME_MS).
export const composeAvatarFrameAt = (body, avatarMod, headProp, headMod, handProp, handMod, actionName,
    frameIndex, heldFrameIndex = frameIndex) => {
    actionName = actionName ?? choreographyNameFromMod(avatarMod)
    const animations = initAnimationsForAction(body, actionName, handProp)
    if (!animations) return null
    const limbPatterns = limbPatternsFromMod(avatarMod)
    const cycleLen = choreographyCycleLength(body, actionName, handProp)
    if (!cycleLen) return null
    const idx = ((frameIndex ?? 0) % cycleLen + cycleLen) % cycleLen
    const scratch = animationsAtStart(animations)
    for (let i = 0; i < idx; i++) advanceAnimations(scratch)
    return composeAvatarFrame(body, avatarMod, headProp, headMod, handProp, handMod, actionName,
        avatarLimbChainAt(body, scratch, avatarMod, actionName), limbPatterns, heldFrameIndex)
}

export const propFromMod = (mod, ref) => {
    const bodyFile = bodyFileForClass(javaTypeToMuddleClass(mod.type))
    if (bodyFile) {
        // useBinary returns the decoded body (has .limbs) or null while loading; the body
        // path is keyed off prop.limbs in propFramesFromMod below.
        const body = useBinary(bodyFile, decodeBody, null)
        if (body && !body.contentsXY) {
            // A body isn't a prop, but an avatar *contains* items and the contained-item
            // layout machinery (offsetsFromContainer / regionItemView) indexes
            // containerProp.contentsXY[slot] and reads contentsInFront. Only HEAD/HANDS draw
            // (regionItemView filters the rest); give those their attachment offsets.
            body.contentsXY = Array.from({ length: 32 }, () => ({ x: 0, y: 0 }))
            body.contentsXY[AVATAR_HEAD] = { ...AVATAR_HEAD_OFFSET }
            body.contentsXY[AVATAR_HAND] = { ...AVATAR_HAND_OFFSET }
            body.contentsInFront = true
            body.isBody = true  // marks the container as an avatar body for regionItemView
        }
        return body
    }
    const image = imageSchemaFromMod(mod)
    if (!image) {
        // not ready to parse yet
        return null
    }
    const classname = javaTypeToMuddleClass(mod.type)
    let fnAugment = null
    if (classname == "class_super_trapezoid" && mod.pattern) {
        fnAugment = (data) => {
            const superdata = new Uint8Array(data.byteLength + mod.pattern.length + 2)
            const celoff = data.byteLength - 11
            superdata.set(new Uint8Array(data.buffer))
            superdata.set(mod.pattern, data.byteLength + 2)
            const trapview = new DataView(superdata.buffer)
            trapview.setUint8(celoff + 1, mod.height)
            trapview.setUint8(celoff + 7, mod.upper_left_x)
            trapview.setUint8(celoff + 8, mod.upper_right_x)
            trapview.setUint8(celoff + 9, mod.lower_left_x)
            trapview.setUint8(celoff + 10, mod.lower_right_x)
            trapview.setUint8(celoff + 11, mod.pattern_x_size)
            trapview.setUint8(celoff + 12, mod.pattern_y_size)
            return trapview
        }
    } else if (classname == "class_trapezoid") {
        fnAugment = (data) => {
            const celCount = (data.getUint8(0) & 0x3f) + 1
            for (let icel = 0; icel < celCount; icel ++) {
                const celoff = data.getUint16(7 + celCount + (icel * 2), true)
                data.setUint8(celoff + 1, mod.height)
                if (icel == 0) {
                    data.setUint8(celoff + 7, mod.upper_left_x)
                    data.setUint8(celoff + 8, mod.upper_right_x)
                    data.setUint8(celoff + 9, mod.lower_left_x)
                    data.setUint8(celoff + 10, mod.lower_right_x)
                }
            }
            return data
        }
    }
    return fnAugment ? useTrap(ref, image.filename, fnAugment) : useBinary(image.filename, decodeProp, null)
}

const signedXCoordinate = (modX) => modX > 208 ? signedByte(modX) : modX
const zIndexFromObjectY = (modY) => modY > 127 ? (128 + (256 - modY)) : modY
const objectZComparitor = (obj1, obj2) => zIndexFromObjectY(obj1.mods[0].y) - zIndexFromObjectY(obj2.mods[0].y)

const propLocationFromObjectXY = (modX, modY) => {
    return [Math.floor(signedXCoordinate(modX) / 4), modY % 128, zIndexFromObjectY(modY)]
}

const colorsFromMod = (mod) => {
    const colors = colorsFromOrientation(mod.orientation)
    if (mod.ascii && mod.ascii.length > 0) {
        colors.bytes = mod.ascii
    } else if (mod.text) {
        colors.bytes = mod.text.split("").map(c => c.charCodeAt(0))
    }
    if (colors.bytes) {
        colors.charset = charset()
    }
    return colors
}

// layout / prop rendering as computed signal
export const propFramesFromMod = (prop, mod, xOrigin = 0, flipOverride = null) => {
    if (prop && prop.limbs) {  // decoded body — standalone preview without head composition
        const actionName = choreographyNameFromMod(mod)
        return prop.actions?.[actionName] != null
            ? framesFromAction(actionName, prop, { limbPatterns: limbPatternsFromMod(mod) }) : []
    }
    const colors = colorsFromMod(mod)
    colors.xOrigin = xOrigin
    const flipHorizontal = flipOverride ?? ((mod.orientation ?? 0) & 0x01) != 0
    let grState = mod.gr_state
    if (prop.animations.length > 0) {
        if (grState >= prop.animations.length) {
            logError(new Error(`gr_state ${grState} is out of bounds, defaulting to 0`), prop.filename)
            grState = 0
        }
        return framesFromPropAnimation(prop.animations[grState], prop, { colors, flipHorizontal })
    } else {
        // animinit.m:110 - if image has no animation defined, gr_state is ignored and zero is used
        // All images defined as no_animation only have one possible state.
        return [frameFromCels(celsFromMask(prop, prop.celmasks[0]), { colors, flipHorizontal })]
    }
}

export const objectSpaceFromLayout = ({ x, y, frames }) =>
    translateSpace(compositeSpaces(frames), x, y)

export const containedItemLayout = (prop, mod, containerProp, containerMod, containerSpace) => {
    const [containerX, containerY, containerZ] = propLocationFromObjectXY(containerMod.x, containerMod.y)
    const { x: offsetX, y: offsetY } = offsetsFromContainer(containerProp, containerMod, mod) ?? { x: 0, y: 0 }
    const flipHorizontal = (containerMod.orientation & 0x01) != 0
    // if the contents are drawn in front, the container has its origin offset by the offset of its first cel.
    const originX = containerProp.contentsInFront ? containerSpace.xOrigin : 0
    const originY = containerProp.contentsInFront ? containerSpace.yOrigin : 0
    const x = (containerX - originX) + (flipHorizontal ? -offsetX : offsetX)
    const y = containerY - (offsetY + originY)
    const z = containerZ
    // offsets are relative to `cel_x_origin` / `cel_y_origin`, which is in "habitat space" but with
    // the y axis inverted (see render.m:115-121)
    const frames = propFramesFromMod(prop, mod, x, flipHorizontal)
    return { x, y, z, frames }
}

export const regionItemLayout = (prop, mod) => {
    const [x, y, z] = propLocationFromObjectXY(mod.x, mod.y)
    const frames = propFramesFromMod(prop, mod, x)
    return { x, y, z, frames }
}

export const computeLayoutMap = (objects, sig = signal({}), avatarMotion = null) => {
    const layoutMap = {}
    for (const obj of objects) {
        if (obj.type !== "item") continue
        const ref = obj.ref
        const layoutItem = sig.peek()[obj.ref] ?? { obj: signal(obj) }
        layoutMap[ref] = layoutItem
        layoutItem.obj.value = obj
        if (!layoutItem.layout) {
            layoutItem.prop = signal(null)
            effect(() => {
                try {
                    layoutItem.prop.value = propFromMod(layoutItem.obj.value.mods[0], ref)
                } catch(e) {
                    console.error(e)
                }
            })
            layoutItem.container = computed(() => sig.value[layoutItem.obj.value.in])
            layoutItem.layout = signal(null)
            effect(() => {
                const { obj, prop, container, layout } = layoutItem
                avatarMotion?.tick?.value
                var newLayout = null
                if (prop.value) {
                    if (container.value?.layout?.value) {
                        newLayout = containedItemLayout(
                            prop.value, 
                            obj.value.mods[0], 
                            container.value.prop.value, 
                            container.value.obj.value.mods[0], 
                            container.value.layout.value.frames[0]
                        )
                    } else if (!container.value) {
                        if (prop.value.isBody) {
                            const serverMod = obj.value.mods[0]
                            const motion = avatarMotion?.get?.(serverMod.noid) ?? null
                            const findSlot = (slot) => Object.values(sig.value).find((li) =>
                                li.obj.value?.in === obj.value.ref && li.obj.value?.mods?.[0]?.y === slot)
                            const headItem = findSlot(AVATAR_HEAD)
                            const handItem = findSlot(AVATAR_HAND)
                            const headProp = headItem?.prop?.value ?? null
                            const headMod = headItem?.obj?.value?.mods?.[0] ?? null
                            const handProp = handItem?.prop?.value ?? null
                            const handMod = handItem?.obj?.value?.mods?.[0] ?? null
                            const serverActivity = serverMod.activity ?? serverMod.action
                            const activity = avatarMotion?.getActivity?.(serverMod.noid, serverActivity)
                                ?? serverActivity
                            const baseOrient = avatarMotion?.getOrient?.(serverMod.noid, serverMod.orientation)
                                ?? serverMod.orientation
                            const orientForCompose = displayOrientForActivity(activity, baseOrient)
                            const displayMod = motion?.type === "walk"
                                ? {
                                    ...serverMod,
                                    activity,
                                    x: motion.x,
                                    y: (serverMod.y & 128) | (motion.y & 127),
                                    orientation: motion.orient ?? orientForCompose,
                                }
                                : { ...serverMod, activity, orientation: orientForCompose }
                            const actionName = choreographyNameFromMod(displayMod, motion)
                            const heldCycleLen = heldAnimationCycleLength(handProp, handMod)
                            let frames
                            if (motion) {
                                const heldIdx = heldCycleLen > 1
                                    ? ((motion.animFrame % heldCycleLen) + heldCycleLen) % heldCycleLen : 0
                                const frame = composeAvatarFrameAt(prop.value, displayMod, headProp, headMod, handProp, handMod,
                                    actionName, motion.animFrame, heldIdx)
                                frames = frame ? [frame] : []
                                if (motion.type === "gesture") {
                                    const cycleLen = choreographyCycleLength(prop.value, actionName, handProp)
                                    avatarMotion.noteCycleLength(serverMod.noid, cycleLen)
                                }
                            } else if (heldCycleLen > 1) {
                                frames = []
                                for (let hi = 0; hi < heldCycleLen; hi++) {
                                    const frame = composeAvatarFrameAt(prop.value, displayMod, headProp, headMod, handProp, handMod,
                                        actionName, 0, hi)
                                    if (frame) frames.push(frame)
                                }
                            } else {
                                const standFrame = composeAvatarFrameAt(prop.value, displayMod, headProp, headMod, handProp, handMod,
                                    actionName, 0)
                                frames = standFrame ? [standFrame] : []
                            }
                            const [x, y, z] = propLocationFromObjectXY(displayMod.x, displayMod.y)
                            newLayout = { x, y, z, frames }
                        } else {
                            newLayout = regionItemLayout(prop.value, obj.value.mods[0])
                        }
                    }
                }
                layout.value = newLayout
            })
        }
    }
    sig.value = layoutMap
    return layoutMap
}

export const LayoutMap = createContext(null)
export const regionLayout = ({ objects, avatarMotion, children, pickState = null }) => {
    const currentLayoutMap = useContext(LayoutMap)
    if (!avatarMotion && currentLayoutMap?.objects === objects) {
        return children
    }
    const layoutMap = useSignal({})
    const sigObjects = useSignal(objects)
    sigObjects.value = objects
    useSignalEffect(() => {
        avatarMotion?.tick?.value
        computeLayoutMap(sigObjects.value, layoutMap, avatarMotion)
        if (pickState) {
            pickState.layoutMap = layoutMap.value
            pickState.objects = sigObjects.value
        }
    })
    return html`<${LayoutMap.Provider} value=${({ objects, map: layoutMap, avatarMotion })}>${children}<//>`
}

export const useLayout = (ref) => useContext(LayoutMap).map.value[ref]?.layout?.value
export const useLayoutProp = (ref) => useContext(LayoutMap).map.value[ref]?.prop?.value
export const useLayoutObjects = (ref) => useContext(LayoutMap).objects

export const itemView = (props) => {
    return html`
        <${catcher} filename=${props.object.ref}>
            <${props.viewer} ...${props}/>
        <//>`
}

export const standaloneItemView = ({ object, objects }) => {
    const container = objects?.find?.(o => o.ref === object.in)
    const layoutObjects = container ? [object, container] : [object]
    const layoutMap = useSignal({})
    const sigObjects = useSignal(layoutObjects)
    if (layoutObjects.length !== sigObjects.value.length || !layoutObjects.every((o, i) => o === sigObjects.value[i])) {
        sigObjects.value = layoutObjects
    }
    useSignalEffect(() => { computeLayoutMap(sigObjects.value, layoutMap) })
    const layout = layoutMap.value[object.ref]?.layout?.value
    if (layout) {
        return html`<${animatedDiv} frames=${layout.frames}/>`
    }
}

export const positionInRegion = (space) => {
    const regionSpace = { minX: 0, minY: 0, maxX: 160 / 4, maxY: 127 }
    space = { ...space }
    if (space.minX >= regionSpace.maxX) {
        space.minX -= 64
        space.maxX -= 64
    }
    return topLeftCanvasOffset(regionSpace, space)
}

export const positionedInRegion = ({ space, z, children }) => {
    const scale = useContext(Scale)
    const [x, y] = positionInRegion(space)
    const style =`position: absolute; left: ${x * scale}px; top: ${y * scale}px; z-index: ${z}`
    return html`<div style=${style}>${children}</div>`
}

export const offsetsFromContainer = (containerProp, containerMod, mod) => {
    if (containerMod.type === "Glue") {
        return { x: signedByte(containerMod[`x_offset_${mod.y + 1}`]), 
                 y: signedByte(containerMod[`y_offset_${mod.y + 1}`]) }
    } else {
        return containerProp.contentsXY[mod.y]
    }
}

export const itemInteraction = createContext(({ children }) => children)

export const itemInteractionWrapper = (props) => {
    const interactionView = useContext(itemInteraction)
    return html`<${interactionView} ...${props}/>`
}

export const navInteraction = ({ object, children }) => {
    const mod = object.mods[0]
    const connection = mod.connection && contextMap()[mod.connection]
    if (connection) {
        return html`<a href="region.html?f=${connection.filename}">${children}</a>`
    }
    return children
}

export const regionItemView = ({ object, contents = [] }) => {
    const layout = useLayout(object.ref)
    const prop = useLayoutProp(object.ref)
    if (!layout || !prop) {
        return null
    }

    const container = html`
            <${positionedInRegion} key=${object.ref} space=${objectSpaceFromLayout(layout)} z=${layout.z}>
                <${itemInteractionWrapper} key="interaction.${object.ref}" object=${object} layout=${layout}>
                    <${animatedDiv} frames=${layout.frames}/>
                <//>
            </div>`
    // On an avatar body, only the HEAD and held HANDS item draw; all other contained items
    // are pocket inventory and are invisible in-region (C64 display_avatar).
    const drawn = prop.isBody
        ? contents.filter(item => AVATAR_DRAWN_SLOTS.includes(item.mods[0].y))
        : contents
    if (prop.contentsXY.length > 0) {
        const children = drawn.map(item => html`
            <${regionItemView} key=${item.ref} object=${item} />`)
        if (prop.contentsInFront) {
            return [container, ...children]
        } else {
            return [...children, container]
        }
    }
    return container
}

const sortObjects = (objects) => {
    const regionRef = objects.find(o => o.type === "context")?.ref
    return objects
        .filter(obj => obj.type === "item" && obj.in === regionRef)
        .sort(objectZComparitor)
        .map(obj => [obj, objects.filter(o => o.in === obj.ref)
                                 .sort((o1, o2) => o2.mods[0].y - o1.mods[0].y)])
}

export const regionView = ({
    filename,
    objects,
    avatarMotion,
    style = "",
    interaction = ({ children }) => children,
    pickState = null,
    regionInput = null,
}) => {
    const scale = useContext(Scale)
    objects = objects ?? useHabitatJson(filename)

    return html`
        <${regionLayout} objects=${objects} avatarMotion=${avatarMotion} pickState=${pickState}>
            <${itemInteraction.Provider} value=${interaction}>
                <div
                    style="position: relative; line-height: 0px; width: ${320 * scale}px; height: ${128 * scale}px; overflow: hidden; ${style};">
                    <div style="position: relative; width: 100%; height: 100%; pointer-events: none;">
                        ${sortObjects(objects).map(([obj, contents]) => html`
                            <${itemView} key=${obj.ref}
                                        viewer=${regionItemView}
                                        object=${obj}
                                        contents=${contents}/>`)}
                    </div>
                    ${regionInput
                      ? html`<${regionInput.Cursor}
                          width=${320}
                          height=${128}
                          enabled=${regionInput.enabled !== false}
                          onCommand=${regionInput.onCommand} />`
                      : null}
                </div>
            <//>
        <//>`
}

export const generateRegionCanvas = async (filename) => {
    const objects = await until(() => useHabitatJson(filename), o => o.length > 0)
    await until(charset)
    const layoutMap = computeLayoutMap(objects)
    await until(() => Object.values(layoutMap).every(({ layout }) => layout.value))
    const regionSpace = { minX: 0, minY: 0, maxX: 160 / 4, maxY: 127 }
    const canvas = canvasForSpace(regionSpace)
    const ctx = canvas.getContext("2d")
    const drawItem = (obj) => {
        const { x, y, frames } = layoutMap[obj.ref].layout.value
        const frame = frames[0]
        if (frame?.canvas) {
            const [iX, iY] = positionInRegion(translateSpace(frame, x, y))
            ctx.drawImage(frame.canvas, iX, iY)
        }
    }
    for (const [obj, contents] of sortObjects(objects)) {
        const prop = layoutMap[obj.ref].prop.value
        drawItem(obj)
        for (const child of contents) {
            if (prop.contentsXY.length > child.mods[0].y) {
                drawItem(child)
            }
        }
        if (prop.contentsXY.length > 0 && contents.length > 0 && !prop.contentsInFront) {
            drawItem(obj)
        }
    }
    return canvas
}

export const regionImageView = ({ filename }) => {
    const signal = useMemo(() => promiseToSignal(generateRegionCanvas(filename), null), [filename])
    if (signal.value()) {
        return html`<${canvasImage} canvas=${signal.value()}/>`
    }
}

const positionToCompassOffset = {
    top: 0,
    right: 1,
    bottom: 2,
    left: 3
}

export const locationLink = ({ refId, children }) => {
    if (refId && refId != '') {
        let name = refId
        let href = null
        const ctx = contextMap()[refId]
        if (ctx) {
            if (ctx.name && ctx.name.trim() != '') {
                name = ctx.name
            }
            // todo: customizable?
            href = `region.html?f=${ctx.filename}`
        }
        return html`
            <${Scale.Provider} value="0.5">
                <a href=${href} style="display: inline-block">
                    ${children}: ${name}<br/>
                    ${ctx ? html`<${catcher} filename=${ctx.filename}><${regionImageView} filename=${ctx.filename}/><//>` : null}
                </a>
            <//>`
    } else {
        return null
    }
}

export const directionNav = ({ filename, position }) => {
    const objects = useHabitatJson(filename)
    const context = objects.find(obj => obj.type == "context")
    if (!context || !context.mods[0].neighbors) {
        return null
    }
    const mod = context.mods[0]
    
    // orientation:
    // 0 = top is west, 1 = top is north, 2 = top is east, 3 = top is south
    // neighbour list: North, East, South, West
    const ineighbor = ((mod.orientation ?? 0) + positionToCompassOffset[position] + 3) & 0x03
    const compasses = ["North", "East", "South", "West"]
    const ref = mod.neighbors[ineighbor]
    return html`<${locationLink} refId=${ref}><span>${compasses[ineighbor]}</span><//>`
}

export const objectNav = ({ filename }) =>
    useHabitatJson(filename)
        .filter(o => o.type == "item" && o.mods[0].connection)
        .sort((o1, o2) => o1.mods[0].x - o2.mods[0].x)
        .map(o => html`
            <${locationLink} refId=${o.mods[0].connection}>
                <${itemView} viewer=${standaloneItemView} object=${o}/>
            <//>`)

const propFilter = (key, value) => {
    if (key != "bitmap" && key != "data" && key != "canvas" && key != "texture" && 
        !(key == "pattern" && typeof(value) === "object")) {
        return value
    }
}
export const debugDump = (value) => JSON.stringify(value, propFilter, 2)

export const singleObjectDetails = ({ obj }) => {
    const mod = obj.mods && obj.mods[0]
    if (mod && obj.type == "item") {
        obj = { computedColors: colorsFromOrientation(mod.orientation), ...obj}
        if (mod.ascii) {
            obj.debugString = stringFromText(mod.ascii)
        }
        const image = imageSchemaFromMod(mod)
        if (image) {
            const prop = propFromMod(mod, obj.ref)
            obj = { imageSchema: image, ...obj }
            if (prop && mod.gr_state) {
                if (prop.animations && prop.animations.length > mod.gr_state) {
                    obj.gr_state_animation = prop.animations[mod.gr_state]
                    obj.gr_state_animation_celmasks = prop.celmasks.slice(obj.gr_state_animation.startState, obj.gr_state_animation.endState + 1)
                }
                if (prop.celmasks && prop.celmasks.length > mod.gr_state) {
                    obj.gr_state_celmask = prop.celmasks[mod.gr_state]
                }
            }
            if (prop && prop.isTrap) {
                obj.prop = prop
            }
            return html`
                <a href="detail.html?f=${image.filename}">
                    ${image.filename}<br/><${itemView} object=${obj} viewer=${standaloneItemView}/>
                </a>
                <pre>${debugDump(obj)}</pre>`
        }
    } else {
        return html`<pre>${debugDump(obj)}</pre>`
    }
}

export const objectDetails = ({ filename }) => {
    const objects = useHabitatJson(filename)
    const children = objects.flatMap(obj => {
        let summary = `${obj.name} (${obj.ref})`
        const mod = obj.mods && obj.mods[0]
        if (mod && obj.type == "item") {
            summary = `${summary}: ${mod.type} [${mod.x},${mod.y}]`
        }
        return html`
                <details>
                    <summary>${summary}</summary>
                    <${catcher} filename=${obj.ref}>
                        <${singleObjectDetails} obj=${obj}/>
                    <//>
                </details>`
    })
    return html`<div>${children}</div>`
}
