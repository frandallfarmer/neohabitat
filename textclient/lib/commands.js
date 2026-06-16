/* jslint bitwise: true */
/* jshint esversion: 8 */

'use strict'

// commands.js — parse a typed command line and dispatch it to the
// EXISTING HabiBot API. This layer is a pure consumer: it only calls
// public HabiBot methods and performVerb (the habiworld behavior
// dispatcher). It never reaches into habibots/habiworld internals to
// change state — see the "textclient: no habibots changes" rule.
//
// Command grammar is verb-first with a name-or-noid argument:
//   GO <dir | name | noid>     GET <name | noid>      DROP [name|noid] [x y]
//   SAY <text>                 ESP <name> <text>      OPEN/CLOSE <name|noid>
//   READ <name|noid> [page]    DO <name|noid> [text]  TALK <name|noid> <text>
//   SIT <name|noid> / STAND    GIVE <name|noid>       GRAB <name|noid>
//   INV  WHO  LOOK  FACE <dir>  WAVE/JUMP/...  GHOST/CORPORATE  HELP  QUIT
// A line whose first word is not a known command is spoken (SAY).

const { resolve, label } = require('./resolve')
const {
  ACTION_DO, ACTION_GO, ACTION_GET, ACTION_PUT, ACTION_TALK,
  HANDS,
} = require('../../habiworld').constants

const SCREEN_DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT']
const CARDINALS = ['NORTH', 'EAST', 'SOUTH', 'WEST']
const DIR_ALIASES = {
  U: 'UP', D: 'DOWN', L: 'LEFT', R: 'RIGHT',
  N: 'NORTH', E: 'EAST', S: 'SOUTH', W: 'WEST',
}
const POSTURES = ['WAVE', 'POINT', 'EXTEND_HAND', 'JUMP', 'BEND_OVER', 'STAND_UP', 'PUNCH', 'FROWN']

// ── scene description (LOOK) ──────────────────────────────────────────
// Built straight from the habiworld model (bot.world). Human-facing,
// distinct from awareness.describeWorld (which is tuned for the LLM).
function describeScene(bot) {
  const w = bot.world
  const lines = []
  const region = w.region
  lines.push('')
  lines.push(`== ${region.name || region.ref || 'Unknown region'} ==`)

  // Exits: neighbors[i] is a geographic slot; map to the screen side it
  // appears on given the region orientation (same math as awareness.js).
  const orientation = region.orientation || 0
  const exits = []
  for (let i = 0; i < 4; i++) {
    const target = region.neighbors && region.neighbors[i]
    if (target) {
      const screen = SCREEN_DIRS[(i + 5 - orientation) % 4]
      exits.push(`${screen}/${CARDINALS[i]}`)
    }
  }
  lines.push(`Exits: ${exits.length ? exits.join(', ') : 'none'}`)

  const meNoid = w.me ? w.me.noid : -1
  const all = [...w.objects.values()]

  // Avatars (other than us) present in the region.
  const avatars = all.filter((o) => o.type === 'Avatar' && o.noid !== meNoid &&
    o.containerRef === region.ref)
  lines.push('')
  lines.push('People here:')
  if (avatars.length) {
    for (const a of avatars) lines.push(`  - ${a.name || 'someone'} (noid ${a.noid}) at (${a.mod.x}, ${a.mod.y})`)
  } else {
    lines.push('  (nobody else)')
  }

  // Objects lying in the region (not held by anyone, not the region itself).
  const objs = all.filter((o) =>
    o.containerRef === region.ref &&
    o.type !== 'Avatar' && o.type !== 'Ghost' && o.type !== 'Region')
  lines.push('')
  lines.push('Objects here:')
  if (objs.length) {
    for (const o of objs) {
      const nm = o.name && o.name !== o.type ? `${o.name} ` : ''
      lines.push(`  - ${nm}${o.type} (noid ${o.noid})`)
    }
  } else {
    lines.push('  (nothing)')
  }

  lines.push('')
  lines.push(inventoryText(bot))
  lines.push('')
  return lines.join('\n')
}

