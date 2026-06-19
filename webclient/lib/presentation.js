// Client callbacks for habiworld behaviors (kernel.js ctx.sound / ctx.chore / …).

import { soundClientCallbacks } from "./sound.js"

const CHORE_ACTIONS = {
  bend_over: "bend_over",
  bend_back: "bend_back",
  hand_out: "hand_out",
  hand_back: "hand_back",
}

export function buildPresentationClient({ hs, world, classes, avatarMotion }) {
  const sound = hs ? soundClientCallbacks(hs, world, classes) : { sound() {}, beep() {}, boing() {} }
  return {
    ...sound,
    chore(act, noid) {
      const target = noid ?? world.me?.noid
      if (target == null || !avatarMotion) return
      const action = CHORE_ACTIONS[act] ?? act
      const rec = world.get(target)
      avatarMotion.beginGesture(
        target,
        action,
        rec?.mod?.orientation ?? 0,
        rec?.mod?.activity ?? 129,
      )
    },
    newImage() { /* region refresh is event-driven from world.apply */ },
    balloon() {},
  }
}