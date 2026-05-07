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
//   HABIBOTS_MONGO_URL env var (default mongodb://neohabitatmongo:27017)
//   --persona          short character description (default "a curious
//                      old-timer of Habitat who's seen it all")
//   --wander-seconds   how often to consider roaming (default 180)
//
// Subsystem split (post-2026 refactor):
//   bots/sage.js          — orchestrator: events → prompt → tools → speech
//   lib/sage/memory.js    — persistent mongo-backed memory
//   lib/sage/awareness.js — scene + inventory synthesis from HabiBot state
//   lib/sage/tools.js     — Claude tool catalogue + dispatcher
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
const memoryLib = require('../lib/sage/memory')
const awareness = require('../lib/sage/awareness')
const { TOOLS, executeAction } = require('../lib/sage/tools')

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

// Mongo-backed memory. connectMemory is idempotent and degrades to no-op
// if mongo isn't reachable (dev without the docker stack), so the bot
// boots regardless.
const mem = memoryLib.connectMemory()

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

You have memory. The prompt may include "Recent conversation with X" and
"What you've noted about X" sections — treat those as your own memories.
Use the remember tool when you learn something durably interesting (a
person's role, a promise made, a recurring topic). Use recall to search
older context when a name jogs something you can't quite place.

You also have an inventory. The "In your pockets" section lists what you
ARE carrying; the "Interactable objects in this region" section lists
items in the world that are NOT yours. Don't confuse the two — never
narrate or claim ownership of items in the room as if they were yours.
When in doubt, use list_inventory to check.

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
    .replace(/[     ]/g, ' ') // non-breaking / thin spaces
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
const MAX_TOOL_TURNS = 5                 // hard cap on multi-turn tool loop
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
    return text
  } catch (e) {
    log.error('Claude call failed: %s', e.message)
    return null
  }
}

// Multi-turn tool loop. Claude can chain actions: e.g. list_inventory →
// see it has the magic lamp → emit text → give_to_avatar → emit closing
// line. We speak any text Claude produces between tool calls so the
// world-side action lands in the same beat.
//
// Capped at MAX_TOOL_TURNS to bound cost and prevent a tool-error/retry
// loop from running forever; in practice 1-3 turns covers any realistic
// chain.
async function askClaudeWithTools(userMessage) {
  const messages = [{ role: 'user', content: userMessage }]
  let allText = ''

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    await llmCooldownGate()
    let resp
    try {
      log.debug('askClaudeWithTools turn %d: calling %s', turn, MODEL)
      resp = await withTimeout(claude.messages.create({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      }), 30_000, 'claude.messages.create')
    } catch (e) {
      log.error('Claude tool call failed turn %d: %s', turn, e.message)
      return { text: allText.trim() }
    }

    let turnText = ''
    const toolUses = []
    for (const block of resp.content || []) {
      if (block.type === 'text' && block.text) turnText += block.text
      else if (block.type === 'tool_use') toolUses.push(block)
    }
    log.debug('turn %d: %d chars text, %d tool_uses, stop=%s', turn, turnText.length, toolUses.length, resp.stop_reason)

    // Speak any text produced this turn (between/before tool calls).
    if (turnText.trim()) {
      const safe = sanitizeForC64(turnText.trim())
      if (safe) {
        await sayChunked(SageBot, safe)
        allText += (allText ? ' ' : '') + safe
      }
    }

    // No tool calls → terminal turn.
    if (toolUses.length === 0) {
      return { text: allText.trim() }
    }

    // Run tools and feed results back as a tool_result-typed user message.
    const toolResults = []
    for (const t of toolUses) {
      const result = await executeAction(t, SageBot, { mem })
      toolResults.push({
        type: 'tool_result',
        tool_use_id: t.id,
        content: JSON.stringify(result == null ? null : result),
      })
    }
    messages.push({ role: 'assistant', content: resp.content })
    messages.push({ role: 'user', content: toolResults })
  }

  log.warn('askClaudeWithTools: hit MAX_TOOL_TURNS=%d', MAX_TOOL_TURNS)
  return { text: allText.trim() }
}

// === Speech chunking =====================================================
// Habitat SPEAK$ caps the wire payload at 114 chars when the bridge
// translates to the binary client (see bridge_v2/bridge/server_ops.go).
// Anything longer is silently truncated. Chunk LLM output into multiple
// bubbles. Gap was 10s historically, but that long a pause feels like
// sage forgot the conversation mid-thought; 1s reads as continuous
// speech while still letting the client render each bubble cleanly.
const SPEECH_CHUNK_LIMIT = 110
const SPEECH_GAP_MS = 1_000

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