function inventoryText(bot) {
  const w = bot.world
  if (!w.me) return 'You are not embodied yet.'
  const items = w.inventory(w.me.noid).filter((o) => o.type !== 'Avatar' && o.type !== 'Ghost')
  const lines = ['You are carrying:']
  if (!items.length) { lines.push('  (nothing)'); return lines.join('\n') }
  for (const it of items) {
    const where = it.mod.y === HANDS ? ' [in hands]' : ` [pocket slot ${it.mod.y}]`
    const nm = it.name && it.name !== it.type ? `${it.name} ` : ''
    lines.push(`  - ${nm}${it.type} (noid ${it.noid})${where}`)
  }
  return lines.join('\n')
}

// Find a walkable ground surface to drop onto (mirrors sage tools.js put_down).
function groundSurface(w) {
  for (const o of w.objects.values()) {
    if (o.containerRef !== w.region.ref) continue
    if (o.type === 'Street' || o.type === 'Ground') return o.noid
    if ((o.type === 'Flat' || o.type === 'Trapezoid' || o.type === 'Super_trapezoid') &&
        o.mod.flat_type === 2) return o.noid
  }
  return null
}

// ── dispatch plumbing ─────────────────────────────────────────────────

// Resolve a name-or-noid token, printing a helpful message on miss /
// ambiguity and returning null so the caller can bail.
function target(bot, token, print) {
  const r = resolve(bot.world, token)
  if (!r) { print(`  ? no object matching "${token}" — try LOOK, or use its noid`); return null }
  if (r.ambiguous) {
    print(`  ? "${token}" is ambiguous:`)
    for (const c of r.ambiguous.slice(0, 8)) print(`      ${label(c)}`)
    print('    repeat the command with the noid.')
    return null
  }
  return r
}

// Normalize a result from a HabiBot helper to a printable outcome line.
function report(print, verb, result) {
  if (result && result.ok === false) {
    print(`  ✗ ${verb}: ${result.reason || result.error || 'failed'}`)
  } else {
    print(`  ✓ ${verb}`)
  }
  return result
}

