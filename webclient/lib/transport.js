// Browser transport to the Neohabitat server — the C64-model comms layer, borrowed in
// shape from habibot (habibots/habibot.js) but with NO habibot semantics: it only moves
// elko JSON messages over the wire. A browser can't open a raw TCP socket, so it dials
// pushserver's websocketProxy (ws://host:1987), which is a transparent byte pipe to
// bridge_v2:2026 — exactly where habibots connect.
//
// Wire framing (matches habibot): outbound messages are JSON + "\n\n"; inbound is a byte
// stream of JSON objects separated by "\n" (habibots/util.js parseElko splits on "\n" and
// skips empty lines). The proxy forwards target bytes as binary WS frames, so we decode
// both binary and text and buffer partial lines across frames.

export class Transport {
  constructor({ url, onMessage, onOpen, onClose, onError, baud = 600 } = {}) {
    this.url = url
    this.onMessage = onMessage || (() => {})
    this.onOpen = onOpen || (() => {})
    this.onClose = onClose || (() => {})
    this.onError = onError || (() => {})
    this.ws = null
    this._buf = ""
    this._decoder = new TextDecoder()
    this._pendingReply = null
    this._replyListeners = new Set()
    // 7d outbound pacer (see send()): cap the effective OUTBOUND rate to `baud` bits/sec so a
    // burst of webclient requests can't outrun a co-present C64's serial buffer. 0 disables.
    this._baud = baud > 0 ? baud : 0
    this._wireFreeAt = 0          // ms timestamp the (virtual) wire next becomes idle
    this._paceTimers = new Set()  // outstanding scheduled sends, cleared on connect/close
  }

  onReply(fn) {
    this._replyListeners.add(fn)
    return () => this._replyListeners.delete(fn)
  }

  sendForReply(msg, timeoutMillis = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.send(msg)) {
        reject(new Error("transport not connected"))
        return
      }
      const onReply = (reply) => {
        clearTimeout(timer)
        resolve(reply)
      }
      const timer = setTimeout(() => {
        if (this._pendingReply === onReply) this._pendingReply = null
        reject(new Error(`sendForReply(${msg.op}) timed out after ${timeoutMillis}ms`))
      }, timeoutMillis)
      this._pendingReply = onReply
    })
  }

  _consumeReply(msg) {
    if (msg?.type !== "reply") return false
    if (this._pendingReply) {
      const pending = this._pendingReply
      this._pendingReply = null
      pending(msg)
    }
    for (const fn of this._replyListeners) fn(msg)
    return true
  }

  connect() {
    this._resetPacer()
    const ws = new WebSocket(this.url)
    ws.binaryType = "arraybuffer"
    this.ws = ws
    ws.addEventListener("open", () => this.onOpen())
    ws.addEventListener("close", (e) => this.onClose(e))
    ws.addEventListener("error", (e) => this.onError(e))
    ws.addEventListener("message", (e) => this._onData(e.data))
    return this
  }

  _onData(data) {
    this._buf += typeof data === "string" ? data : this._decoder.decode(data)
    const parts = this._buf.split("\n")
    this._buf = parts.pop() // keep the trailing partial line for the next frame
    for (const part of parts) {
      const line = part.trim()
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch (err) { console.warn("transport: bad JSON line", line); continue }
      if (!this._consumeReply(msg)) this.onMessage(msg)
    }
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    const data = JSON.stringify(obj) + "\n\n"
    if (this._baud <= 0) { this.ws.send(data); return true }
    // 7d traffic pacing — a leaky bucket at `baud` bits/sec (8N1 → 10 bits/byte, so
    // bytes/sec = baud/10). Isolated messages go IMMEDIATELY (the wire is idle), keeping the
    // client responsive when solo; only back-to-back bursts queue and drain at the wire rate,
    // which is the case that would overflow a co-present C64. Per-message delay, not per-char.
    // (JSON length over-estimates the smaller binary the C64 actually receives — conservative.)
    const transmitMs = (data.length * 10 / this._baud) * 1000
    const now = Date.now()
    if (now >= this._wireFreeAt) {
      this._wireFreeAt = now + transmitMs
      this.ws.send(data)
    } else {
      const sendAt = this._wireFreeAt
      this._wireFreeAt += transmitMs
      const t = setTimeout(() => {
        this._paceTimers.delete(t)
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data)
      }, sendAt - now)
      this._paceTimers.add(t)
    }
    return true
  }

  _resetPacer() {
    for (const t of this._paceTimers) clearTimeout(t)
    this._paceTimers.clear()
    this._wireFreeAt = 0
  }

  // The whole login handshake: a single entercontext (no prior auth in dev). The avatar
  // make (with you:true) arrives in the make-storm that follows. `context` is optional — omit
  // it and the server drops the user into wherever they last were (their saved region / turf).
  enterContext(context, username) {
    // hatchery:true advertises that this client can run the new-Avatar customizer
    // (Main/custom.m). It's a capability, not a command — the bridge starts the
    // hatchery only for a brand-new user when the server has it enabled; a
    // returning user just enters normally. Bots never send it.
    const msg = { op: "entercontext", to: "session", user: `user-${username}`, hatchery: true }
    if (context) msg.context = context
    return this.send(msg)
  }

  close() {
    this._resetPacer()
    if (this.ws) this.ws.close()
  }
}
