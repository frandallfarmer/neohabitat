// Phase 2–5 harness: connect to the live server, enter a context, and render the region
// from habiworld's make-storm — the real C64-model path:
//
//   websocketProxy ──▶ Transport ──▶ habiworld.apply (state + host behaviors) ──▶ regionView
//                                    └─▶ ctx.sound / dispatch (command + reply + neighbor)
//
// No habibot anywhere. habiworld owns all state; this file only moves messages in and
// projects state out for rendering. Avatar walks/gestures are replayed client-side on the
// render cadence (see lib/avatar-chore.js).

import { h, render } from "preact"
import htm from "htm"
import { useState } from "preact/hooks"
import { signal } from "@preact/signals"
import { Transport } from "./transport.js"
import { loadHabiworld } from "./habiworld.js"
import { worldToObjects } from "./world-adapter.js"
import { createAvatarMotion } from "./avatar-chore.js"
import { getSoundEngine, installFocusResume, SOUND_TRACE } from "./sound.js"
import { buildPresentationClient } from "./presentation.js"
import { buildDispatchClient } from "./world-client.js"
import {
  BalloonStage,
  createBalloonState,
  clearBalloonState,
  pushBalloon,
  trackAvatarsForBalloons,
} from "./balloons.js"
import {
  TextInputLine,
  createTextInputState,
  applyEspReply,
  clearTextLine,
} from "./text-input.js"
import { Scale } from "../habirender/render.js"
import { dispatchVerb, dispatchVerbAtPick, pickRegionTarget } from "./verb-dispatch.js"
import { REGION_CANVAS_W, REGION_CANVAS_H } from "../habirender/pick.mjs"
import { actionFromCommand } from "./cursor.mjs"
import { RegionCursor } from "./cursor-view.js"
import { modeState, MODE_REGION, MODE_INVENTORY, MODE_TEXT, resolveMode, pickFromContainerUI } from "./modes.js"
import { InventoryView } from "./inventory-view.js"
import { TextView } from "./text-view.js"
import { TitleScreen } from "./title.js"

const RENDER_BASE = "./habirender/"
const _fetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, init) => {
  if (typeof input === "string" && !/^([a-z][a-z0-9+.-]*:|\/|\.\/|\.\.\/)/i.test(input)) input = RENDER_BASE + input
  return _fetch(input, init)
}

const html = htm.bind(h)
// action_head.i — avatar class sound slots used by avatar_talk.m / generic_broadcast.m
const ESP_ACTIVATES = 6
const ESP_MESSAGE_SENT = 7
const ESP_MESSAGE_RECEIVED = 8
const ESP_DEACTIVATES = 9
const q = (k, d) => new URLSearchParams(location.search).get(k) ?? d
const qNum = (k, d) => {
  const v = Number(q(k, d))
  return Number.isFinite(v) && v > 0 ? v : d
}

