// Choreography frame stepping — Main/animate.m / mix.m cel advance.
//
// A chore's graphic frames run startState..endState. advanceAnimations increments and
// restarts at startState when the result reaches endState, so the cycle shows
// startState..endState-1 and the endState cel is "never shown" — it is only the wrap point.
// That is correct for a looping chore (walk).
//
// A held gesture (Ctrl-#) is different: the C64 stop bit (chore.m:206) halts each limb on
// its final cel and set_chore parks the avatar there as background_activity. That final
// cel IS endState — the very frame the looping cycle skips — so the held pose must be
// composed with each limb at endState (animationsAtEnd), not at endState-1.

export const animationsAtStart = (animations) =>
    animations.map((a) => ({ ...a, current: a.startState }))

// inc graphic frame; if the result reaches end → restart at start (end is not shown).
export const advanceAnimations = (animations) => {
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

// Held-gesture final pose: every limb parked on its stop-bit cel (endState) — the frame the
// looping cycle omits. This is the "complete" pose (jump landed, fully bent over, …).
export const animationsAtEnd = (animations) =>
    animations.map((a) => ({ ...a, current: a.endState }))