// Walk to a comfortable speaking distance from a target avatar's coords.
async function approachAvatar(avatarObj) {
  const mod = avatarObj && avatarObj.mods && avatarObj.mods[0]
  if (!mod || mod.x == null || mod.y == null) {
    log.debug('approachAvatar: target has no coords')
    return
  }
  const myAvatar = SageBot.getAvatar()
  const myX = myAvatar && myAvatar.mods[0] && myAvatar.mods[0].x
  const offset = (myX != null && myX > mod.x) ? 24 : -24
  const targetX = Math.max(8, Math.min(248, mod.x + offset))
  const facing = offset < 0 ? 1 : 0
  log.debug('approachAvatar: walking to (%d,%d) facing %d', targetX, mod.y, facing)
  try {
    await withTimeout(SageBot.walkTo(targetX, mod.y, facing), 15_000, 'walkTo')
    log.debug('approachAvatar: walkTo done')
  } catch (e) {
    log.warn('walkTo failed: %s', e.message)
  }
}

// Build the auto-injected memory block for a SPEAK$ prompt: last few
// conversation turns with this avatar plus durable notes about them.
// Returns "" when memory is empty or unavailable, so callers can just
// drop it inline.
async function memoryBlockFor(speakerName) {
  const botName = SageBot.config.username
  try {
    const [turns, notes] = await Promise.all([
      mem.recentTurns({ bot: botName, avatar: speakerName, limit: 5 }),
      mem.notesAbout({ bot: botName, subject: speakerName, limit: 5 }),
    ])
    if (!turns.length && !notes.length) return ''
    const lines = []
    if (turns.length) {
      lines.push(`Recent conversation with ${speakerName}:`)
      // recentTurns is newest-first; reverse so prompt reads chronologically.
      for (const r of [...turns].reverse()) {
        const who = r.direction === 'outgoing' ? 'you' : speakerName.toLowerCase()
        const ago = humanAgo(r.ts)
        lines.push(`  [${ago}] ${who}: "${(r.text || '').slice(0, 200)}"`)
      }
    }
    if (notes.length) {
      lines.push(`What you've noted about ${speakerName}:`)
      for (const n of notes) {
        lines.push(`  - ${n.fact}`)
      }
    }
    let block = lines.join('\n')
    // Cap aggressively — total prompt budget matters more than perfect
    // recall, and the most-recent rows are at the top/bottom anyway.
    if (block.length > 1500) block = block.slice(0, 1500) + '\n  ...(truncated)'
    return block
  } catch (e) {
    log.warn('memoryBlockFor failed: %s', e.message)
    return ''
  }
}

