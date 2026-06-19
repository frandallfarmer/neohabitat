// Node sanity check for PLAY_$ → class sound table resolution (no AudioWorklet).
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const { classes: classBundle } = require("../habiworld/index.js")
const classTable = classBundle.classes

const soundKeysForPlay = (classesByType, rec, sfxNumber) => {
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

const classesByType = new Map(Object.values(classTable).filter((e) => e.typeName).map((e) => [e.typeName, e]))
const avatarSounds = (sfx) => soundKeysForPlay(classesByType, { type: "Avatar" }, sfx)
const regionSounds = (sfx) => soundKeysForPlay(classesByType, { type: "Region" }, sfx)

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

assert(avatarSounds(2)[0] === "avatar_killed", "avatar sfx 2")
assert(avatarSounds(0x82).join(",") === "avatar_killed,avatar_killed_pw", "complex avatar sfx 0x82")
assert(regionSounds(8)[0] === "teleport_arrival", "region sfx 8")
assert(regionSounds(0x88).length === 2, "complex region sfx 0x88 includes pw")
assert(soundKeysForPlay(classesByType, null, 0).length === 0, "missing object")

assert(avatarSounds(6)[0] === "message_sent", "ESP_ACTIVATES index 6")
assert(avatarSounds(7)[0] === "message_sent", "ESP_MESSAGE_SENT index 7")
assert(avatarSounds(8)[0] === "message_received", "ESP_MESSAGE_RECEIVED index 8")
assert(avatarSounds(9)[0] === "message_sent", "ESP_DEACTIVATES index 9")

console.log("test-sound-glue: ok")