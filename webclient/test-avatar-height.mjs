// animate.m: cy_tab += avatar_height for upper-body limbs (C64 Y-down).
// habirender uses Y-up, so height must subtract from chain cy.

const heightLift = (affected, avatarHeight) => (affected ? avatarHeight : 0)

const cyWithHeight = (posY, affected, avatarHeight, yUp = true) =>
    yUp ? posY - heightLift(affected, avatarHeight) : posY + heightLift(affected, avatarHeight)

// orientation 16 → avatar_height 2; torso affected, legs not.
const orient = 16
const avatarHeight = (orient & 0x7f) >> 3
if (avatarHeight !== 2) throw new Error(`expected height 2, got ${avatarHeight}`)

const legCy = cyWithHeight(0, 0, avatarHeight)
const torsoOld = cyWithHeight(0, 1, avatarHeight, false) // old bug: added height in Y-up
const torsoFixed = cyWithHeight(0, 1, avatarHeight, true)

if (legCy !== 0) throw new Error("legs should not move with height")
if (torsoOld <= legCy) throw new Error("old +height should lift torso above legs in Y-up")
if (torsoFixed >= legCy) throw new Error("fixed -height should push torso toward legs")
if (torsoOld - torsoFixed !== 4) throw new Error("torso should shift by 2×height")

console.log("test-avatar-height: ok")