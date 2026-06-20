// Client callbacks for habiworld behaviors (kernel.js ctx.sound / ctx.chore / …).

import { soundClientCallbacks } from "./sound.js"
import { FACE_LEFT, FACE_RIGHT } from "./avatar-chore.js"

const CHORE_ACTIONS = {
  bend_over: "bend_over",
  bend_back: "bend_back",
  hand_out: "hand_out",
  hand_back: "hand_back",
}

export function buildPresentationClient({ hs, world, classes, avatarMotion, refresh, balloons }) {
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
    // Main/actions.m face_cursor — turn toward cursor x before execute_command.
    faceCursor(habitatX) {
      const me = world.me
      if (me == null || habitatX == null || !avatarMotion) return
      const posture = me.mod.x < habitatX ? FACE_RIGHT : FACE_LEFT
      avatarMotion.applyPersistentPosture(
        me.noid,
        posture,
        me.mod.orientation ?? 0,
        me.mod.activity ?? 129,
      )
    },
    // avatar_go.m posture toggle (SIT/STAND on the floor). Our own POSTURE never
    // echoes back as POSTURE$, so drive the persistent-posture override here — the
    // same call onOp(POSTURE$) makes for neighbors, otherwise a stale walk-facing
    // activityOverride shadows mod.activity and the avatar never visibly sits.
    posture(noid, newPosture) {
      if (noid == null || !avatarMotion) return
      const rec = world.get(noid)
      avatarMotion.applyPersistentPosture(
        noid,
        newPosture,
        rec?.mod?.orientation ?? 0,
        rec?.mod?.activity ?? 129,
      )
    },
    // Main/walkto.m:start_walk — called from goXY (own WALK reply) and avatar_WALK.m.
    startWalk(noid, x, y, how) {
      if (noid == null || !avatarMotion) return
      const rec = world.get(noid)
      if (!rec?.mod) return
      avatarMotion.beginWalk(noid, rec, { x, y, how })
    },
    // C64 newImage redraw hook. Background objects set background_render on
    // the C64; we have no backdrop cache yet, so refresh repaints everything.
    newImage() {
      if (refresh) refresh()
    },
    balloon(text, meta) {
      if (!balloons || text == null || text === "") return
      balloons.push(world, text, meta)
    },
  }
}