const COMMANDS = {
  async LOOK(bot, rest, toks, ctx) { ctx.print(describeScene(bot)) },

  async GO(bot, rest, toks, ctx) {
    if (!toks.length) { ctx.print('  GO where? a direction, name, or noid'); return }
    const word = toks[0].toUpperCase()
    const dir = DIR_ALIASES[word] || word
    if (SCREEN_DIRS.includes(dir) || CARDINALS.includes(dir)) {
      ctx.print(`  walking ${dir}...`)
      try { await bot.walkToExit(dir); ctx.print(`  ✓ moved ${dir}`) }
      catch (e) { ctx.print(`  ✗ GO ${dir}: ${e.message || e}`) }
      return
    }
    const obj = target(bot, toks.join(' '), ctx.print)
    if (!obj) return
    report(ctx.print, `go to ${label(obj)}`, await bot.performVerb(ACTION_GO, obj.noid))
  },

  async GET(bot, rest, toks, ctx) {
    const obj = target(bot, rest, ctx.print)
    if (!obj) return
    report(ctx.print, `get ${label(obj)}`, await bot.getIntoHands(obj.noid))
  },

  async DROP(bot, rest, toks, ctx) {
    const w = bot.world
    const held = w.me && w.holding(w.me.noid)
    if (!held) { ctx.print('  ✗ drop: your hands are empty'); return }
    // Optional [name|noid] container, then optional [x y].
    let surfaceNoid = null
    let x = 80, y = 144
    const nums = toks.filter((t) => /^\d+$/.test(t))
    const named = toks.filter((t) => !/^\d+$/.test(t))
    if (named.length) {
      const cont = target(bot, named.join(' '), ctx.print)
      if (!cont) return
      surfaceNoid = cont.noid
    } else if (nums.length >= 2) {
      x = Number(nums[0]); y = Number(nums[1])
    }
    if (surfaceNoid === null) surfaceNoid = groundSurface(w)
    if (surfaceNoid === null) { ctx.print('  ✗ drop: no surface to drop onto here'); return }
    report(ctx.print, `drop ${label(held)}`, await bot.performVerb(ACTION_PUT, surfaceNoid, { x, y }))
  },

  async SAY(bot, rest, toks, ctx) {
    if (!rest) return
    await bot.say(rest)
    ctx.print(`You say: ${rest}`)
  },

  async ESP(bot, rest, toks, ctx) {
    if (toks.length < 2) { ctx.print('  ESP <name> <message>'); return }
    const to = toks[0]
    const msg = toks.slice(1).join(' ')
    await bot.say(`to:${to}`)
    await bot.ESPsay(msg)
    ctx.print(`You whisper to ${to}: ${msg}`)
  },

  async OPEN(bot, rest, toks, ctx) {
    const obj = target(bot, rest, ctx.print)
    if (!obj) return
    report(ctx.print, `open ${label(obj)}`, await bot.openDoor(obj.ref))
  },

  async CLOSE(bot, rest, toks, ctx) {
    const obj = target(bot, rest, ctx.print)
    if (!obj) return
    report(ctx.print, `close ${label(obj)}`, await bot.closeDoor(obj.ref))
  },

  async READ(bot, rest, toks, ctx) {
    const nums = toks.filter((t) => /^\d+$/.test(t))
    const named = toks.filter((t) => !/^\d+$/.test(t))
    // If a name was given, the last bare number (if any) is the page.
    let page = 0
    let token = rest
    if (named.length) { token = named.join(' '); if (nums.length) page = Number(nums[nums.length - 1]) }
    const obj = target(bot, token, ctx.print)
    if (!obj) return
    const r = await bot.readObject(obj.ref, page)
    if (!r || r.ok === false) { ctx.print(`  ✗ read: ${(r && r.reason) || 'failed'}`); return }
    ctx.print(`  ── ${label(obj)} (page ${r.page}) ──`)
    ctx.print(r.text ? `  ${r.text}` : '  (blank)')
  },

  async DO(bot, rest, toks, ctx) {
    const named = toks.filter((t) => !/^\d+$/.test(t))
    const obj = target(bot, named.length ? named[0] : rest, ctx.print)
    if (!obj) return
    const text = toks.slice(1).join(' ')
    report(ctx.print, `do ${label(obj)}`, await bot.performVerb(ACTION_DO, obj.noid, { text }))
  },

  async TALK(bot, rest, toks, ctx) {
    if (toks.length < 2) { ctx.print('  TALK <name|noid> <text>'); return }
    const obj = target(bot, toks[0], ctx.print)
    if (!obj) return
    const text = toks.slice(1).join(' ')
    const go = await bot.performVerb(ACTION_GO, obj.noid)
    if (go && go.ok === false) { ctx.print(`  ✗ talk: could not reach it (${go.reason})`); return }
    report(ctx.print, `talk to ${label(obj)}`, await bot.performVerb(ACTION_TALK, obj.noid, { text }))
  },

  async SIT(bot, rest, toks, ctx) {
    const obj = target(bot, rest, ctx.print)
    if (!obj) return
    report(ctx.print, `sit on ${label(obj)}`, await bot.sitOrstand(1, obj.noid))
  },

  async STAND(bot, rest, toks, ctx) {
    const w = bot.world
    const me = w.me
    const seat = me && me.containerRef && me.containerRef !== w.region.ref
      ? w.getByRef(me.containerRef) : null
    if (!seat) { ctx.print('  ✗ stand: you are not seated'); return }
    report(ctx.print, 'stand up', await bot.sitOrstand(0, seat.noid))
  },

  async GIVE(bot, rest, toks, ctx) {
    const obj = target(bot, rest, ctx.print)
    if (!obj) return
    if (obj.type !== 'Avatar') { ctx.print('  ✗ give: target must be an avatar'); return }
    report(ctx.print, `give to ${label(obj)}`, await bot.giveObject(null, obj.noid))
  },

  async GRAB(bot, rest, toks, ctx) {
    const obj = target(bot, rest, ctx.print)
    if (!obj) return
    if (obj.type !== 'Avatar') { ctx.print('  ✗ grab: target must be an avatar'); return }
    report(ctx.print, `grab from ${label(obj)}`, await bot.grabFromAvatar(obj.noid))
  },

  async TOUCH(bot, rest, toks, ctx) {
    const obj = target(bot, rest, ctx.print)
    if (!obj) return
    await bot.touchAvatar(obj.noid)
    ctx.print(`  ✓ touch ${label(obj)}`)
  },

  async FACE(bot, rest, toks, ctx) {
    const d = (toks[0] || '').toUpperCase()
    if (!['LEFT', 'RIGHT', 'FORWARD', 'BEHIND'].includes(d)) {
      ctx.print('  FACE LEFT|RIGHT|FORWARD|BEHIND'); return
    }
    try { await bot.faceDirection(d); ctx.print(`  ✓ facing ${d}`) }
    catch (e) { ctx.print(`  ✗ face: ${e.message || e}`) }
  },

  async INV(bot, rest, toks, ctx) { ctx.print(inventoryText(bot)) },

  async WHO(bot, rest, toks, ctx) {
    await bot.userList()
    ctx.print('  (asked elko for the online-user list — see the reply above)')
  },

  async GHOST(bot, rest, toks, ctx) {
    await bot.discorporate()
    ctx.print('  ✓ you turn into a ghost')
  },

  async CORPORATE(bot, rest, toks, ctx) {
    await bot.corporate()
    ctx.print('  ✓ you take corporeal form')
  },

  async HELP(bot, rest, toks, ctx) { ctx.print(helpText()) },

  async QUIT(bot, rest, toks, ctx) {
    ctx.print('Goodbye.')
    try { await bot.discorporate() } catch (e) { /* best effort */ }
    process.exit(0)
  },
}

