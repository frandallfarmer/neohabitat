// animate.m disk_face (head prop byte 1 / colorBitmask) gates the head_placeholder overlay.
// Side + front: bit 6 (0x40). Back (facing 3): bit 7 (0x80). No equipped head: never paint.

export const shouldPaintFacePlate = (headProp, facing) => {
    if (!headProp) return false
    const mask = headProp.colorBitmask ?? 0
    if (facing === 3) return (mask & 0x80) !== 0
    return (mask & 0x40) !== 0
}