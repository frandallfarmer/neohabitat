// Full habiworld client callback set: presentation + wire I/O for outbound dispatch.

export function buildDispatchClient({ transport, presentation }) {
  return {
    ...presentation,
    walkTo: async (x, y) => {
      const how = x <= 80 ? 0 : 1
      const reply = await transport.sendForReply({ op: "WALK", to: "ME", x, y, how })
      return { x: reply.x ?? x, y: reply.y ?? y }
    },
    send: (msg) => transport.sendForReply(msg),
    animationWait: (ms) => new Promise((resolve) => setTimeout(resolve, ms ?? 1000)),
  }
}