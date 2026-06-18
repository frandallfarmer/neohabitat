// Phase 2 harness: connect to the live server, enter a context, and render the region from
// habiworld's make-storm — the real C64-model path:
//
//   websocketProxy ──▶ Transport ──▶ habiworld.apply (state) ──▶ worldToObjects ──▶ regionView
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

const RENDER_BASE = "./habirender/"
const _fetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, init) => {
  if (typeof input === "string" && !/^([a-z][a-z0-9+.-]*:|\/|\.\/|\.\.\/)/i.test(input)) input = RENDER_BASE + input
  return _fetch(input, init)
}

const html = htm.bind(h)
const q = (k, d) => new URLSearchParams(location.search).get(k) ?? d

async function main() {
  const { regionView } = await import("../habirender/region.js")
  const { errors } = await import("../habirender/view.js")
  const { HabitatWorld } = await loadHabiworld()

  const world = new HabitatWorld()
  const avatarMotion = createAvatarMotion()
  const objects = signal([])
  const status = signal({ kind: "", text: "ready — set parameters and Connect" })
  const refresh = () => { objects.value = worldToObjects(world) }
  for (const ev of ["added", "removed", "regionDescribed", "regionChanged",
                    "moved", "stateChanged", "containerChanged"]) {
    world.on(ev, refresh)
  }
  let transport = null
  const connect = (ws, context, user) => {
    if (!ws || !context || !user) {
      status.value = { kind: "error", text: "set WebSocket proxy, context, and avatar first" }
      return
    }
    if (transport) transport.close()
    if (typeof world.clear === "function") world.clear()
    avatarMotion.clear()
    objects.value = []
    status.value = { kind: "", text: `connecting to ${ws}…` }
    let gotMsg = false
    transport = new Transport({
      url: ws,
      onMessage: (m) => {
        gotMsg = true
        if (m.op === "WALK$") avatarMotion.beginWalk(m.noid, world.get(m.noid), m)
        world.apply(m)
        const rec = world.get(m.noid)
        if (m.op === "FIDDLE_$" && m.offset === 9) {
          avatarMotion.noteServerFacing(m.noid)
        } else {
          avatarMotion.onOp(m, rec?.mod?.orientation ?? 0, rec?.mod?.activity ?? rec?.mod?.action ?? 129)
        }
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
    transport.connect()
  }

  const App = () => {
    const [ws, setWs] = useState(q("ws", "ws://localhost:1987"))
    const [context, setContext] = useState(q("context", "context-Downtown_5f"))
    const [user, setUser] = useState(q("user", "randy"))
    const objs = objects.value
    const st = status.value
    const region = objs.find((o) => o.type === "context")
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
      <div style="background:#000; align-self:flex-start;">
        ${region
          ? html`<${regionView} objects=${objs} avatarMotion=${avatarMotion} />`
          : html`<div style="color:#9a9aa6; padding:8px;">${transport ? "waiting for make-storm…" : "not connected"}</div>`}
      </div>
      <${errors} />`
  }

  render(html`<${App} />`, document.getElementById("app"))
}

main().catch((e) => {
  document.getElementById("app").textContent = "error: " + e.message
  console.error(e)
})