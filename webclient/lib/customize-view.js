// MODE_CUSTOMIZE — the Hatchery new-Avatar customizer view (Main/custom.m).
//
// custom.m runs its own render/customize loop over the fake hatchery region whose object #1
// is the Avatar. We reuse the live region renderer to show that Avatar, but with the game
// cursor FROZEN: custom.m parks it (cursor_x←200) and sets detach_from_stick←0xFF every
// frame (cursor.m: no joystick move, no trigger) while custom_running gates the normal
// keyboard. The web equivalent is to render the region with NO regionInput (no cursor/pie
// menu/pick) and bind our own keyboard for F1–F8 / Space / Y/N / R.
//
// The appearance logic is the pure port in customize.mjs; this layer only:
//   • maps browser keys → custom.m tokens and feeds handleKey,
//   • projects the working state onto the live Avatar + worn-head records (avatarFields),
//   • draws the instruction panel as the Avatar's quip, and
//   • on the final Space, submits CUSTOMIZE (the 5 bytes) and waits for the reply
//     (success → enter the world; failure → restart from panel 0, per custom.m).

import { h } from "preact"
import htm from "htm"
import { useEffect, useRef, useState } from "preact/hooks"
import { handleKey, avatarFields, customizePayload, newCustomizeState, randomizeAppearance, PANELS } from "./customize.mjs"

const html = htm.bind(h)

// keyboard.m reads raw keys; map the browser KeyboardEvent to custom.m's tokens. Function
// keys arrive as e.key "F1".."F8"; the rest are characters. Returns null for keys the mode
// ignores (so they fall through / are not swallowed).
function tokenFor(e) {
  if (/^F[1-8]$/.test(e.key)) return e.key
  if (e.key === " " || e.key === "Spacebar") return "SPACE"
  const k = e.key.toUpperCase()
  if (k === "Y" || k === "N" || k === "R") return k
  return null
}

// Write the working appearance onto the live world records the renderer reads: the Avatar
// (mod.orientation + mod.custom) and its worn class_head (mod.style = image, mod.orientation
// = hair). headNoid is the Avatar's single worn head; F2 just restyles it through the eight
// allowed heads (the 8-separate-head-objects of the C64 hatchery region are a host artifact —
// only the worn head's style drives the rendered appearance).
function syncToWorld(world, state, avatarNoid, headNoid) {
  const f = avatarFields(state)
  const avatar = world.get(avatarNoid)
  if (avatar) {
    avatar.mod.orientation = f.orientation
    avatar.mod.custom = f.custom
    world.emit("fieldChanged", avatar, null)
  }
  const head = world.get(headNoid)
  if (head) {
    head.mod.style = f.headStyle
    head.mod.orientation = f.hairPattern
    world.emit("fieldChanged", head, null)
  }
}

export const CustomizeView = ({ regionView, objects, avatarMotion, pickState,
  world, avatarNoid, headNoid, heads, onSubmit, onRestart }) => {
  // One working state per mount; key handling mutates it and we bump a tick to re-render.
  // custom_frame runs init_cust before its first render, so the Avatar starts on a random
  // look the user then tweaks (R re-rolls it).
  const stateRef = useRef(null)
  if (stateRef.current === null) {
    stateRef.current = newCustomizeState({ heads })
    randomizeAppearance(stateRef.current)
  }
  const [, setTick] = useState(0)
  const [busy, setBusy] = useState(false) // "Please wait…" while the host validates (custom.m)

  useEffect(() => {
    // Apply the randomized starting look (custom.m init_cust runs before the first render).
    syncToWorld(world, stateRef.current, avatarNoid, headNoid)
    const onKey = async (e) => {
      if (busy) return
      const token = tokenFor(e)
      if (token === null) return
      e.preventDefault()
      e.stopImmediatePropagation() // own the keyboard like custom_running gating keyboard.m
      const s = stateRef.current
      handleKey(s, token)
      syncToWorld(world, s, avatarNoid, headNoid)
      setTick((t) => t + 1)
      if (s.done) {
        // custom.m: draw "Please wait…", send MESSAGE_customize, await customize_reply.
        // Nonzero = success (enter the world); zero = failure → restart from the top.
        setBusy(true)
        const ok = await onSubmit(customizePayload(s))
        if (!ok) {
          stateRef.current = newCustomizeState({ heads })
          syncToWorld(world, stateRef.current, avatarNoid, headNoid)
          setBusy(false)
          setTick((t) => t + 1)
          onRestart?.()
        }
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [busy])

  const panel = PANELS[Math.min(stateRef.current.panel, PANELS.length - 1)]
  return html`
    <div class="customize-stage">
      <${regionView}
        objects=${objects}
        avatarMotion=${avatarMotion}
        pickState=${pickState}
        regionInput=${null} />
      <div class="customize-panel">
        ${panel.lines.map((line) => html`<p class="customize-line">${line}</p>`)}
        <p class="customize-prompt">${busy
          ? "Please wait a few moments…"
          : panel.confirm ? "Type Y or N" : "Press the space bar"}</p>
      </div>
    </div>`
}