function humanAgo(ts) {
  if (!ts) return '?'
  const t = ts instanceof Date ? ts : new Date(ts)
  const sec = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

// ── lifecycle ────────────────────────────────────────────────────────
SageBot.on('connected', (bot) => {
  log.info('SageBot connected as %s, entering %s', Argv.username, Argv.context)
  bot.gotoContext(Argv.context)
})

SageBot.on('enteredRegion', (bot) => {
  bot.ensureCorporated()
    .then(() => {
      log.info('Entered region. Scene:\n%s', awareness.describeWorld(bot))
      // Snapshot inventory on every region change. After a restart the
      // bot's noid table is empty until the next make storm; persisting
      // the last-seen pocket contents lets the prompt pre-load them on
      // reconnect (see prompt-build below).
      const items = awareness.getInventory(bot)
      mem.saveInventory({ bot: bot.config.username, items }).catch((e) => {
        log.debug('saveInventory failed (non-fatal): %s', e.message)
      })
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

    const memBlock = await memoryBlockFor(name)
    log.debug('APPEARING_$: building prompt for %s (memBlock=%d chars)', name, memBlock.length)
    const prompt =
      `${awareness.describeWorld(bot)}\n\n` +
      (memBlock ? `${memBlock}\n\n` : '') +
      `Event: a new avatar named "${name}" just appeared in the region.\n` +
      `You walked over to greet them. What do you say?`

    const line = await askClaude(prompt)
    if (line) {
      const safe = sanitizeForC64(line)
      log.info('Greeting %s: %s', name, safe)
      await sayChunked(bot, safe)
      mem.logTurn({
        bot: bot.config.username,
        avatar: name,
        region: awareness.currentRegionRef(bot),
        direction: 'outgoing',
        text: safe,
      }).catch(() => {})
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

    // Log the inbound turn before any processing — even fast-path
    // (movement-shortcut) replies should record what we heard.
    mem.logTurn({
      bot: bot.config.username,
      avatar: speakerName,
      region: awareness.currentRegionRef(bot),
      direction: 'incoming',
      text,
    }).catch(() => {})

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
      const reply = hasExit
        ? `Heading ${dir.toLowerCase()}, ${speakerName}.`
        : `No way out to the ${dir.toLowerCase()} from here, ${speakerName}.`
      const safe = sanitizeForC64(reply)
      await sayChunked(bot, safe)
      mem.logTurn({
        bot: bot.config.username,
        avatar: speakerName,
        region: awareness.currentRegionRef(bot),
        direction: 'outgoing',
        text: safe,
      }).catch(() => {})
      if (hasExit) {
        try {
          await withTimeout(SageBot.walkToExit(dir), 30_000, 'walkToExit:' + dir)
        } catch (e) {
          log.warn('walkToExit %s failed: %s', dir, e.message)
        }
      }
      return
    }

    const memBlock = await memoryBlockFor(speakerName)
    log.debug('SPEAK$: building tool-aware reply prompt for %s (memBlock=%d chars)', speakerName, memBlock.length)
    const prompt =
      `${awareness.describeWorld(bot)}\n\n` +
      (memBlock ? `${memBlock}\n\n` : '') +
      `Event: ${speakerName} just said: "${text}"\n\n` +
      `Reply in character. Acknowledge them by name if it feels natural. ` +
      `If they're asking you to do something physical — sit on a chair, open a door, ` +
      `pick up an item, walk somewhere, hand them an item from your pocket — use the ` +
      `matching tool AND say a brief in-character line about it. Use refs/noids ` +
      `exactly as listed above; never invent values. If the request needs a fact you ` +
      `don't immediately have, try the recall tool before answering.`

    const { text: reply } = await askClaudeWithTools(prompt)
    if (reply) {
      log.info('Replied to %s: %s', speakerName, reply)
      mem.logTurn({
        bot: bot.config.username,
        avatar: speakerName,
        region: awareness.currentRegionRef(bot),
        direction: 'outgoing',
        text: reply,
      }).catch(() => {})
    }
  } catch (e) {
    log.error('SPEAK$ handler crashed: %s\n%s', e.message, e.stack)
  }
})

// ── periodic wander ──────────────────────────────────────────────────
async function wanderTick() {
  try {
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
    const objs = awareness.objectsByType(SageBot)
    const myRef = SageBot.names && SageBot.names.USER
    // Build a candidate list of (action, object, label) tuples — but
    // skip items currently in our own pocket. Sage shouldn't randomly
    // sit on its own knick-knack or re-pick-up what it's holding.
    const choices = []
    const notMine = (o) => !o._container || o._container !== myRef
    for (const o of objs.sittable.filter(notMine)) choices.push({ kind: 'sit', obj: o })
    for (const o of objs.openable.filter(notMine)) choices.push({ kind: 'open', obj: o })
    for (const o of objs.pickupable.filter(notMine)) choices.push({ kind: 'get', obj: o })
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
        if (mod.x != null && mod.y != null) {
          await withTimeout(SageBot.walkTo(mod.x, mod.y, 0), 15_000, 'walkTo').catch(() => {})
        }
        await withTimeout(SageBot.sitOrstand(1, mod.noid), 10_000, 'sitOrstand')
      } else if (choice.kind === 'open') {
        await withTimeout(SageBot.openDoor(objRef), 10_000, 'openDoor')
      } else if (choice.kind === 'get') {
        await withTimeout(
          SageBot.send({ op: 'GET', to: objRef, containerNoid: mod.noid || 0 }),
          10_000, 'getObj')
      }
    } catch (e) {
      log.warn('Interact failed (%s on %s): %s', choice.kind, objType, e.message)
      return
    }

    const verb = { sit: 'sat down on', open: 'opened', get: 'picked up' }[choice.kind]
    const prompt =
      `${awareness.describeWorld(SageBot)}\n\n` +
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
