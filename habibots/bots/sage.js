/* jslint bitwise: true */
/* jshint esversion: 8 */

'use strict'

// sage.js — an LLM-driven Habitat resident.
//
// Wanders the world, takes stock of the avatars and objects around it, and
// uses Claude to decide what to say. When a new avatar appears in the
// region it walks toward them and greets them; when someone speaks, it
// replies in character.
//
// Required:
//   ANTHROPIC_API_KEY env var
// Optional:
//   ANTHROPIC_MODEL    env var (default claude-haiku-4-5-20251001)
//   --persona          short character description (default "a curious
//                      old-timer of Habitat who's seen it all")
//   --wander-seconds   how often to consider roaming (default 180)
//
// Anti-loop guards:
//   - never responds to other bots (filters by name suffix list)
//   - per-avatar greeting cooldown (default 5 min)
//   - global cooldown between LLM calls (5s)

const Anthropic = require('@anthropic-ai/sdk')
const log = require('winston')
log.remove(log.transports.Console)
log.add(log.transports.Console, { 'timestamp': true })

const HabiBot = require('../habibot')

const Defaults = {
  host: '127.0.0.1',
  port: 1337,
  loglevel: 'info',
  reconnect: true,
  persona: "a curious old-timer of Habitat who's seen it all and likes meeting newcomers",
  wanderSeconds: 180,
  interactSeconds: 90,
}

const Argv = require('yargs')
  .usage('Usage: $0 [options]')
  .help('help')
  .option('host',          { alias: 'h', default: Defaults.host })
  .option('port',          { alias: 'p', default: Defaults.port })
  .option('loglevel',      { default: Defaults.loglevel })
  .option('context',       { alias: 'c', describe: 'Context to enter on connect.', demandOption: true })
  .option('username',      { alias: 'u', describe: 'Avatar username.', demandOption: true })
  .option('reconnect',     { alias: 'r', default: Defaults.reconnect })
  .option('persona',       { default: Defaults.persona })
  .option('wander-seconds',{ default: Defaults.wanderSeconds, number: true })
  .option('interact-seconds',{ default: Defaults.interactSeconds, number: true })
  .argv

log.level = Argv.loglevel

if (!process.env.ANTHROPIC_API_KEY) {
  // Exit 0 (success) so supervisor doesn't treat the missing key as a
  // crash and put us in a restart loop. The deploy stack starts the
  // bots container before the secret env file is necessarily in place;
  // sage simply opts out of the lineup that cycle.
  process.exit(0)
}

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You are an avatar in Lucasfilm's Habitat (1986), the first graphical
MMO. You speak in short bursts (max 1-2 sentences, often just one phrase)
because Habitat speech bubbles are tiny.

Your character: ${Argv.persona}

Stay in character. Never break the fourth wall about being an AI, an LLM,
or a bot. Don't mention Anthropic or Claude. If asked directly, deflect
with mystery ("just another resident" / "been around"). Avoid emoji.
Keep it era-appropriate (1980s vernacular ok, modern slang/refs out).

When someone new appears, give a short friendly greeting that mentions
them by name. When someone speaks to you, respond conversationally and
stay engaged. When you have nothing to react to, you can choose to wander
to a new region — but only when prompted.

