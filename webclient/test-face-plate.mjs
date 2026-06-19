// Keep in sync with habirender/face-plate.js (browser ESM; node cannot import region graph).
import assert from "node:assert/strict"

const shouldPaintFacePlate = (headProp, facing) => {
    if (!headProp) return false
    const mask = headProp.colorBitmask ?? 0
    if (facing === 3) return (mask & 0x80) !== 0
    return (mask & 0x40) !== 0
}

const head = (colorBitmask) => ({ colorBitmask })

assert.equal(shouldPaintFacePlate(head(0xc0), 0), true)
assert.equal(shouldPaintFacePlate(head(0xc0), 1), true)
assert.equal(shouldPaintFacePlate(head(0xc0), 3), true)

for (const facing of [0, 1, 3]) {
  assert.equal(shouldPaintFacePlate(head(0x00), facing), false)
}

assert.equal(shouldPaintFacePlate(head(0x40), 0), true)
assert.equal(shouldPaintFacePlate(head(0x40), 3), false)
assert.equal(shouldPaintFacePlate(head(0x80), 0), false)
assert.equal(shouldPaintFacePlate(head(0x80), 3), true)
assert.equal(shouldPaintFacePlate(null, 0), false)

console.log("test-face-plate: ok")