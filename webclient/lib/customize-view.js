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
import { handleKey, avatarFields, customizePayload, newCustomizeState, randomizeAppearance, PANELS, DEST_X, DEST_Y } from "./customize.mjs"

const html = htm.bind(h)

// keyboard.m reads raw keys; map the browser KeyboardEvent to custom.m's tokens. Function
// keys arrive as e.key "F1".."F8"; the rest are characters. Returns null for keys the mode
// ignores (so they fall through / are not swallowed).
// C64 keyboard: the physical function keys are F1/F3/F5/F7; their even siblings are
// SHIFT+odd (SHIFT+F1 = F2, SHIFT+F3 = F4, …) — the convention the on-screen keyboard
// uses (onscreen-keyboard.mjs FKEYS). A PC sends e.key "F1" with shiftKey set rather than
// remapping to "F2", so honor that here or the even ops never fire from a real keyboard.
const SHIFT_FKEY = { F1: "F2", F3: "F4", F5: "F6", F7: "F8" }
function tokenFor(e) {
  if (/^F[1-8]$/.test(e.key)) return (e.shiftKey && SHIFT_FKEY[e.key]) || e.key
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
function syncToWorld(world, state, avatarNoid, headNoid, avatarMotion) {
  const f = avatarFields(state)
  const avatar = world.get(avatarNoid)
  if (avatar) {
    avatar.mod.orientation = f.orientation
    avatar.mod.custom = f.custom
    const motion = avatarMotion?.get?.(avatarNoid)
    if (motion && typeof motion.orient === "number") {
      // Mid-stride (F4 pacing): the walk froze its orientation at beginWalk, so F1/F3 wouldn't
      // show until the next leg. Refresh the appearance bits (sex 0x80 / height 0x38) now while
      // keeping the walk's own facing bit (0x01).
      motion.orient = (motion.orient & 0x01) | (f.orientation & 0xfe)
      if (typeof motion.startOrient === "number") {
        motion.startOrient = (motion.startOrient & 0x01) | (f.orientation & 0xfe)
      }
    } else {
      // Standing: the compose reads avatarMotion's CACHED orient (region.js getOrient), which
      // otherwise shadows F1/F3. Clear the override so it reads the live mod.orientation.
      avatarMotion?.noteServerFacing?.(avatarNoid)
    }
    world.emit("fieldChanged", avatar, null)
  }
  const head = world.get(headNoid)
  if (head) {
    head.mod.style = f.headStyle
    head.mod.orientation = f.hairPattern
    world.emit("fieldChanged", head, null)
  }
  // The avatar body layout effect (region.js:678) is memoized on avatarMotion.tick plus its own
  // obj/prop signals; an in-place mod mutation alone doesn't invalidate it (the change stayed
  // stale until a head reload happened to fire). Bump tick so every change repaints immediately.
  if (avatarMotion?.tick) avatarMotion.tick.value++
}

// Draw a panel as the Avatar's Habitat word balloons (custom.m draw_balloon_quip):
// the instruction lines plus the page prompt. `showPanel` is the game's balloon
// renderer (live.js showHatcheryPanel), so these look exactly like in-world speech.
function drawPanel(showPanel, s, busy) {
  if (busy) { showPanel(["Please wait a few moments..."]); return }
  const p = PANELS[Math.min(s.panel, PANELS.length - 1)]
  showPanel([...p.lines, p.confirm ? "Type Y or N" : "Press the space bar"])
}

export const CustomizeView = ({ regionView, objects, avatarMotion, pickState,
  world, avatarNoid, headNoid, heads, showPanel, onSubmit, onRestart }) => {
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

  // Mount: apply the randomized starting look and draw the first instruction panel.
  useEffect(() => {
    syncToWorld(world, stateRef.current, avatarNoid, headNoid, avatarMotion)
    drawPanel(showPanel, stateRef.current, false)
  }, [])

  // F4 show_off (custom.m): while walk-around is on, pace the Avatar between the four
  // dest points so the player previews it in motion (the sex/height differences read
  // best when it turns and walks). There's no server here, so when avatarMotion's walk
  // ends we commit the position onto mod ourselves (a real WALK$ would) before stepping
  // to the next point.
  useEffect(() => {
    let destIndex = -1
    let target = null
    const id = setInterval(() => {
      const s = stateRef.current
      const av = world.get(avatarNoid)
      if (!av) return
      const motion = avatarMotion?.get?.(avatarNoid)
      if (!s.walkAround) {
        // Toggled OFF (custom.m F4: stop walk → set destination to current position). Stop
        // promptly: commit the visible position and end any in-progress leg this frame.
        if (motion) {
          av.mod.x = motion.x ?? av.mod.x
          av.mod.y = motion.y ?? av.mod.y
          motion.toX = motion.x // retarget to here → the mover finishes the walk next tick
          motion.toY = motion.y
          avatarMotion?.noteServerFacing?.(avatarNoid)
          world.emit("fieldChanged", av, null)
          if (avatarMotion?.tick) avatarMotion.tick.value++
        } else if (target) {
          av.mod.x = target.x
          av.mod.y = target.y
          world.emit("fieldChanged", av, null)
        }
        target = null
        return
      }
      if (motion) return // mid-stride — let the current leg finish
      if (target) { // a leg just finished — commit it (the renderer snaps to mod.x/y)
        av.mod.x = target.x
        av.mod.y = target.y
        world.emit("fieldChanged", av, null)
      }
      destIndex = (destIndex + 1) & 3 // custom.m dest_loc: cycle the first four points
      target = { x: DEST_X[destIndex], y: DEST_Y[destIndex] }
      avatarMotion?.beginWalk?.(avatarNoid, av, target)
    }, 140)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onKey = async (e) => {
      if (busy) return
      const token = tokenFor(e)
      if (token === null) return
      e.preventDefault()
      e.stopImmediatePropagation() // own the keyboard like custom_running gating keyboard.m
      const s = stateRef.current
      const prevPanel = s.panel
      handleKey(s, token)
      syncToWorld(world, s, avatarNoid, headNoid, avatarMotion)
      setTick((t) => t + 1)
      if (s.done) {
        // custom.m: draw "Please wait…", send MESSAGE_customize, await customize_reply.
        // Nonzero = success (enter the world); zero = failure → restart from the top.
        setBusy(true)
        drawPanel(showPanel, s, true)
        const ok = await onSubmit(customizePayload(s))
        if (!ok) {
          stateRef.current = newCustomizeState({ heads })
          randomizeAppearance(stateRef.current)
          syncToWorld(world, stateRef.current, avatarNoid, headNoid, avatarMotion)
          setBusy(false)
          setTick((t) => t + 1)
          drawPanel(showPanel, stateRef.current, false)
          onRestart?.()
        }
      } else if (s.panel !== prevPanel) {
        drawPanel(showPanel, s, false) // only redraw on a page turn, not every keystroke
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [busy])

  // The instruction text renders as Habitat balloons (via showPanel → the App's
  // BalloonStage that wraps this view); here we only draw the frozen-cursor region.
  return html`
    <div class="customize-stage">
      <${regionView}
        objects=${objects}
        avatarMotion=${avatarMotion}
        pickState=${pickState}
        regionInput=${null} />
    </div>`
}
