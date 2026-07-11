// habisound ↔ habiworld glue for the live web client.
//
// Primary path (C64-faithful): behaviors call ctx.sound(name, noid) → client.sound,
// resolved by habisound names.js. That covers both outbound verb dispatch (you open a
// bag) and inbound host-message observers (neighbor's OPENCONTAINER$ runs avatar slot 19).
//
// Secondary path: server PLAY_$ broadcasts (minority case — teleports, some mod events).
// Resolve sfx_number against the emitting object's class sound table (classes.js).
//
// Inbound host behaviors use world.setClient(soundClientCallbacks) — see presentation.js.
// wireSoundToWorld (PLAY_$) below is legacy tracing; behavior path is primary.

const HABISOUND_URL = new URL("../../habisound/lib/habisound.js", import.meta.url).href
/** Set false once sound pipeline is diagnosed. */
export const SOUND_TRACE = false
const trace = (...args) => { if (SOUND_TRACE) console.log("[sound-trace]", ...args) }

let _enginePromise = null
let _focusResumeInstalled = false

// The ONE AudioContext for the whole client. It must be created and resumed synchronously
// inside a real user gesture — the title screen's "Click to begin" — because Safari only
// honors AudioContext.resume() while user activation is live (Chrome's sticky activation is
// lenient; Safari's is not). Both the title music and the in-world sound engine share it, so
// audio that starts on that first click keeps working into the game. Call this from the click
// handler BEFORE any await.
let _gestureCtx = null
export function ensureGestureAudioContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext
  if (!_gestureCtx && AC) _gestureCtx = new AC()
  // resume() is fire-and-forget, but the CALL must happen with activation still live — hence
  // callers must invoke this synchronously in the gesture, not after an await.
  _gestureCtx?.resume?.().catch(() => {})
  return _gestureCtx
}

/** Same as Connect's `await hs.resume()` — run when the tab regains focus. */
export function installFocusResume(getHs) {
  if (_focusResumeInstalled || typeof document === 'undefined') return
  _focusResumeInstalled = true
  const resumeIfReady = async () => {
    if (document.visibilityState !== 'visible') return
    const hs = getHs()
    if (!hs?.ctx) return
    trace("focus: resuming AudioContext (was", hs.ctx.state + ")")
    await hs.resume()
    trace("focus: audioContext =", hs.ctx.state)
  }
  document.addEventListener('visibilitychange', resumeIfReady)
  window.addEventListener('focus', resumeIfReady)
  trace("installFocusResume: visibilitychange + focus")
}

export async function getSoundEngine(opts = {}) {
  if (!_enginePromise) {
    _enginePromise = (async () => {
      trace("init: loading HabiSound from", HABISOUND_URL)
      const { HabiSound } = await import(HABISOUND_URL)
      const hs = new HabiSound({
        // Default to the gesture-seized shared context so the engine adopts the already-
        // running context from the title's first click (Safari), not a fresh suspended one.
        audioContext: opts.audioContext ?? _gestureCtx ?? null,
        dataUrl: new URL("../../habisound/data/sounds.json", import.meta.url).href,
        workletUrl: new URL("../../habisound/lib/synth-worklet.js", import.meta.url).href,
      })
      trace("init: fetching bank + AudioWorklet…")
      await hs.init()
      trace("init: ready, bank keys =", hs.list().length, "audioContext =", hs.ctx?.state)
      return hs
    })()
  }
  return _enginePromise
}

// habiworld exports { classes, byTypeName }; index re-exports that bundle as `classes`.
const classIndexFromTable = (classBundle) => {
  const table = classBundle?.classes ?? classBundle
  const byType = new Map()
  for (const entry of Object.values(table)) {
    if (entry?.typeName) byType.set(entry.typeName, entry)
  }
  return byType
}

const classHintFromRecord = (rec) => {
  if (!rec?.type) return undefined
  return rec.type.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()
}

export const soundKeysForPlay = (classesByType, rec, sfxNumber) => {
  if (rec == null || sfxNumber == null) return []
  const entry = classesByType.get(rec.type)
  const table = entry?.sounds
  if (!table?.length) return []
  const idx = sfxNumber & 0x7f
  const key = table[idx]
  if (!key) return []
  const keys = [key]
  if (sfxNumber >= 128) {
    const pw = table[idx + 1]
    if (pw) keys.push(pw)
  }
  return keys
}

const CHORE_SOUND_OPS = new Set([
  "PLAY_$", "ATTACK$", "BASH$", "FAKESHOOT$", "RUB$", "DIG$", "MUNCH$", "FLUSH$",
  "ZAPTO$", "OPEN$", "CLOSE$", "OPENCONTAINER$", "CLOSECONTAINER$",
])

export function wireSoundToWorld(world, hs, classes) {
  const classesByType = classIndexFromTable(classes)
  trace("wireSoundToWorld: class types with sounds =",
    [...classesByType.entries()].filter(([, e]) => e.sounds?.length).length)

  let opCount = 0
  world.on("op", (msg) => {
    if (!msg?.op) return
    opCount++
    if (opCount === 1) trace("world.on('op'): first event =", msg.op)
    if (CHORE_SOUND_OPS.has(msg.op)) {
      trace("op (chore/sound):", msg.op, {
        noid: msg.noid,
        from_noid: msg.from_noid,
        sfx_number: msg.sfx_number,
        type: msg.type,
      })
    }
    if (msg.op !== "PLAY_$") return
    if (msg.sfx_number == null) {
      trace("PLAY_$: missing sfx_number", msg)
      return
    }
    const rec = world.get(msg.from_noid)
    trace("PLAY_$: resolve", {
      sfx_number: msg.sfx_number,
      from_noid: msg.from_noid,
      objectType: rec?.type ?? "(not in world table)",
      objectName: rec?.name,
    })
    const keys = soundKeysForPlay(classesByType, rec, msg.sfx_number)
    if (!keys.length) {
      const entry = rec && classesByType.get(rec.type)
      trace("PLAY_$: UNRESOLVED — class sounds =", entry?.sounds?.slice(0, 12), entry ? `(${entry.sounds?.length} total)` : "(no class)")
      return
    }
    trace("PLAY_$: play", keys, "ctx =", hs.ctx?.state)
    for (const key of keys) {
      const ok = hs.playFile(key)
      trace("PLAY_$: playFile", key, "→", ok ? "queued" : "FAILED")
    }
  })
}

/** Client callbacks for habiworld dispatch (perform / behaviors/kernel.js). */
export function soundClientCallbacks(hs, world, classes) {
  const classesByType = classIndexFromTable(classes)
  return {
    // C64 `sound N` / `complexSound N`: class-relative index on the emitting object.
    // Symbolic names (TELEPORT_ARRIVAL, …) resolve via habisound names.js.
    sound(name, noid) {
      const rec = world.get(noid)
      if (typeof name === "number") {
        const keys = soundKeysForPlay(classesByType, rec, name)
        trace("sound index:", name, { noid, type: rec?.type, keys, ctx: hs.ctx?.state })
        for (const key of keys) {
          const ok = hs.playFile(key)
          trace("sound:", key, "→", ok ? "queued" : "FAILED")
        }
        return
      }
      hs.play(name, { classHint: classHintFromRecord(rec) })
    },
    beep() {
      hs.playFile(classesByType.get("Region")?.sounds?.[0] ?? "error_beep")
    },
    boing() {
      hs.playFile(classesByType.get("Region")?.sounds?.[1] ?? "region_boing")
    },
  }
}