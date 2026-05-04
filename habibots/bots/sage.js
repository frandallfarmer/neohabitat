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
  .argv

log.level = Argv.loglevel

if (!process.env.ANTHROPIC_API_KEY) {
  log.error('ANTHROPIC_API_KEY env var must be set')
  process.exit(1)
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
quotes, no labels.`

// Naming heuristic for "is this another bot?" — pretty crude but enough
// to avoid sage <-> eliza/welcomebot/etc. infinite loops.
const KNOWN_BOT_SUBSTRINGS = ['bot', 'eliza', 'phil', 'devil', 'tonybanks', 'connector', 'welcome']
function looksLikeBot(name) {
  if (!name) return false
  const n = name.toLowerCase()
  return KNOWN_BOT_SUBSTRINGS.some((s) => n.includes(s))
}

// Bot identity and run state.
const SageBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username)
const greetedAt = new Map()              // avatarName -> ms timestamp
const GREETING_COOLDOWN_MS = 5 * 60 * 1000 // 5 min
const LLM_COOLDOWN_MS = 5_000            // global gap between calls
let lastLlmCallAt = 0

async function askClaude(userMessage) {
  const now = Date.now()
  const sinceLast = now - lastLlmCallAt
  if (sinceLast < LLM_COOLDOWN_MS) {
    await new Promise((r) => setTimeout(r, LLM_COOLDOWN_MS - sinceLast))
  }
  lastLlmCallAt = Date.now()

  try {
    const resp = await claude.messages.create({
      model: MODEL,
      max_tokens: 120,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    const text = resp.content.map((c) => c.text || '').join('').trim()
    if (!text) {
      log.warn('Claude returned empty response')
      return null
    }
    // Habitat speech bubbles are short. Hard cap.
    return text.length > 200 ? text.slice(0, 197) + '...' : text
  } catch (e) {
    log.error('Claude call failed: %s', e.message)
    return null
  }
}

function describeScene() {
  const myNoid = SageBot.getAvatarNoid()
  const others = SageBot.collectAvatarNoids()
    .map((a) => a.name)
    .filter((n) => n)
  const exits = Object.keys(SageBot.neighbors || {}).filter((d) => SageBot.neighbors[d])
  const region = SageBot.realm && SageBot.realm.name ? SageBot.realm.name : '(unknown region)'
  return `Region: ${region}. Other avatars present: ${others.length ? others.join(', ') : 'none'}. Exits: ${exits.length ? exits.join(', ') : 'none'}.`
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
  const myX = myAvatar && myAvatar.mods[0].x
  const offset = (myX != null && myX > mod.x) ? 24 : -24
  const targetX = Math.max(8, Math.min(248, mod.x + offset))
  const facing = offset < 0 ? 1 : 0   // 0=face right, 1=face left (rough)
  try {
    await SageBot.walkTo(targetX, mod.y, facing)
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
SageBot.on('APPEARING_$', async (bot, msg) => {
  const avatar = bot.getNoid(msg.appearing)
  if (!avatar) return
  const name = avatar.name
  if (!name) return
  if (name === Argv.username) return       // ignore own re-appearance
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

  const prompt =
    `${describeScene()}\n\n` +
    `Event: a new avatar named "${name}" just appeared in the region.\n` +
    `You walked over to greet them. What do you say?`

  const line = await askClaude(prompt)
  if (line) {
    log.info('Greeting %s: %s', name, line)
    bot.say(line)
  }
})

// ── someone spoke ────────────────────────────────────────────────────
SageBot.on('SPEAK$', async (bot, msg) => {
  // msg shape: {type:"broadcast", noid:N, op:"SPEAK$", text:"...", esp:0}
  const speakerNoid = msg.noid
  const text = msg.text
  if (!text) return
  const speaker = bot.getNoid(speakerNoid)
  const speakerName = speaker && speaker.name
  if (!speakerName) return
  if (speakerName === Argv.username) return // our own speech echoed back
  if (looksLikeBot(speakerName)) {
    log.debug('Ignoring speech from bot %s', speakerName)
    return
  }

  const prompt =
    `${describeScene()}\n\n` +
    `Event: ${speakerName} just said: "${text}"\n` +
    `Reply in character. Acknowledge them by name if it feels natural.`

  const line = await askClaude(prompt)
  if (line) {
    log.info('Replying to %s: %s', speakerName, line)
    bot.say(line)
  }
})

// ── periodic wander ──────────────────────────────────────────────────
async function wanderTick() {
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
  try {
    await SageBot.walkToRandomExit()
  } catch (e) {
    log.warn('walkToRandomExit failed: %s', e.message)
  }
}

setInterval(wanderTick, Argv.wanderSeconds * 1000)