async function main() {
  if (SOUND_TRACE) {
    console.log("[sound-trace] enabled — filter console on 'sound-trace'; remove via SOUND_TRACE=false in lib/sound.js")
  }
  const { regionView, clearTrapCache } = await import("../habirender/region.js")
  const { errors } = await import("../habirender/view.js")
  const { HabitatWorld, classes, dispatch, performGesture, performFnKey, constants } = await loadHabiworld()
  const {
    ACTION_DO,
    ACTION_RDO,
    ACTION_GO,
    ACTION_GET,
    ACTION_PUT,
    ACTION_TALK,
  } = constants

  const world = new HabitatWorld()
  const avatarMotion = createAvatarMotion()
  const pickState = { layoutMap: null, objects: null }
  let hs = null
  let dispatchClient = null
  // The habiworld presentation client (sound/chore/balloon hooks). Held at this scope because
  // world.clear() (fired on every changeContext) nulls world._client, so it must be re-registered
  // after a region transition — see resetForRegion.
  let presentation = null
  let verbInFlight = false

  // keyboard.m que_gesture → do_a_gesture.m: Ctrl+1..0 trigger avatar gestures (the value
  // is the AV_ACT the host expects in POSTURE). Only while standing in the region — text /
  // inventory modes own the keyboard. Ctrl+digit isn't a typing key, so it never collides
  // with the speak line.
  const GESTURE_KEYS = {
    "1": 141, "2": 136, "3": 148, "4": 139, "5": 146, // wave point gimme jump stand_front
    "6": 143, "7": 134, "8": 135, "9": 140, "0": 142, // stand_back bend_over bend_back punch frown
  }
  window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    const gesture = GESTURE_KEYS[e.key]
    if (gesture === undefined) return
    if (modeState.value.mode !== MODE_REGION || !dispatchClient || !world.me) return
    e.preventDefault()
    e.stopImmediatePropagation() // own Ctrl+digit — keep it out of the speak line
    performGesture(world, gesture, dispatchClient)
  }, true) // capture: intercept before the text-input keydown handler runs

  // keyboard.m que_gesture → Region action slots 9–16: the F-keys. beta.mud's Region table
  // (C64 ground truth) drives which behavior each fires; we wire the host-backed subset.
  // F1 ghost is Phase 6c; F2 walking-music / F6 color are local-only client features.
  const FKEY_SLOT = { F1: 9, F2: 10, F3: 11, F4: 12, F5: 13, F6: 14, F7: 15, F8: 16 }
  // The cursor's last canvas position, so an F-key picks whatever the cursor is over
  // (que_gesture → update_cursor → pointed_noid). Only F7 ask_for_help needs the target.
  let lastCursor = null
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    const slot = FKEY_SLOT[e.key]
    if (slot === undefined) return
    if (modeState.value.mode !== MODE_REGION || !dispatchClient || !world.me) return
    e.preventDefault() // suppress browser F-key defaults (F5 reload, F3 find, …)
    e.stopImmediatePropagation()
    let pointedNoid = null
    if (slot === 15 && lastCursor) { // F7 ask_for_help points at the cursor object
      const pick = pickRegionTarget(pickState, lastCursor.canvasX, lastCursor.canvasY, lastCursor.scale)
      pointedNoid = pick?.noid ?? null
    }
    performFnKey(world, slot, pointedNoid, dispatchClient)
  }, true)

  const objects = signal([])
  const status = signal({ kind: "", text: "ready — set parameters and Connect" })
  const playEspSound = (idx) => {
    const noid = world.me?.noid
    if (noid == null) return
    world._client?.sound?.(idx, noid)
  }
  const balloonState = signal(createBalloonState({
    maxDisplayLines: qNum("balloonLines", 7),
    maxBalloonLines: qNum("balloonHeight", 4),
  }))
  const textInputState = signal(createTextInputState())
  const balloons = {
    push(w, text, meta) {
      const state = balloonState.value
      const espReceive = state.espPending && !String(text ?? "").startsWith("ESP from ")
      const shown = pushBalloon(state, w, text, meta)
      if (shown && espReceive) playEspSound(ESP_MESSAGE_RECEIVED)
      balloonState.value = { ...state }
    },
  }
  let untrackBalloons = null
  const refresh = () => { objects.value = worldToObjects(world) }
  for (const ev of ["added", "removed", "regionDescribed", "regionChanged",
                    "moved", "stateChanged", "fieldChanged", "containerChanged", "lighting"]) {
    world.on(ev, refresh)
  }
  let transport = null
  let speakReplyPending = false
  let speakReplyTimer = null
  // ESP-mode toggles ride back on the reply; transport fires onReply for every reply (even
  // ones a dispatch consumed via sendForReply), so arming this before the send is enough.
  const armSpeakReply = () => {
    speakReplyPending = true
    if (speakReplyTimer) clearTimeout(speakReplyTimer)
    speakReplyTimer = setTimeout(() => { speakReplyPending = false }, 5000)
  }
  // C64 wait_for_region (comm_control.m): on every region transit the firmware purges ALL
  // region-local state (kill_quip, sprites_off, clear_text_line, command_selected=0xff,
  // purge_contents, clear_cache) before the new make storm renders. habiworld already cleared
  // its object table (changeContext → world.clear), and regionView fully unmounts while objects
  // is empty (so RegionCursor park/hold + the live pickState reset on remount). This tears down
  // the presentation-side state that outlives that unmount, so a long session of region hops
  // can't leak memory or leak stale state from the previous region.
  const resetForRegion = () => {
    // world.clear() (already run for this changeContext) nulled world._client — re-register the
    // presentation client so the new region's behavior-driven sound/chore/balloon hooks fire.
    // Without this, speech in the new region never produces a balloon (the panel only renders
    // with content, so it also looks like the whole balloon frame vanished).
    if (presentation) {
      if (typeof world.setClient === "function") world.setClient(presentation)
      else world._client = presentation
    }
    avatarMotion.clear()                                 // sprites_off + per-avatar animation
    clearTrapCache()                                     // clear_cache: drop decoded region art (keyed by ref → leaks otherwise)
    // Word balloons are persistent UI chrome, not a per-region chatroom — keep the scrollback
    // across the transition (it "does not go away"). Only the transient quip (the bubble pinned
    // over a now-departed speaker) and the half-open ESP header are region-specific; clear those.
    balloonState.value.quip = null
    balloonState.value.espPending = null
    balloonState.value.espAt = 0
    balloonState.value.revision++
    balloonState.value = { ...balloonState.value }
    if (untrackBalloons) untrackBalloons()               // re-seat balloon talker slots for the new region's avatars
    untrackBalloons = trackAvatarsForBalloons(balloonState.value, world)
    clearTextLine(textInputState.value)                  // clear_text_line: drop any half-typed line
    textInputState.value = { ...textInputState.value }
    pickState.layoutMap = null                           // stale region geometry (rebuilt on remount)
    pickState.objects = null
    lastCursor = null
    verbInFlight = false                                 // command_selected = 0xff: cancel any pending verb
    speakReplyPending = false
    if (speakReplyTimer) { clearTimeout(speakReplyTimer); speakReplyTimer = null }
    if (modeState.value.mode !== MODE_REGION) resolveMode(null) // close any open paper/book/inventory modal
  }
  world.on("regionChanged", resetForRegion)
  const onTextSubmit = async (payload) => {
    if (!transport || !payload) return
    // C64 talk:: / ESP_talk:: send MESSAGE_speak to actor_noid; JSON uses the avatar ref.
    const avatarRef = world.me?.ref
    if (!avatarRef) {
      console.warn("[live] text submit: avatar not in region yet")
      return
    }
    // C64 talk:: clears the line after send_string; ESP reply handled via getResponse.
    clearTextLine(textInputState.value)
    textInputState.value = { ...textInputState.value }
    armSpeakReply()

    if (payload.kind === "speak") {
      // keyboard.m get_key: ENTER (return_key, not awaiting input) sets command_selected = 6
      // (TALK) and flashes the cursor — the typed line is dispatched as the TALK verb on the
      // object UNDER THE CURSOR, not an unconditional SPEAK-to-self. Talking at a teleport /
      // elevator / vendo / bureaucrat / Oracle hits its own talk handler; region / ground /
      // avatar resolve to generic_broadcast (the near-universal default = a plain SPEAK).
      const pick = (lastCursor && dispatchClient)
        ? pickRegionTarget(pickState, lastCursor.canvasX, lastCursor.canvasY, lastCursor.scale)
        : null
      if (pick?.noid != null) {
        dispatchVerb({ world, dispatch, dispatchClient, verb: ACTION_TALK, noid: pick.noid, args: { text: payload.text }, pick })
      } else {
        // Nothing under the cursor (pointer never placed in-region) → broadcast to the room.
        transport.send({ op: "SPEAK", to: avatarRef, esp: 0, text: payload.text })
      }
      return
    }

    // ESP continuation / exit — private channel, sent to our own avatar (text_handler ESP_talk).
    const msg = payload.kind === "esp-exit"
      ? { op: "ESP", to: avatarRef, esp: 1, text: "" }
      : payload.kind === "esp" ? { op: "ESP", to: avatarRef, esp: 1, text: payload.text } : null
    if (!msg) return
    if (!transport.send(msg)) {
      console.warn("[live] text submit: transport not connected")
      return
    }
    // avatar_talk.m / generic_broadcast.m: sound ESP_MESSAGE_SENT after each v_ESP_talk.
    playEspSound(ESP_MESSAGE_SENT)
  }
  const connect = async (ws, context, user) => {
    if (!ws || !context || !user) {
      status.value = { kind: "error", text: "set WebSocket proxy, context, and avatar first" }
      return
    }
    try {
      if (!hs) {
        if (SOUND_TRACE) console.log("[sound-trace] Connect: initializing habisound…")
        // AudioContext must be constructed in the synchronous tail of the click handler.
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext
        const gestureCtx = AC ? new AC() : null
        hs = await getSoundEngine({ audioContext: gestureCtx })
        await hs.resume()
        installFocusResume(() => hs)
        if (SOUND_TRACE) console.log("[sound-trace] Connect: audioContext =", hs.ctx?.state)
      } else {
        await hs.resume()
      }
    } catch (e) {
      console.warn("[sound-trace] habisound init FAILED — continuing without sound", e)
      hs = null
    }
    if (transport) transport.close()
    if (typeof world.clear === "function") world.clear()
    avatarMotion.clear()
    objects.value = []
    clearBalloonState(balloonState.value)
    balloonState.value = { ...balloonState.value }
    clearTextLine(textInputState.value)
    textInputState.value = { ...textInputState.value }
    if (untrackBalloons) untrackBalloons()
    untrackBalloons = trackAvatarsForBalloons(balloonState.value, world)
    presentation = buildPresentationClient({
      hs, world, classes, avatarMotion, refresh, balloons,
    })
    if (typeof world.setClient === "function") {
      world.setClient(presentation)
    } else {
      world._client = presentation
      console.warn("[live] world.setClient missing — using _client directly (hard-refresh if habiworld is stale)")
    }
    if (SOUND_TRACE) console.log("[sound-trace] Connect: world client registered (behavior sound/chore)")
    status.value = { kind: "", text: `connecting to ${ws}…` }
    let gotMsg = false
    const applyInbound = (m) => {
      // AUTO_TELEPORT_$: elko's "you've been teleported, finish the move" notice for
      // server-initiated transits (accept-invite, magic items, turfsetting). The C64 firmware
      // replies NEWREGION direction=AUTO_TELEPORT_DIR (4); elko then reads the pre-saved
      // to_region and emits the real changeContext, kicking off the normal transit cycle.
      // Region transit is a client capability (habiworld leaves it to us, like changeRegion);
      // mirrors habibot.js. passage_id=0 — no door involved.
      if (m.op === "AUTO_TELEPORT_$") {
        if (world.me?.ref) transport.send({ op: "NEWREGION", to: world.me.ref, direction: 4 })
        return
      }
      world.apply(m)
      const rec = world.get(m.noid)
      if (m.op === "FIDDLE_$" && m.offset === 9) {
        avatarMotion.noteServerFacing(m.noid)
      } else {
        avatarMotion.onOp(m, rec?.mod?.orientation ?? 0, rec?.mod?.activity ?? rec?.mod?.action ?? 129)
      }
    }
    transport = new Transport({
      url: ws,
      onMessage: (m) => {
        gotMsg = true
        const traceChore = m.op === "PLAY_$"
          || (m.op?.endsWith?.("$") && m.op !== "WALK$" && m.op !== "FIDDLE_$")
        if (traceChore) {
          const fromRec = m.from_noid != null ? world.get(m.from_noid) : null
          console.log("[sound-trace] ws inbound:", m.op, {
            type: m.type,
            noid: m.noid,
            from_noid: m.from_noid,
            from_in_world: fromRec ? fromRec.type : (m.from_noid != null ? "(missing)" : null),
            sfx_number: m.sfx_number,
          })
        }
        applyInbound(m)
      },
      onOpen: () => {
        status.value = { kind: "online", text: `connected — entering ${context} as user-${user}…` }
        transport.enterContext(context, user)
      },
      onClose: () => {
        status.value = {
          kind: "error",
          text: gotMsg
            ? "disconnected"
            : "WebSocket closed with no data — is bridge_v2 up? (docker compose up -d bridge_v2)",
        }
      },
      onError: () => { status.value = { kind: "error", text: `connection error — is the websocketProxy up at ${ws}?` } },
    })
    transport.onReply((reply) => {
      if (!speakReplyPending || reply.esp === undefined) return
      speakReplyPending = false
      if (speakReplyTimer) clearTimeout(speakReplyTimer)
      const wasEsp = textInputState.value.espMode
      applyEspReply(textInputState.value, reply.esp)
      const nowEsp = textInputState.value.espMode
      if (!wasEsp && nowEsp) playEspSound(ESP_ACTIVATES)
      else if (wasEsp && !nowEsp) playEspSound(ESP_DEACTIVATES)
      textInputState.value = { ...textInputState.value }
    })
    dispatchClient = buildDispatchClient({ transport, presentation, world })
    const habitatVerb = (verb, noid, args) => dispatchVerb({
      world, dispatch, dispatchClient, verb, noid, args: args ?? {},
    })
    globalThis.habitatVerb = habitatVerb
    globalThis.habitatDo = (noid, args) => habitatVerb(ACTION_DO, noid, args)
    globalThis.habitatRdo = (noid, args) => habitatVerb(ACTION_RDO, noid, args)
    globalThis.habitatGo = (noid, args) => habitatVerb(ACTION_GO, noid, args)
    globalThis.habitatGet = (noid, args) => habitatVerb(ACTION_GET, noid, args)
    globalThis.habitatPut = (noid, args) => habitatVerb(ACTION_PUT, noid, args)
    globalThis.habitatTalk = (noid, args) => habitatVerb(ACTION_TALK, noid, args)
    globalThis.habitatVerbAt = (verb, canvasX, canvasY, args, scale = 3) =>
      dispatchVerbAtPick({
        world, dispatch, dispatchClient, verb, pickState,
        canvasX, canvasY, scale, args: args ?? {},
      })
    // Test hook: pop the inventory grid for any container noid (the real flow is GET on
    // an open container, which the behavior routes through ctx.pickFromContainer).
    globalThis.habitatInventory = (noid) =>
      pickFromContainerUI(noid).then((picked) => (console.log("[inventory] picked:", picked), picked))
    transport.connect()
  }

  const runRegionVerb = async (verb, { canvasX, canvasY, scale }, label) => {
    if (verbInFlight || !dispatchClient) return
    verbInFlight = true
    try {
      const result = await dispatchVerbAtPick({
        world, dispatch, dispatchClient, verb, pickState, canvasX, canvasY, scale,
      })
      if (!result?.ok && result?.reason !== "not-ready") {
        console.warn(`[live] ${label}:`, result?.reason ?? result)
      }
    } catch (e) {
      console.warn(`[live] ${label} failed:`, e)
    } finally {
      verbInFlight = false
    }
  }

  const onRegionCommand = async ({ command, label, canvasX, canvasY, scale, habitatX }) => {
    if (verbInFlight || !dispatchClient) return
    dispatchClient.faceCursor?.(habitatX)
    const verb = actionFromCommand(command)
    await runRegionVerb(verb, { canvasX, canvasY, scale }, label)
  }

  // Walk-off-edge transit. The C64 clamped the joystick cursor at the playfield boundary; a GO
  // there ran region_change (actions.m:841), which derived the transit direction purely from
  // WHICH screen edge the cursor sat on and let the server apply the region's orientation. We
  // reproduce that with chevrons running the full length of each frame side (outside the region
  // canvas, so they use the OS pointer and never steal an in-region GO coordinate): a click maps
  // to a point along that edge, clamps the cross-axis to the in-game boundary, and dispatches GO
  // there exactly as if that spot had been clicked in-region. Direction then falls out of the
  // edge + the object's own GO behavior — no cardinal-vs-region-relative math here. 'up' is the
  // sky (clicked in-region).
  const SCALE = 3
  const onEdgeClick = (edge) => async (e) => {
    if (verbInFlight || !dispatchClient || !world.me) return
    const rect = e.currentTarget.getBoundingClientRect()
    let cx, cy // region-canvas coords, clamped to the in-game edge
    if (edge === "left" || edge === "right") {
      cx = edge === "left" ? 0 : REGION_CANVAS_W - 1
      // The side chevron only spans the walkable band (bottom corner up to the region depth), so
      // a click maps into habitat y ∈ [0, depth] — always the ground edge, never the sky band.
      // canvasY is inverted habitat y (y = maxY - canvasY), so the band is the bottom `depth` px.
      const depth = world.region?.depth ?? 0
      const bandTop = (REGION_CANVAS_H - 1) - depth
      const frac = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
      cy = Math.round(bandTop + frac * depth)
    } else { // bottom
      cy = REGION_CANVAS_H - 1
      cx = Math.round(((e.clientX - rect.left) / rect.width) * (REGION_CANVAS_W - 1))
    }
    // region_change (actions.m:841): at the edge the cursor points at the REGION (pointer.m
    // update_cursor skips the object pick for desired_x==0/160), so GO runs the region's
    // GoToNewRegion — which walks to the edge (nested GO on the ground) and THEN transits with
    // the screen-edge direction. We reproduce both steps: first the GO/walk at the clamped edge
    // coordinate, then the transit via changeRegion using the C64 direction code.
    await runRegionVerb(ACTION_GO, { canvasX: cx * SCALE, canvasY: cy * SCALE, scale: SCALE }, `edge-${edge}`)
    await dispatchClient.changeRegion(edge)
  }

  const App = () => {
    const [ws, setWs] = useState(q("ws", "ws://localhost:1987"))
    const [context, setContext] = useState(q("context", "context-Downtown_5f"))
    const [user, setUser] = useState(q("user", "randy"))
    const objs = objects.value
    const st = status.value
    const region = objs.find((o) => o.type === "context")
    const mode = modeState.value
    // Edge-transit chevrons show only when standing in a region (not over a modal display).
    const showEdges = region && dispatchClient && mode.mode === MODE_REGION
    // Side chevrons span only the walkable band — from the region's bottom edge up by `depth` —
    // so they read as "walk off the ground edge", not the sky. canvasY is 1:1 with habitat y, so
    // the band is `depth` px tall (×scale). The region render sits one text-input line (8px×scale)
    // above the viewport bottom, so bottom-align with that margin to track the graphics band.
    const depth = region?.mods?.[0]?.depth ?? 0
    const sideChevStyle = `height:${depth * 3}px; align-self:end; margin-bottom:${8 * 3}px;`
    balloonState.value.revision
    textInputState.value.revision
    avatarMotion.tick.value
    return html`
      <div class="connect">
        <label>WebSocket proxy
          <input class="wide" value=${ws} onInput=${(e) => setWs(e.target.value)} /></label>
        <label>Context
          <input class="wide" value=${context} onInput=${(e) => setContext(e.target.value)} /></label>
        <label>Avatar
          <input value=${user} onInput=${(e) => setUser(e.target.value)} /></label>
        <button onClick=${() => connect(ws, context, user)}>Connect</button>
      </div>
      <div class=${"statusbar " + st.kind}><span class="dot"></span>${st.text}</div>
      <div class="region-frame" style="align-self:flex-start;">
        ${showEdges ? html`<button class="edge-chevron left" style=${sideChevStyle} title="Walk off the left edge" onClick=${onEdgeClick("left")}>◀</button>` : null}
        <div class="habitat-viewport" style="background:#000;">
        <${Scale.Provider} value=${3}>
          <${BalloonStage}
            stateSignal=${balloonState}
            textInput=${region && mode.mode !== MODE_INVENTORY && mode.mode !== MODE_TEXT
              ? {
                  Line: TextInputLine,
                  stateSignal: textInputState,
                  onSubmit: onTextSubmit,
                  enabled: true,
                }
              : null}>
            ${!region
              ? html`<div style="color:#9a9aa6; padding:8px;">${transport ? "waiting for make-storm…" : "not connected"}</div>`
              : mode.mode === MODE_INVENTORY
                ? html`<${InventoryView}
                    objects=${objs}
                    containerNoid=${mode.containerNoid}
                    onSelect=${(noid) => resolveMode(noid)}
                    onAbort=${() => resolveMode(null)} />`
                : mode.mode === MODE_TEXT
                  ? html`<${TextView} text=${mode.text} onExit=${() => resolveMode(null)} />`
                  : html`<${regionView}
                    objects=${objs}
                    avatarMotion=${avatarMotion}
                    pickState=${pickState}
                    regionInput=${{
                      Cursor: RegionCursor,
                      enabled: !!dispatchClient,
                      onCommand: onRegionCommand,
                      onMove: (c) => { lastCursor = c },
                    }} />`}
          <//>
        <//>
        </div>
        ${showEdges ? html`<button class="edge-chevron right" style=${sideChevStyle} title="Walk off the right edge" onClick=${onEdgeClick("right")}>▶</button>` : null}
        ${showEdges ? html`<button class="edge-chevron down" title="Walk off the bottom edge" onClick=${onEdgeClick("down")}>▼</button>` : null}
      </div>
      <${errors} />`
  }

  return App
}

// Boot: show the C64 title sequence (lib/title.js) immediately — it loads instantly (title.png
// + comet + tune) and supplies the click gesture audio needs — while main() loads the heavy
// client (habiworld, the renderer, art decoders) in the background. The title's "press any key"
// is gated on the load finishing, so a key (or click) launches the client exactly when ready —
// the same load-the-screen / start-the-music / wait-for-ready flow as the original C64 boot.
function boot() {
  const root = document.getElementById("app")
  const loadedApp = signal(null)
  const loadError = signal(null)
  const proceeded = signal(false)
  main().then((App) => { loadedApp.value = App })
        .catch((e) => { loadError.value = e; console.error(e) })

  const Boot = () => {
    if (loadError.value) {
      return html`<div style="color:#d8604a; padding:12px;">error: ${loadError.value.message}</div>`
    }
    if (proceeded.value && loadedApp.value) {
      const App = loadedApp.value
      return html`<${App} />`
    }
    return html`<${TitleScreen}
      ready=${!!loadedApp.value}
      onProceed=${() => { proceeded.value = true }} />`
  }

  render(html`<${Boot} />`, root)
}

boot()