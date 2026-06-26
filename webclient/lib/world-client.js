// Full habiworld client callback set: presentation + wire I/O for outbound dispatch.

import { openTextUI } from "./modes.js"

const resolveOutbound = (msg, world) => {
  if (!msg || msg.to !== "ME") return msg
  const ref = world?.me?.ref
  if (!ref) throw new Error("avatar not in region")
  return { ...msg, to: ref }
}

export function buildDispatchClient({ transport, presentation, world, requestTextInput }) {
  // C64 client verbs target actor_noid; Elko JSON uses the avatar user-ref.
  const avatarRef = () => {
    const ref = world?.me?.ref
    if (!ref) throw new Error("avatar not in region")
    return ref
  }

  return {
    ...presentation,
    walkTo: async (x, y) => {
      const how = x <= 80 ? 0 : 1
      const reply = await transport.sendForReply({ op: "WALK", to: avatarRef(), x, y, how })
      return { x: reply.x ?? x, y: reply.y ?? y, how: reply.how ?? how }
    },
    // Behaviors emit to: 'ME' (habibot resolves via names); web client uses avatar ref.
    send: (msg) => transport.sendForReply(resolveOutbound(msg, world)),
    // Behaviors/GoToNewRegion.m → region transit. `direction` is a screen-relative word.
    // The C64 (region_change / sky_go) encodes the transit direction as left=0, up=1, right=2,
    // down=3 (frf_equates) and sends it RAW in MESSAGE_newregion; the SERVER applies the region's
    // orientation (Avatar.NEWREGION: (direction + orientation + 2) % 4 → neighbors[]). So no
    // client-side orientation math here — just the C64 code. Covers sky/wall edges, the chevron
    // edge-walk, and ghost drift. `passageNoid` (a door/building) rides as passage_id; when set
    // the server follows the door's connection and ignores `direction`.
    changeRegion: (direction, passageNoid) => {
      const C64_DIR = { left: 0, up: 1, right: 2, down: 3 }
      const code = C64_DIR[String(direction).toLowerCase()]
      if (code === undefined) return Promise.resolve({ ok: false, reason: "unknown-direction" })
      const msg = { op: "NEWREGION", to: avatarRef(), direction: code }
      if (passageNoid) msg.passage_id = passageNoid
      return transport.sendForReply(msg).then(() => ({ ok: true }))
    },
    // animationWait is provided by the presentation client (it owns avatarMotion) and waits for
    // the REAL on-screen animation to finish, not a time estimate — see presentation.js. The
    // `...presentation` spread above supplies it; do not re-add a setTimeout hack here.
    // text_handler.m read flow: open the modal text display over a document; it pages by
    // sending READ {page} itself. Resolves when closed. (graphical capability — bots
    // leave this unset and balloon the text instead.)
    readText: (noid, opts = {}) => {
      const o = world?.get?.(noid)
      const ref = o?.ref
      if (!ref) return Promise.resolve(null)
      return openTextUI({
        ref,
        title: o.name,
        editable: !!opts.editable,
        readPage: (page) => transport.sendForReply({ op: "READ", to: ref, page }),
        // Paper.java WRITE: request_ascii (length 16 / null = clear) saves the sheet.
        writePage: (request_ascii) => transport.sendForReply({ op: "WRITE", to: ref, request_ascii }),
        // Paper.java PSENDMAIL: post the sheet to the addressee written on it ("To: name").
        sendMail: () => transport.sendForReply({ op: "PSENDMAIL", to: ref }),
      })
    },
    // actions.m wait_for_text_string — prompt the player to type a line (atm/token amount, etc.)
    // and resolve with the typed string. Provided by live.js (it owns the text-input line);
    // undefined for bots, which pass the value via args. See habiworld kernel ctx.requestTextInput.
    requestTextInput,
  }
}