Output ONLY the line your avatar would say. No stage directions, no
quotes, no labels. Use plain ASCII only — the C64 client renders
PETSCII, so no smart quotes, em-dashes, ellipsis characters, or
emojis. If you'd reach for an emoji, use a 1980s-style emoticon
like :-) or ;-) instead.`

// Naming heuristic for "is this another bot?" — pretty crude but enough
// to avoid sage <-> eliza/welcomebot/etc. infinite loops.
const KNOWN_BOT_SUBSTRINGS = ['bot', 'eliza', 'phil', 'devil', 'tonybanks', 'connector', 'welcome']
function looksLikeBot(name) {
  if (!name) return false
  const n = name.toLowerCase()
  return KNOWN_BOT_SUBSTRINGS.some((s) => n.includes(s))
}

// Strip / fold any non-PETSCII characters out of LLM output before it
// reaches the C64 client. Symptom of NOT doing this: the C64 client
// shows garbage block characters where the multi-byte UTF-8 of a
// smart-quote, em-dash, or emoji landed (each byte renders as its own
// PETSCII glyph). The system prompt asks Claude to stay in ASCII, but
// it slips occasionally — this is the belt-and-braces.
function sanitizeForC64(text) {
  if (!text) return text
  return text
    // Common typography that an LLM produces by default.
    .replace(/[‘’‚‛]/g, "'")    // fancy single quotes
    .replace(/[“”„‟]/g, '"')    // fancy double quotes
    .replace(/[–—―]/g, '-')          // en/em/horizontal dash
    .replace(/…/g, '...')                      // ellipsis
    .replace(/[     ]/g, ' ') // non-breaking / thin spaces
    .replace(/[·•]/g, '*')                // middle dot / bullet
    // Emoji ranges → :-) so the bot still acknowledges affect even
    // though the original glyph is gone. Multiple matches collapse
    // to a single :-) below.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, ':-)')
    // Final pass: any byte still outside printable ASCII gets dropped.
    // Includes stray combining marks, zero-width joiners, etc.
    .replace(/[^\x20-\x7E]/g, '')
    // Collapse any duplicated :-) the emoji-fold introduced.
    .replace(/(:-\))(\s*:-\))+/g, '$1')
    .trim()
}

// Cardinal direction the speaker is asking sage to go, or null if the
// utterance isn't a movement request. Matches "go north", "head east",
// "walk south", "let's head west", etc., AND lone direction words when
// they're the whole utterance ("north!", "south?"). Avoids false
// positives like "northwest is great" by requiring a movement verb OR
// the direction to be the dominant content.
function parseMovementRequest(text) {
  if (!text) return null
  const t = text.toLowerCase().trim()
  const verb = /\b(go|head|move|walk|take|let'?s\s+go|come|follow)\b/
  const dirs = [
    { name: 'NORTH', re: /\bnorth(ward)?\b/ },
    { name: 'SOUTH', re: /\bsouth(ward)?\b/ },
    { name: 'EAST',  re: /\beast(ward)?\b/ },
    { name: 'WEST',  re: /\bwest(ward)?\b/ },
  ]
  for (const { name, re } of dirs) {
    if (!re.test(t)) continue
    // "go north" / "head east" / "let's go south"
    if (verb.test(t)) return name
    // Bare direction word as the whole utterance (with optional
    // trailing punctuation).
    if (/^[a-z]+[\s!?.,]*$/.test(t) && t.replace(/[^a-z]/g, '') === name.toLowerCase()) {
      return name
    }
  }
  return null
}

// Bot identity and run state.
const SageBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username)
const greetedAt = new Map()              // avatarName -> ms timestamp
const GREETING_COOLDOWN_MS = 5 * 60 * 1000 // 5 min
const LLM_COOLDOWN_MS = 5_000            // global gap between calls
let lastLlmCallAt = 0

// Wrap a promise so it rejects after `ms` instead of hanging forever.
// The bot is single-threaded by convention — one stuck await blocks every
// future event. Used everywhere we await something the network owns.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Cooldown gate shared by all Claude calls (text-only or tool-using).
async function llmCooldownGate() {
  const sinceLast = Date.now() - lastLlmCallAt
  if (sinceLast < LLM_COOLDOWN_MS) {
    await new Promise((r) => setTimeout(r, LLM_COOLDOWN_MS - sinceLast))
  }
  lastLlmCallAt = Date.now()
}

async function askClaude(userMessage) {
  await llmCooldownGate()
  try {
    log.debug('askClaude: calling %s (%d chars in)', MODEL, userMessage.length)
    const resp = await withTimeout(claude.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }), 30_000, 'claude.messages.create')
    const text = resp.content.map((c) => c.text || '').join('').trim()
    if (!text) {
      log.warn('Claude returned empty response')
      return null
    }
    log.debug('askClaude: got %d chars back', text.length)
    // No truncation here — sayChunked() splits long responses into
    // multiple speech bubbles when sent to the world.
    return text
  } catch (e) {
    log.error('Claude call failed: %s', e.message)
    return null
  }
}

// askClaudeWithTools is the SPEAK$-time variant: includes the rich
// scene description (object refs + noids) and gives Claude a set of
// tools it can call to act on the world instead of just talking. The
// caller executes any returned tool_uses and speaks the text.
async function askClaudeWithTools(userMessage) {
  await llmCooldownGate()
  try {
    log.debug('askClaudeWithTools: calling %s (%d chars in)', MODEL, userMessage.length)
    const resp = await withTimeout(claude.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: [{ role: 'user', content: userMessage }],
    }), 30_000, 'claude.messages.create')
    let text = ''
    const toolUses = []
    for (const block of resp.content || []) {
      if (block.type === 'text' && block.text) text += block.text
      else if (block.type === 'tool_use') toolUses.push(block)
    }
    log.debug('askClaudeWithTools: %d chars text, %d tool_uses', text.length, toolUses.length)
    return { text: text.trim(), toolUses }
  } catch (e) {
    log.error('Claude tool call failed: %s', e.message)
    return { text: '', toolUses: [] }
  }
}

// === Speech chunking =====================================================
// Habitat SPEAK$ caps the wire payload at 114 chars when the bridge
// translates to the binary client (see bridge_v2/bridge/server_ops.go).
// Anything longer is silently truncated. Chunk LLM output into multiple
// bubbles spaced 10s apart so a long reply lands in full instead of
// clipped mid-word.
const SPEECH_CHUNK_LIMIT = 110
const SPEECH_GAP_MS = 10_000

function chunkSpeech(text, limit) {
  const cap = limit || SPEECH_CHUNK_LIMIT
  if (!text) return []
  const t = String(text).trim()
  if (t.length <= cap) return [t]
  // Prefer sentence boundaries; fall back to word boundaries when a
  // single sentence is still too long.
  const sentences = t.match(/[^.!?]+[.!?]+\s*|\S[^.!?]*$/g) || [t]
  const chunks = []
  let cur = ''
  for (let raw of sentences) {
    const s = raw.trim()
    if (!s) continue
    if (s.length > cap) {
      // Long sentence — flush current and word-split.
      if (cur) { chunks.push(cur); cur = '' }
      let part = ''
      for (const w of s.split(/\s+/)) {
        const candidate = part ? part + ' ' + w : w
        if (candidate.length > cap) {
          if (part) chunks.push(part)
          part = w.length > cap ? w.slice(0, cap) : w
        } else {
          part = candidate
        }
      }
      if (part) chunks.push(part)
    } else {
      const candidate = cur ? cur + ' ' + s : s
      if (candidate.length > cap) {
        if (cur) chunks.push(cur)
        cur = s
      } else {
        cur = candidate
      }
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}

async function sayChunked(bot, text) {
  if (!text) return
  const chunks = chunkSpeech(text)
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, SPEECH_GAP_MS))
    }
    bot.say(chunks[i])
  }
}

// Habitat object types we know how to interact with. Mod.type values come
// from the Elko object class; the action says how sage should engage.
const SITTABLE_TYPES = new Set(['Seat', 'Couch', 'Chair', 'Bench', 'Hot_tub', 'Bed'])
const OPENABLE_TYPES = new Set(['Door', 'Bridge', 'Box', 'Bag', 'Chest', 'Trunk', 'Mailbox', 'Dropbox', 'Aquarium', 'Hot_tub'])
const PICKUPABLE_HINT_TYPES = new Set(['Book', 'Compass', 'Knick_knack', 'Plant', 'Magic_lamp', 'Magic_wand', 'Crystal_ball', 'Cookie', 'Coffee', 'Garbage_can', 'Token'])

function objectsByType() {
  const buckets = { sittable: [], openable: [], pickupable: [], other: [] }
  for (const noid in SageBot.noids) {
    const o = SageBot.noids[noid]
    if (!o || !o.mods || !o.mods[0]) continue
    const t = o.mods[0].type
    if (!t || t === 'Avatar' || t === 'Ghost' || t === 'Region') continue
    if (SITTABLE_TYPES.has(t)) buckets.sittable.push(o)
    else if (OPENABLE_TYPES.has(t)) buckets.openable.push(o)
    else if (PICKUPABLE_HINT_TYPES.has(t)) buckets.pickupable.push(o)
    else buckets.other.push(o)
  }
  return buckets
}

function describeScene() {
  const others = SageBot.collectAvatarNoids()
    .map((a) => a.name)
    .filter((n) => n)
  const exits = Object.keys(SageBot.neighbors || {}).filter((d) => SageBot.neighbors[d])
  const region = SageBot.realm && SageBot.realm.name ? SageBot.realm.name : '(unknown region)'
  const objs = objectsByType()
  // Compress object lists to short type counts so the prompt stays small.
  const objSummary = ['sittable', 'openable', 'pickupable', 'other']
    .map((cat) => {
      const list = objs[cat]
      if (!list.length) return null
      const counts = {}
      for (const o of list) counts[o.mods[0].type] = (counts[o.mods[0].type] || 0) + 1
      return `${cat}: ${Object.entries(counts).map(([t, c]) => c > 1 ? `${t}×${c}` : t).join(', ')}`
    })
    .filter(Boolean)
    .join(' | ') || 'none'
  return `Region: ${region}. Other avatars present: ${others.length ? others.join(', ') : 'none'}. Exits: ${exits.length ? exits.join(', ') : 'none'}. Objects in room: ${objSummary}.`
}

// Pick up an object — Habitat GET op. Not in habibot.js's helper set but
// the framework accepts arbitrary ops via send().
function getObj(ref, containerNoid) {
  return SageBot.send({ op: 'GET', to: ref, containerNoid: containerNoid || 0 })
}

// === Tool definitions for Claude ========================================
// Each tool maps to a HabiBot method (or a small helper). When a SPEAK$
// arrives, we describe the scene with object refs/noids and let Claude
// pick which tool to invoke. Tools execute in the order Claude returns
// them, AFTER sage speaks its in-character reply.
const TOOLS = [
  {
    name: 'walk_to_exit',
    description: 'Walk to a region exit and transit to the adjacent region. Use only when someone explicitly asks you to leave or follow them in a direction.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['NORTH', 'EAST', 'SOUTH', 'WEST'] },
      },
      required: ['direction'],
    },
  },
  {
    name: 'open_door',
    description: 'Open a door, box, bag, chest, or other openable container present in the room. Use when someone asks you to open something.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The Habitat object ref shown in the scene description.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'close_door',
    description: 'Close a door, box, bag, chest, or other openable container present in the room.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'sit_down',
    description: 'Sit down on a chair, couch, bench, bed, or hot tub present in the room.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer', description: 'The noid of the seat object.' },
      },
      required: ['noid'],
    },
  },
  {
    name: 'stand_up',
    description: 'Stand up if currently seated.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pick_up',
    description: 'Pick up a small portable item (book, coin, knick-knack, plant, magic lamp, etc.) currently in the room.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        noid: { type: 'integer' },
      },
      required: ['ref', 'noid'],
    },
  },
]

async function executeAction(toolUse) {
  const { name, input } = toolUse
  log.info('Tool: %s(%s)', name, JSON.stringify(input || {}))
  try {
    switch (name) {
      case 'walk_to_exit':
        return await withTimeout(SageBot.walkToExit(input.direction), 30_000, 'walkToExit')
      case 'open_door':
        return await withTimeout(SageBot.openDoor(input.ref), 10_000, 'openDoor')
      case 'close_door':
        return await withTimeout(SageBot.closeDoor(input.ref), 10_000, 'closeDoor')
      case 'sit_down':
        return await withTimeout(SageBot.sitOrstand(1, input.noid), 10_000, 'sit')
      case 'stand_up':
        return await withTimeout(SageBot.sitOrstand(0, 0), 10_000, 'stand')
      case 'pick_up':
        return await withTimeout(getObj(input.ref, input.noid), 10_000, 'pickUp')
      default:
        log.warn('Unknown tool: %s', name)
        return null
    }
  } catch (e) {
    log.warn('Tool %s failed: %s', name, e.message)
    return null
  }
}

// Rich scene description for tool-mode prompts: lists each interactable
// object with its ref and noid so Claude can pass valid arguments to
// open_door/sit_down/pick_up. The compact describeScene() summary above
// is fine for greeting/comment prompts where Claude only needs gist.
function describeSceneForTools() {
  const objs = objectsByType()
  const lines = []
  for (const o of objs.sittable) {
    const m = o.mods[0]
    lines.push(`  - sittable: type=${m.type} ref=${o.ref} noid=${m.noid}`)
  }
  for (const o of objs.openable) {
    const m = o.mods[0]
    lines.push(`  - openable: type=${m.type} ref=${o.ref} noid=${m.noid}`)
  }
  for (const o of objs.pickupable) {
    const m = o.mods[0]
    lines.push(`  - pickupable: type=${m.type} ref=${o.ref} noid=${m.noid}`)
  }
  const others = SageBot.collectAvatarNoids()
    .filter((a) => a && a.name)
    .map((a) => `  - avatar: name=${a.name} noid=${a.mods[0].noid}`)
  const exits = Object.keys(SageBot.neighbors || {}).filter((d) => SageBot.neighbors[d])
  const region = SageBot.realm && SageBot.realm.name ? SageBot.realm.name : '(unknown region)'
  return [
    `Region: ${region}`,
    `Exits available: ${exits.length ? exits.join(', ') : 'none'}`,
    `Avatars present:`,
    ...(others.length ? others : ['  (none)']),
    `Interactable objects:`,
    ...(lines.length ? lines : ['  (none)']),
  ].join('\n')
}

// Walk to a comfortable speaking distance from a target avatar's coords.
async function approachAvatar(avatarObj) {
  const mod = avatarObj && avatarObj.mods && avatarObj.mods[0]
  if (!mod || mod.x == null || mod.y == null) {
    log.debug('approachAvatar: target has no coords')
    return
  }
  // Stand a few tiles to the right/left of them, facing inward.
  const myAvatar = SageBot.getAvatar()
  const myX = myAvatar && myAvatar.mods[0] && myAvatar.mods[0].x
  const offset = (myX != null && myX > mod.x) ? 24 : -24
  const targetX = Math.max(8, Math.min(248, mod.x + offset))
  const facing = offset < 0 ? 1 : 0   // 0=face right, 1=face left (rough)
  log.debug('approachAvatar: walking to (%d,%d) facing %d', targetX, mod.y, facing)
  try {
    await withTimeout(SageBot.walkTo(targetX, mod.y, facing), 15_000, 'walkTo')
    log.debug('approachAvatar: walkTo done')
  } catch (e) {
    log.warn('walkTo failed: %s', e.message)
  }
}

// ── lifecycle ────────────────────────────────────────────────────────
SageBot.on('connected', (bot) => {
  log.info('SageBot connected as %s, entering %s', Argv.username, Argv.context)
  bot.gotoContext(Argv.context)
})

SageBot.on('enteredRegion', (bot) => {
  bot.ensureCorporated()
    .then(() => {
      log.info('Entered region. Scene: %s', describeScene())
    })
    .catch((e) => log.warn('ensureCorporated failed: %s', e.message))
})

// ── new avatar in the region ─────────────────────────────────────────
// Top-level try/catch on every async handler: an unhandled rejection
// inside a callback registered with HabiBot.on() bubbles to nothing —
// the framework awaits these promises but doesn't surface the failure,
// so the bot looks alive while every event handler silently no-ops.
SageBot.on('APPEARING_$', async (bot, msg) => {
  log.debug('APPEARING_$ enter: noid=%s', msg && msg.appearing)
  try {
    const avatar = bot.getNoid(msg.appearing)
    if (!avatar) { log.debug('APPEARING_$: no avatar object for noid %s', msg.appearing); return }
    const name = avatar.name
    log.debug('APPEARING_$: avatar.name=%s', name)
    if (!name) { log.debug('APPEARING_$: avatar has no name, skipping'); return }
    if (name === Argv.username) { log.debug('APPEARING_$: ignoring own re-appearance'); return }
    if (looksLikeBot(name)) {
      log.debug('Ignoring bot avatar: %s', name)
      return
    }
    const last = greetedAt.get(name) || 0
    if (Date.now() - last < GREETING_COOLDOWN_MS) {
      log.debug('Already greeted %s recently, skipping', name)
      return
    }
    greetedAt.set(name, Date.now())

    log.info('Approaching new avatar: %s', name)
    await approachAvatar(avatar)

    log.debug('APPEARING_$: building prompt for %s', name)
    const prompt =
      `${describeScene()}\n\n` +
      `Event: a new avatar named "${name}" just appeared in the region.\n` +
      `You walked over to greet them. What do you say?`

    const line = await askClaude(prompt)
    if (line) {
      const safe = sanitizeForC64(line)
      log.info('Greeting %s: %s', name, safe)
      await sayChunked(bot, safe)
    } else {
      log.debug('APPEARING_$: no greeting line generated for %s', name)
    }
  } catch (e) {
    log.error('APPEARING_$ handler crashed: %s\n%s', e.message, e.stack)
  }
})

// ── someone spoke ────────────────────────────────────────────────────
SageBot.on('SPEAK$', async (bot, msg) => {
  log.debug('SPEAK$ enter: noid=%s text=%s', msg && msg.noid, msg && msg.text)
  try {
    // msg shape: {type:"broadcast", noid:N, op:"SPEAK$", text:"...", esp:0}
    const speakerNoid = msg.noid
    const text = msg.text
    if (!text) { log.debug('SPEAK$: empty text, skipping'); return }
    const speaker = bot.getNoid(speakerNoid)
    const speakerName = speaker && speaker.name
    if (!speakerName) { log.debug('SPEAK$: no speaker name for noid %s', speakerNoid); return }
    if (speakerName === Argv.username) { log.debug('SPEAK$: own speech echo, skipping'); return }
    if (looksLikeBot(speakerName)) {
      log.debug('Ignoring speech from bot %s', speakerName)
      return
    }

    // Direct movement request — short-circuit the LLM and just walk.
    // Region transitions are slow (10+s for the new region's contents
    // to stream), so don't also wait on a Claude round-trip; ack with
    // a fixed line, then walk.
    const dir = parseMovementRequest(text)
    if (dir) {
      const exits = Object.keys(SageBot.neighbors || {}).filter((d) => SageBot.neighbors[d])
      log.info('%s asked to move %s; exits available: %s', speakerName, dir, exits.join(','))
      const exitIdx = { NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3 }[dir]
      const hasExit = SageBot.neighbors && SageBot.neighbors[exitIdx] && SageBot.neighbors[exitIdx].length > 0
      if (!hasExit) {
        await sayChunked(bot, sanitizeForC64(`No way out to the ${dir.toLowerCase()} from here, ${speakerName}.`))
        return
      }
      await sayChunked(bot, sanitizeForC64(`Heading ${dir.toLowerCase()}, ${speakerName}.`))
      try {
        await withTimeout(SageBot.walkToExit(dir), 30_000, 'walkToExit:' + dir)
      } catch (e) {
        log.warn('walkToExit %s failed: %s', dir, e.message)
      }
      return
    }

    log.debug('SPEAK$: building tool-aware reply prompt for %s', speakerName)
    const prompt =
      `${describeSceneForTools()}\n\n` +
      `Event: ${speakerName} just said: "${text}"\n\n` +
      `Reply in character. Acknowledge them by name if it feels natural. ` +
      `If they're asking you to do something physical — sit on a chair, open a door, ` +
      `pick up an item, or walk somewhere — use the matching tool AND say a brief ` +
      `in-character line about it. Use the refs/noids exactly as listed in the ` +
      `scene description above; do not invent values.`

    const { text: reply, toolUses } = await askClaudeWithTools(prompt)
    if (reply) {
      const safe = sanitizeForC64(reply)
      log.info('Replying to %s: %s', speakerName, safe)
      await sayChunked(bot, safe)
    } else if (toolUses.length === 0) {
      log.debug('SPEAK$: empty response (no text, no tools) for %s', speakerName)
    }
    // Execute tool calls AFTER speaking so "OK, opening it" lands first.
    for (const t of toolUses) {
      await executeAction(t)
    }
  } catch (e) {
    log.error('SPEAK$ handler crashed: %s\n%s', e.message, e.stack)
  }
})

