// Client callbacks for habiworld behaviors (kernel.js ctx.sound / ctx.chore / …).

import { soundClientCallbacks } from "./sound.js"

const CHORE_ACTIONS = {
  bend_over: "bend_over",
  bend_back: "bend_back",
  hand_out: "hand_out",
  hand_back: "hand_back",
}

export function buildPresentationClient({ hs, world, classes, avatarMotion, refresh, balloonText }) {
  const sound = hs ? soundClientCallbacks(hs, world, classes) : { sound() {}, beep() {}, boing() {} }
  return {
    ...sound,
    chore(act, noid) {
      let target = noid ?? world.me?.noid
      let rec = target != null ? world.get(target) : null
      if (!rec || rec.type !== "Avatar") {
        target = world.me?.noid
        rec = target != null ? world.get(target) : null
      }
      if (target == null || !avatarMotion) return
      const action = CHORE_ACTIONS[act] ?? act
      avatarMotion.beginGesture(
        target,
        action,
        rec?.mod?.orientation ?? 0,
        rec?.mod?.activity ?? 129,
      )
    },
    // C64 newImage redraw hook. Background objects set background_render on
    // the C64; we have no backdrop cache yet, so refresh repaints everything.
    newImage() {
      if (refresh) refresh()
    },
    balloon(text) {
      if (!balloonText || text == null || text === "") return
      balloonText.value = String(text)
    },
  }
}