// Aliases.
COMMANDS.L = COMMANDS.LOOK
COMMANDS.I = COMMANDS.INV
COMMANDS.PUT = COMMANDS.DROP
COMMANDS.WHISPER = COMMANDS.ESP
COMMANDS['?'] = COMMANDS.HELP
COMMANDS.EXIT = COMMANDS.QUIT
COMMANDS.STANDUP = COMMANDS.STAND
// Postures as bare verbs (WAVE, JUMP, ...).
for (const p of POSTURES) {
  COMMANDS[p] = async (bot, rest, toks, ctx) => {
    try { await bot.doPosture(p); ctx.print(`  ✓ ${p.toLowerCase()}`) }
    catch (e) { ctx.print(`  ✗ ${p}: ${e.message || e}`) }
  }
}

function helpText() {
  return [
    '',
    'Commands (targets accept a name OR a noid; LOOK shows both):',
    '  LOOK / L              describe the room, who and what is here',
    '  GO <dir|name|noid>    walk to an exit (UP/DOWN/LEFT/RIGHT or N/E/S/W) or an object',
    '  GET <name|noid>       pick an item up into your hands',
    '  DROP/PUT [tgt] [x y]  drop what you hold (on the floor, or into a named container)',
    '  SAY <text>            speak aloud (a bare line with no command is also spoken)',
    '  ESP/WHISPER <who> <t> private telepathic message',
    '  OPEN / CLOSE <tgt>    open or close a door/container',
    '  READ <tgt> [page]     read a book/paper/sign/plaque',
    '  DO <tgt> [text]       the universal Habitat DO verb',
    '  TALK <tgt> <text>     talk to an object (oracle, teleport, elevator...)',
    '  SIT <tgt> / STAND     sit on furniture / stand up',
    '  GIVE <avatar>         hand what you hold to an avatar',
    '  GRAB <avatar>         take what an avatar is holding',
    '  TOUCH <avatar>        a friendly touch',
    '  FACE <dir>            turn LEFT/RIGHT/FORWARD/BEHIND',
    '  WAVE JUMP FROWN ...    postures/emotes',
    '  INV / I               list what you are carrying',
    '  WHO                   who is online',
    '  GHOST / CORPORATE     toggle ghost form',
    '  HELP / ?              this help',
    '  QUIT / EXIT           leave',
    '',
  ].join('\n')
}

// Entry point: parse one line and run it. Unknown first word → speak the
// whole line (Habitat is a chatty place).
async function run(bot, line, ctx) {
  const trimmed = (line || '').trim()
  if (!trimmed) return
  const sp = trimmed.indexOf(' ')
  const verb = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toUpperCase()
  const rest = sp === -1 ? '' : trimmed.slice(sp + 1).trim()
  const toks = rest.length ? rest.split(/\s+/) : []

  const handler = COMMANDS[verb]
  try {
    if (handler) {
      await handler(bot, rest, toks, ctx)
    } else {
      // Not a command → say it.
      await bot.say(trimmed)
      ctx.print(`You say: ${trimmed}`)
    }
  } catch (e) {
    ctx.print(`  ✗ error: ${e && e.message ? e.message : e}`)
  }
}

module.exports = { run, describeScene, inventoryText, helpText, COMMANDS }