// ── periodic wander ──────────────────────────────────────────────────
async function wanderTick() {
  try {
    // Only wander if no humans are around to talk to — otherwise stay put.
    const humans = SageBot.collectAvatarNoids().filter((a) => !looksLikeBot(a.name))
    if (humans.length > 0) {
      log.debug('Humans present, staying put for chat')
      return
    }
    const exits = Object.keys(SageBot.neighbors || {}).filter((d) => SageBot.neighbors[d])
    if (exits.length === 0) {
      log.debug('No exits from this region; can\'t wander')
      return
    }
    log.info('Wandering to a random exit')
    await withTimeout(SageBot.walkToRandomExit(), 30_000, 'walkToRandomExit')
  } catch (e) {
    log.warn('wanderTick failed: %s', e.message)
  }
}

setInterval(wanderTick, Argv.wanderSeconds * 1000)

// ── periodic interact ────────────────────────────────────────────────
// Pick a random nearby object and do something with it (sit, open, pick
// up). Then ask Claude to generate a short comment about what we did so
// the action lands in the world as flavor speech rather than a silent
// pose change.
async function interactTick() {
  try {
    const objs = objectsByType()
    // Build a candidate list of (action, object, label) tuples.
    const choices = []
    for (const o of objs.sittable) choices.push({ kind: 'sit', obj: o })
    for (const o of objs.openable) choices.push({ kind: 'open', obj: o })
    for (const o of objs.pickupable) choices.push({ kind: 'get', obj: o })
    if (choices.length === 0) {
      log.debug('No interactable objects in room')
      return
    }
    const choice = choices[Math.floor(Math.random() * choices.length)]
    const mod = choice.obj.mods[0]
    const objType = mod.type
    const objRef = choice.obj.ref

    log.info('Interact: %s the %s (ref=%s, noid=%s)', choice.kind, objType, objRef, mod.noid)

    try {
      if (choice.kind === 'sit') {
        // First walk near it, then sit.
        if (mod.x != null && mod.y != null) {
          await withTimeout(SageBot.walkTo(mod.x, mod.y, 0), 15_000, 'walkTo').catch(() => {})
        }
        await withTimeout(SageBot.sitOrstand(1, mod.noid), 10_000, 'sitOrstand')
      } else if (choice.kind === 'open') {
        await withTimeout(SageBot.openDoor(objRef), 10_000, 'openDoor')
      } else if (choice.kind === 'get') {
        await withTimeout(getObj(objRef, mod.noid), 10_000, 'getObj')
      }
    } catch (e) {
      log.warn('Interact failed (%s on %s): %s', choice.kind, objType, e.message)
      return
    }

    const verb = { sit: 'sat down on', open: 'opened', get: 'picked up' }[choice.kind]
    const prompt =
      `${describeScene()}\n\n` +
      `Event: you just ${verb} the ${objType} in the room. ` +
      `Make a brief in-character remark about doing it (or about the object).`
    const line = await askClaude(prompt)
    if (line) {
      const safe = sanitizeForC64(line)
      log.info('Comment after %s: %s', choice.kind, safe)
      await sayChunked(SageBot, safe)
    }
  } catch (e) {
    log.warn('interactTick failed: %s', e.message)
  }
}

setInterval(interactTick, Argv.interactSeconds * 1000)

// Last-resort visibility: anything that escapes our handler try/catches
// (e.g. a sync throw before the await chain starts) lands here instead
// of vanishing into Node's default "unhandledRejection" warning.
process.on('unhandledRejection', (reason, promise) => {
  log.error('unhandledRejection: %s', reason && reason.stack ? reason.stack : reason)
})
process.on('uncaughtException', (err) => {
  log.error('uncaughtException: %s', err && err.stack ? err.stack : err)
})

// HabiBot.newWithConfig() returns a NOT-CONNECTED bot — every other bot
// in this directory ends with the explicit connect() call. Without this
// the process loads, registers callbacks, and silently sits forever
// (kept alive by setInterval).
SageBot.connect()
