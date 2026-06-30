// Client callbacks for habiworld behaviors (kernel.js ctx.sound / ctx.chore / …).

import { soundClientCallbacks } from "./sound.js"
import { pickFromContainerUI } from "./modes.js"

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
    chore(act, noid, holdActivity) {
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
        holdActivity, // Ctrl-# gestures: hold this activity after the cycle (else revert)
      )
    },
    // Main/actions.m face_cursor → chore.m change_orient — turn toward cursor x before
    // execute_command. A seated avatar just mirrors (keeps the sit); only standing turns.
    // Returns the POSTURE `pose` (FACE_LEFT/FACE_RIGHT) when the facing actually changed, so the
    // caller (live.js) forwards it to the server like the C64's change_facing → MESSAGE_posture;
    // null when nothing changed.
    faceCursor(habitatX) {
      const me = world.me
      if (me == null || habitatX == null || !avatarMotion) return null
      const faceLeft = me.mod.x >= habitatX // cursor to the left → face left
      return avatarMotion.faceCursor(
        me.noid,
        faceLeft,
        me.mod.orientation ?? 0,
        me.mod.activity ?? 129,
      )
    },
    // The avatar's current EFFECTIVE facing — what we render. faceCursor set this toward the
    // command's cursor/object before any walk, so walkTo uses it for the WALK `how` (the arrival
    // facing co-present clients receive). Mirrors the C64 walk_how (= face the cursor), so others
    // render us facing the same way we do — instead of the travel direction, which faces AWAY when
    // the walk-to spot lands on the object's far side. true=left, false=right, null=unknown.
    meFacingLeft() {
      const me = world.me
      if (me == null || !avatarMotion) return null
      return (avatarMotion.getOrient(me.noid, me.mod.orientation ?? 0) & 0x01) === 1
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
    // Main/pick.m pick_from_container — pop the contents grid and resolve with the
    // chosen item noid (or null = abort). The GET-from-container behavior awaits this.
    pickFromContainer(containerNoid) {
      return pickFromContainerUI(containerNoid)
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
    // kernel.js waitWalkAnimation → animation_wait_bit. habiworld passes a distance→time
    // estimate (walkWaitMillis) for headless bots; we have the real engine, so block until the
    // acting avatar's on-screen walk/chore actually finishes (animate.m clear_wait). The `ms`
    // estimate is ignored except as a floor on the safety fallback.
    animationWait: (ms) =>
      avatarMotion.whenIdle(world.me?.noid, { fallbackMs: Math.max(15000, (ms ?? 0) + 2000) }),
  }
}