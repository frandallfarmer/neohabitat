/* jslint bitwise: true */
/* jshint esversion: 8 */

'use strict'

// render.js — turn the inbound elko message stream into human narration.
//
// VERBOSE by design: every op the world recognises gets a line, and
// anything unrecognised prints a dim `[op NAME]` marker so nothing is
// silently dropped. Narration reads the habiworld model AFTER world.apply
// has run (habibot calls world.apply before firing the 'msg' callback),
// so noids already resolve to up-to-date names and positions.
//
// Two entry points, both wired in index.js:
//   op(bot, o)         ← bot.on('msg')          — every inbound message
//   departed(bot, rec) ← bot.world.on('removed')— object left / despawned
//
// Departures come through the habiworld 'removed' event rather than the
// raw delete/GOAWAY_$ op because by the time 'msg' fires the record is
// already gone from the model (can't resolve its name); the 'removed'
// event hands us the record itself.

// Avatar posture / direction pose ids → narration verb. Sources:
// habibots/habibot.js AvatarPostures + DirectionToPoseId, and
// Constants.java STAND_* / GET_SHOT_POSTURE.
const POSTURE_VERB = {
  141: 'waves',
  136: 'points',
  148: 'extends a hand',
  139: 'jumps',
  134: 'bends over',
  135: 'stands up',
  140: 'throws a punch',
  142: 'frowns',
  138: 'reels (shot!)',
  254: 'faces left',
  255: 'faces right',
  146: 'faces forward',
  143: 'turns away',
  129: 'stands',
  251: 'stands (left)',
  252: 'stands (right)',
}

