// Top-level display mode — port of the C64 main.m switch (graphics_mode +
// display_contents_noid). The region renderer draws only in 'region' mode; the
// modal displays ('inventory' now, 'text' next) replace it entirely while active,
// with the cursor/keyboard repurposed per mode (see DESIGN.md Phase 6).
//
// 'inventory' is the C64 pick_from_container flow: a GET that needs a noun from a
// container pops the contents grid, the user points at one (or aborts), and the
// chosen noid is returned to the waiting GET behavior.

import { signal } from "@preact/signals"

export const MODE_REGION = "region"
export const MODE_INVENTORY = "inventory"
export const MODE_TEXT = "text"

// { mode, containerNoid } — containerNoid set in inventory mode (display_contents_noid).
export const modeState = signal({ mode: MODE_REGION, containerNoid: null })

// Resolver for the in-flight modal pick (one at a time, like the C64's single
// display_contents_noid). Kept out of the signal so the signal stays plain data.
let pendingResolve = null

/** pick_from_container: enter inventory mode and resolve with the chosen noid (or null = abort). */
export function pickFromContainerUI(containerNoid) {
  // If a previous pick is somehow still open, abort it first.
  if (pendingResolve) resolveMode(null)
  return new Promise((resolve) => {
    pendingResolve = resolve
    modeState.value = { mode: MODE_INVENTORY, containerNoid }
  })
}

/** Resolve the current modal pick and return to the region. result = noid | null (abort). */
export function resolveMode(result) {
  const resolve = pendingResolve
  pendingResolve = null
  modeState.value = { mode: MODE_REGION, containerNoid: null }
  if (resolve) resolve(result ?? null)
}
