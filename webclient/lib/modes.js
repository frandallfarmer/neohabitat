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
// The Hatchery new-Avatar customizer (Main/custom.m). Unlike inventory/text it is not a
// pick that resolves a noid — it's a full pre-game mode that owns the keyboard and freezes
// the game cursor (custom_running + detach_from_stick). It exits by submitting CUSTOMIZE.
export const MODE_CUSTOMIZE = "customize"

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

/**
 * text_handler.m read flow: enter the text display over a document/paper/book.
 * `text` = { ref, title, readPage(page) }, where readPage returns the server's
 * READ reply { nextpage, ascii }. Resolves when the reader is closed.
 */
export function openTextUI(text) {
  if (pendingResolve) resolveMode(null)
  return new Promise((resolve) => {
    pendingResolve = resolve
    modeState.value = { mode: MODE_TEXT, containerNoid: null, text }
  })
}

/** Resolve the current modal pick and return to the region. result = noid | null (abort). */
export function resolveMode(result) {
  const resolve = pendingResolve
  pendingResolve = null
  modeState.value = { mode: MODE_REGION, containerNoid: null }
  if (resolve) resolve(result ?? null)
}
