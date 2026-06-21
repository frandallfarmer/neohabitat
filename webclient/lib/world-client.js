// Full habiworld client callback set: presentation + wire I/O for outbound dispatch.

import { openTextUI } from "./modes.js"

const resolveOutbound = (msg, world) => {
  if (!msg || msg.to !== "ME") return msg
  const ref = world?.me?.ref
  if (!ref) throw new Error("avatar not in region")
  return { ...msg, to: ref }
}

export function buildDispatchClient({ transport, presentation, world }) {
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
    animationWait: (ms) => new Promise((resolve) => setTimeout(resolve, ms ?? 1000)),
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
  }
}