function makeRenderer(print) {
  // ESP arrives as two OBJECTSPEAK_$ lines: "ESP from NAME: " then body.
  let pendingEspFrom = null
  let pendingEspAt = 0
  const ESP_TTL_MS = 5000

  function meNoid(bot) {
    return bot.world && bot.world.me ? bot.world.me.noid : -1
  }

  // Name for a noid, falling back to the class type or a #noid marker.
  function who(bot, noid) {
    const r = bot.world.get(noid)
    if (!r) return `#${noid}`
    return r.name && r.name !== r.type ? r.name : r.type
  }

  function emit(line) {
    if (line) print(line)
  }

  // ── speech ──────────────────────────────────────────────────────────
  function speak(bot, o) {
    if (o.noid === meNoid(bot)) return // our own line, already echoed locally
    const text = o.text || ''
    if (!text) return
    emit(`${who(bot, o.noid)} says: ${text}`)
  }

  function objectSpeak(bot, o) {
    const text = (o.text || '').trim()
    if (!text) return

    const header = text.match(/^ESP from (.+): $/)
    if (header) {
      pendingEspFrom = header[1]
      pendingEspAt = Date.now()
      return
    }
    if (pendingEspFrom && Date.now() - pendingEspAt < ESP_TTL_MS) {
      const from = pendingEspFrom
      pendingEspFrom = null
      emit(`${from} whispers (ESP): ${text}`)
      return
    }
    pendingEspFrom = null

    // Other object speech: oracle replies, plaque text, system pings.
    // Prefix with the speaking object's name when we can resolve it.
    const speaker = o.speaker !== undefined ? bot.world.get(o.speaker) : null
    const tag = speaker ? `${speaker.name || speaker.type}: ` : ''
    emit(`  ${tag}${text}`)
  }

  // ── the op table ────────────────────────────────────────────────────
  function op(bot, o) {
    if (!o || typeof o !== 'object') return
    if (!bot.world) return

    // Session-level / replies are handled elsewhere (index prints command
    // outcomes; region entry prints a LOOK). Skip them here.
    if (o.type === 'reply' || o.type === 'changeContext') return

    switch (o.op) {
      case 'SPEAK$': return speak(bot, o)
      case 'OBJECTSPEAK_$': return objectSpeak(bot, o)

      case 'make': {
        // Arrival of an avatar or appearance of an object. Skip our own
        // entry (index prints the room on enteredRegion) and the Region.
        if (o.you) return
        const obj = o.obj
        const mod = obj && obj.mods && obj.mods[0]
        if (!mod || mod.type === 'Region') return
        if (mod.type === 'Avatar') {
          emit(`* ${obj.name || 'Someone'} has arrived.`)
        } else if (mod.type === 'Ghost') {
          // ghosts are invisible presence; keep it quiet but truthful
          emit(`  (a ghostly presence drifts in)`)
        } else {
          const nm = obj.name && obj.name !== mod.type ? `${obj.name} ` : ''
          emit(`  There is a ${nm}${mod.type} here. (noid ${mod.noid})`)
        }
        return
      }

      case 'WALK$': {
        if (o.noid === meNoid(bot)) return
        emit(`${who(bot, o.noid)} walks to (${o.x}, ${o.y}).`)
        return
      }

      case 'POSTURE$': {
        if (o.noid === meNoid(bot)) return
        const verb = POSTURE_VERB[o.new_posture] || 'shifts posture'
        emit(`${who(bot, o.noid)} ${verb}.`)
        return
      }

      case 'APPEARING_$':
        emit(`${who(bot, o.appearing)} appears.`)
        return

      // ── object manipulation by others ─────────────────────────────
      case 'GET$':
        emit(`${who(bot, o.noid)} picks up ${who(bot, o.target)}.`)
        return
      case 'GRABFROM$':
        emit(`${who(bot, o.noid)} grabs something from ${who(bot, o.avatar_noid)}.`)
        return
      case 'PUT$':
        emit(`${who(bot, o.noid)} puts down ${who(bot, o.obj)}.`)
        return
      case 'THROW$':
        emit(`${who(bot, o.noid)} throws ${who(bot, o.obj)} to (${o.x}, ${o.y}).`)
        return
      case 'WEAR$':
        emit(`${who(bot, o.noid)} puts something on.`)
        return
      case 'REMOVE$':
        emit(`${who(bot, o.noid)} takes off ${who(bot, o.target)}.`)
        return

      // ── doors / containers ────────────────────────────────────────
      case 'OPEN$':
        emit(`${who(bot, o.target)} opens.`)
        return
      case 'CLOSE$':
        emit(`${who(bot, o.target)} closes.`)
        return
      case 'OPENCONTAINER$':
        emit(`${who(bot, o.cont)} opens.`)
        return
      case 'CLOSECONTAINER$':
        emit(`${who(bot, o.cont)} closes.`)
        return

      // ── state / appearance ────────────────────────────────────────
      case 'SIT$':
        emit(`${who(bot, o.noid)} sits or stands.`)
        return
      case 'CHANGE$':
        emit(`${who(bot, o.CHANGE_TARGET)} is reoriented.`)
        return
      case 'SEXCHANGE$':
        emit(`${who(bot, o.AVATAR_NOID)} is transformed.`)
        return
      case 'SPRAY$':
        emit(`${who(bot, o.noid)} sprays paint.`)
        return
      case 'ROLL$':
        emit(`${who(bot, o.noid)} shows ${o.state}.`)
        return
      case 'WIND$':
        emit(`${who(bot, o.noid)} is wound up.`)
        return
      case 'FILL$':
        emit(`${who(bot, o.noid)} fills up.`)
        return
      case 'POUR$':
        emit(`${who(bot, o.noid)} is poured out.`)
        return
      case 'SCAN$':
        emit(`${who(bot, o.noid)} sweeps the area (scan).`)
        return
      case 'RESET$':
        emit(`${who(bot, o.noid)} resets.`)
        return

      // ── lighting / power ──────────────────────────────────────────
      case 'ON$':
        emit(`${who(bot, o.noid)} switches on.`)
        return
      case 'OFF$':
        emit(`${who(bot, o.noid)} switches off.`)
        return
      case 'CHANGELIGHT_$':
        emit((o.adjustment || 0) >= 0 ? '  The room brightens.' : '  The room dims.')
        return

      // ── sounds / weapons / one-shots (choreography) ───────────────
      case 'PLAY_$':
        emit('  (a sound plays)')
        return
      case 'ATTACK$':
        emit(`${who(bot, o.noid)} attacks!`)
        return
      case 'BASH$':
        emit(`${who(bot, o.noid)} strikes!`)
        return
      case 'FAKESHOOT$':
        emit(`${who(bot, o.noid)} fires — BANG! (a fake gun)`)
        return
      case 'RUB$':
        emit(`${who(bot, o.noid)} rubs the lamp.`)
        return
      case 'WISH$':
        emit(`${who(bot, o.noid)} makes a wish.`)
        return
      case 'DIG$':
        emit(`${who(bot, o.noid)} digs.`)
        return
      case 'BUGOUT$':
        emit(`${who(bot, o.noid)} vanishes in a hurry!`)
        return
      case 'MUNCH$':
        emit('  *MUNCH* — the machine eats it.')
        return
      case 'FLUSH$':
        emit('  *FLUSH*')
        return
      case 'ZAPTO$':
        emit(`${who(bot, o.noid)} teleports away.`)
        return
      case 'TAKE$':
        emit(`${who(bot, o.noid)} takes a dose.`)
        return

      // ── commerce (token movement) ─────────────────────────────────
      case 'PAY$':
      case 'PAYTO$':
      case 'PAID$':
      case 'SELL$':
        emit('  (money changes hands)')
        return

      // ── deliberately quiet field pokes ────────────────────────────
      case 'FIDDLE_$':
      case 'CHANGE_CONTAINERS_$':
      case 'VSELECT$':
      case 'WAITFOR_$':
      case 'delete':       // departures handled by departed() below
      case 'GOAWAY_$':     // ditto
        return

      default:
        if (o.op) emit(`  [· ${o.op}]`) // verbose: never drop an op
        return
    }
  }

  // Departures, via the habiworld 'removed' event (carries the record).
  // Only narrate avatars and region-level objects — cascade-removed
  // pocket contents of a departing avatar would otherwise spam lines.
  function departed(bot, record) {
    if (!record) return
    const region = bot.world && bot.world.region
    const wasInRegion = region && record.containerRef === region.ref
    if (record.type === 'Avatar') {
      emit(`* ${record.name || 'Someone'} leaves.`)
    } else if (record.type === 'Ghost') {
      // quiet
    } else if (wasInRegion) {
      emit(`  The ${record.name && record.name !== record.type ? record.name + ' ' : ''}${record.type} is gone.`)
    }
  }

  return { op, departed }
}

module.exports = { makeRenderer, POSTURE_VERB }
