// Full habiworld client callback set: presentation + wire I/O for outbound dispatch.

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
  }
}