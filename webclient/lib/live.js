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
import { dispatchVerb, dispatchVerbAtPick } from "./verb-dispatch.js"
import { actionFromCommand } from "./cursor.mjs"
import { RegionCursor } from "./cursor-view.js"
import { modeState, MODE_INVENTORY, resolveMode, pickFromContainerUI } from "./modes.js"
import { InventoryView } from "./inventory-view.js"

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
  const { regionView } = await import("../habirender/region.js")
  const { errors } = await import("../habirender/view.js")
  const { HabitatWorld, classes, dispatch, constants } = await loadHabiworld()
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
  let verbInFlight = false
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
  const onTextSubmit = async (payload) => {
    if (!transport || !payload) return
    // C64 talk:: / ESP_talk:: send MESSAGE_speak to actor_noid; JSON uses the avatar ref.
    const avatarRef = world.me?.ref
    if (!avatarRef) {
      console.warn("[live] text submit: avatar not in region yet")
      return
    }
    let msg
    if (payload.kind === "esp-exit") {
      msg = { op: "ESP", to: avatarRef, esp: 1, text: "" }
    } else if (payload.kind === "esp") {
      msg = { op: "ESP", to: avatarRef, esp: 1, text: payload.text }
    } else if (payload.kind === "speak") {
      msg = { op: "SPEAK", to: avatarRef, esp: 0, text: payload.text }
    } else {
      return
    }
    if (!transport.send(msg)) {
      console.warn("[live] text submit: transport not connected")
      return
    }
    // avatar_talk.m / generic_broadcast.m: sound ESP_MESSAGE_SENT after each v_ESP_talk.
    if (payload.kind === "esp" || payload.kind === "esp-exit") {
      playEspSound(ESP_MESSAGE_SENT)
    }
    // C64 talk:: clears the line after send_string; ESP reply handled via getResponse.
    clearTextLine(textInputState.value)
    textInputState.value = { ...textInputState.value }
    speakReplyPending = true
    if (speakReplyTimer) clearTimeout(speakReplyTimer)
    speakReplyTimer = setTimeout(() => { speakReplyPending = false }, 5000)
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
    const presentation = buildPresentationClient({
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

  const App = () => {
    const [ws, setWs] = useState(q("ws", "ws://localhost:1987"))
    const [context, setContext] = useState(q("context", "context-Downtown_5f"))
    const [user, setUser] = useState(q("user", "randy"))
    const objs = objects.value
    const st = status.value
    const region = objs.find((o) => o.type === "context")
    const mode = modeState.value
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
      <div class="habitat-viewport" style="background:#000; align-self:flex-start;">
        <${Scale.Provider} value=${3}>
          <${BalloonStage}
            stateSignal=${balloonState}
            textInput=${region && mode.mode !== MODE_INVENTORY
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
                : html`<${regionView}
                    objects=${objs}
                    avatarMotion=${avatarMotion}
                    pickState=${pickState}
                    regionInput=${{
                      Cursor: RegionCursor,
                      enabled: !!dispatchClient,
                      onCommand: onRegionCommand,
                    }} />`}
          <//>
        <//>
      </div>
      <${errors} />`
  }

  render(html`<${App} />`, document.getElementById("app"))
}

main().catch((e) => {
  document.getElementById("app").textContent = "error: " + e.message
  console.error(e)
})