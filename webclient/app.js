// NeoHabitat web client — Phase 0 shell.
//
// No build step: native ES modules, importmap (index.html), vendored Preact/htm/
// signals. This file owns the top-level screen switch only. The Phase 0 capstone is
// the C64 title sequence (lib/title.js); pressing a key past it drops into the shell
// sandbox where later phases mount the live region. See DESIGN.md.

import { h, render } from "preact"
import htm from "htm"
import { useState } from "preact/hooks"
import { signal } from "@preact/signals"
import { TitleScreen } from "./lib/title.js"

const html = htm.bind(h)

// ── status line (a signal so any later layer can post to it) ───────────────
const status = signal({ kind: "offline", text: "offline — not connected" })

const StatusBar = () => html`
  <div class=${"statusbar " + status.value.kind}>
    <span class="dot"></span>${status.value.text}
  </div>`

// ── the shell sandbox (Phase 0 stub; Phases 1–2 fill it in) ────────────────
const ConnectPanel = () => {
  // Defaults reflect the real dev topology: a browser reaches the server through
  // pushserver's websocketProxy (config.dev.yml listenAddr 0.0.0.0:1987), never the
  // bridge TCP port directly. Connect is intentionally inert until Phase 2.
  const [ws, setWs] = useState("ws://localhost:1987")
  const [context, setContext] = useState("context-Downtown_5f")
  const [user, setUser] = useState("randy")
  const stub = () => {
    status.value = { kind: "error", text: "connect is stubbed until Phase 2 (transport + login)" }
  }
  return html`
    <div class="connect">
      <label>WebSocket proxy
        <input class="wide" value=${ws} onInput=${e => setWs(e.target.value)} /></label>
      <label>Context
        <input class="wide" value=${context} onInput=${e => setContext(e.target.value)} /></label>
      <label>Avatar
        <input value=${user} onInput=${e => setUser(e.target.value)} /></label>
      <button onClick=${stub}>Connect</button>
    </div>`
}

const Stage = () => html`
  <div class="stage" style="--scale: 2">region renders here (Phase 1)</div>`

const Shell = () => html`
  <header class="titlebar">
    <h1>NeoHabitat</h1>
    <span class="tag">web client · Phase 0 shell</span>
  </header>
  <${ConnectPanel} />
  <${Stage} />
  <${StatusBar} />`

// ── top-level: title sequence, then the shell ─────────────────────────────
const App = () => {
  const [screen, setScreen] = useState("title")
  return screen === "title"
    ? html`<${TitleScreen} onProceed=${() => setScreen("shell")} />`
    : html`<${Shell} />`
}

render(html`<${App} />`, document.getElementById("app"))
