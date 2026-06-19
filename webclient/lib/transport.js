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
  constructor({ url, onMessage, onOpen, onClose, onError } = {}) {
    this.url = url
    this.onMessage = onMessage || (() => {})
    this.onOpen = onOpen || (() => {})
    this.onClose = onClose || (() => {})
    this.onError = onError || (() => {})
    this.ws = null
    this._buf = ""
    this._decoder = new TextDecoder()
    this._pendingReply = null
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
    return true
  }

  connect() {
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
    this.ws.send(JSON.stringify(obj) + "\n\n")
    return true
  }

  // The whole login handshake: a single entercontext (no prior auth in dev). The avatar
  // make (with you:true) arrives in the make-storm that follows.
  enterContext(context, username) {
    return this.send({ op: "entercontext", to: "session", context, user: `user-${username}` })
  }

  close() {
    if (this.ws) this.ws.close()
  }
}
