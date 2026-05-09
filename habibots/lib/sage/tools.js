/* jslint bitwise: true */
/* jshint esversion: 8 */

'use strict'

// tools.js — Claude tool definitions + dispatcher for SageBot.
//
// The wrap pattern: each tool is one entry in the TOOLS array (name +
// JSON-schema input) plus one case in executeAction's switch. To add a
// new tool:
//   1. Append a {name, description, input_schema} object to TOOLS below.
//   2. Add a `case 'foo':` to executeAction that calls the matching
//      HabiBot helper or memory method.
//   3. Update sage.js's system prompt only if the tool has non-obvious
//      semantics ("don't use this for X" rules).
//
// Most tools just delegate to HabiBot helpers; a few wrap raw ops via
// bot.send when there's no helper yet. Memory tools are the third
// category: they don't touch the world, they touch mongo.
//
// Out of scope (commented for the next person who reads this):
//   - ATTACK / STUN — sage isn't a combat bot. Giving Claude attack
//     verbs is asking for "the sage assaulted Steve" PRs.
//   - DEPOSIT / WITHDRAW / PAYTO — banking. No use case.
//   - CUSTOMIZE / SPRAY / SEXCHANGE — avatar mutation; one-shot and
//     pretty disruptive.
//   - FNKEY — meta UI, not narratively useful.
//   - RUB / WISH / item-specific magic verbs — re-add when sage
//     actually carries a magic lamp / wand and there's a story reason.

const log = require('winston')
const awareness = require('./awareness')

const TOOLS = [
  // ── movement / navigation ────────────────────────────────────────
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
    name: 'walk_to_avatar',
    description: 'Walk over to a specific avatar in the current region.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The avatar name shown in the scene description.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'walk_to_coords',
    description: 'Walk to specific tile coordinates within the current region. Use only if you have a reason to stand somewhere precise; prefer walk_to_avatar or walk_to_exit when applicable.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'integer', description: '0-255, screen X.' },
        y: { type: 'integer', description: '128-160 typical floor range.' },
        facing: { type: 'integer', enum: [0, 1], description: '0 faces right, 1 faces left.' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'face_direction',
    description: 'Turn your avatar to face LEFT, RIGHT, FORWARD (toward the camera), or BEHIND.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['LEFT', 'RIGHT', 'FORWARD', 'BEHIND'] },
      },
      required: ['direction'],
    },
  },
  {
    name: 'wait',
    description: 'Pause for dramatic effect. Useful before delivering a punchline or when the conversation wants a beat. Max 5 seconds.',
    input_schema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', minimum: 0.5, maximum: 5 },
      },
      required: ['seconds'],
    },
  },

  // ── posture / emote ──────────────────────────────────────────────
  {
    name: 'do_posture',
    description: 'Perform a body posture / emote. Useful for non-verbal acknowledgement (WAVE at someone, JUMP for joy, FROWN at a complaint).',
    input_schema: {
      type: 'object',
      properties: {
        posture: { type: 'string', enum: ['WAVE', 'POINT', 'EXTEND_HAND', 'JUMP', 'BEND_OVER', 'STAND_UP', 'PUNCH', 'FROWN'] },
      },
      required: ['posture'],
    },
  },

  // ── speech ───────────────────────────────────────────────────────
  // Public say is the default channel — Claude doesn't need a tool
  // for it; just emit text and the orchestrator speaks it. Whisper
  // (ESP) IS a tool because it's a deliberate channel choice.
  {
    name: 'whisper',
    description: 'Send a private ESP message to a specific avatar. Only use when you have something genuinely private to say to one person.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to whisper. Keep it short (1-2 sentences).' },
      },
      required: ['text'],
    },
  },

  // ── object manipulation ──────────────────────────────────────────
  {
    name: 'pick_up',
    description: 'Pick up a small portable item currently on the ground in the room. The item moves into your pocket.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The Habitat object ref shown in the scene description.' },
        noid: { type: 'integer', description: 'The noid shown alongside the ref.' },
      },
      required: ['ref', 'noid'],
    },
  },
  {
    name: 'put_down',
    description: 'Place an item from your pocket onto the floor (or into an open container). Use container_noid=0 for the floor.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the item in your pocket.' },
        container_noid: { type: 'integer', description: '0 to drop on the floor; otherwise the noid of an open container.' },
        x: { type: 'integer', description: 'Target X (0-255). Ignored when dropping into a container.' },
        y: { type: 'integer', description: 'Target Y. Ignored for containers.' },
        orientation: { type: 'integer', description: 'Item orientation byte. 0 is fine for most cases.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'give_to_avatar',
    description: 'Hand an item from your pocket to another avatar.',
    input_schema: {
      type: 'object',
      properties: {
        item_noid: { type: 'integer', description: 'Noid of the item in your pocket.' },
        recipient_noid: { type: 'integer', description: 'Noid of the recipient avatar.' },
      },
      required: ['item_noid', 'recipient_noid'],
    },
  },
  {
    name: 'touch_avatar',
    description: 'Reach out and touch another avatar. A friendly contact gesture.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer', description: 'Noid of the target avatar.' },
      },
      required: ['noid'],
    },
  },

  // ── containers / doors ───────────────────────────────────────────
  {
    name: 'open',
    description: 'Open a door, box, bag, chest, or other openable container in the room.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'close',
    description: 'Close a door, box, bag, chest, or other openable container.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
      },
      required: ['ref'],
    },
  },

  // ── avatar state ─────────────────────────────────────────────────
  {
    name: 'sit_down',
    description: 'Sit on a chair, couch, bench, bed, or hot tub in the room.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer' },
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
    name: 'discorporate',
    description: 'Turn into a Ghost — invisible to most interactions. Use when you want to observe quietly without participating.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── memory ───────────────────────────────────────────────────────
  {
    name: 'recall',
    description: 'Search your long-term memory for past conversations or notes. Use when someone references something you should remember but the immediate context does not have it.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search across past conversations and notes.' },
        avatar: { type: 'string', description: 'Optional: limit to one specific person.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember',
    description: 'Save a durable note about someone or something. Use sparingly — for facts that matter beyond the current conversation (someone\'s job, a promise made, a recurring topic). Do NOT use for routine chit-chat.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Who or what the note is about (an avatar name, an object name, a region name).' },
        fact: { type: 'string', description: 'The fact to remember, in your own words.' },
      },
      required: ['subject', 'fact'],
    },
  },
  {
    name: 'list_inventory',
    description: 'Look in your own pockets and list what you are currently carrying. Use this before claiming you have or don\'t have an item.',
    input_schema: { type: 'object', properties: {} },
  },
]

// HabiBot helpers / raw ops can hang if elko is slow or the message is
// dropped; wrap each await in a per-tool timeout so a stuck tool can't
// pin sage's event loop forever. Returns null on timeout/failure — the
// calling layer turns that into a tool_result for Claude's next turn.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// PUT op (put_down). HabiBot has bot.putObj(objRef, containerNoid, x, y, orientation),
// but wrap it here for symmetry with the others and to give a clear log line.
function putDown(bot, ref, containerNoid, x, y, orientation) {
  return bot.putObj(ref, containerNoid || 0, x || 80, y || 144, orientation || 0)
}

// GET op (pick_up). Same rationale as putDown — habibot.js doesn't ship
// a getObj helper, so we send the raw op.
function getObj(bot, ref, containerNoid) {
  return bot.send({ op: 'GET', to: ref, containerNoid: containerNoid || 0 })
}

// ESP whisper. HabiBot has bot.ESPsay(text) that targets the most-recent
// ESP correspondent — but for an LLM-driven bot we want explicit
// targeting. We don't yet have a per-recipient whisper helper, so reuse
// ESPsay's mechanism (the bridge resolves ESP by recent context).
function whisperTo(bot, text) {
  return bot.ESPsay(text)
}

// executeAction: run the tool the model asked for and return a JSON-able
// result for the next turn. The result shape mirrors what's useful to
// Claude — { ok: true } for void ops, an items array for list_inventory,
// recall hits for recall, etc. A throw becomes { ok: false, error: ... }
// so Claude can see why a tool failed and adapt instead of plowing ahead.
async function executeAction(toolUse, bot, ctx) {
  const { name, input } = toolUse
  const args = input || {}
  const mem = ctx && ctx.mem
  const botName = (bot.config && bot.config.username) || 'SageBot'
  log.info('Tool: %s(%s)', name, JSON.stringify(args))
  try {
    switch (name) {
      // ── movement ────────────────────────────────────────────────
      case 'walk_to_exit':
        await withTimeout(bot.walkToExit(args.direction), 30_000, 'walkToExit')
        return { ok: true }
      case 'walk_to_avatar': {
        const target = findAvatarByName(bot, args.name)
        if (!target) return { ok: false, error: `no avatar named ${args.name} present` }
        await withTimeout(bot.walkToAvatar(target), 15_000, 'walkToAvatar')
        return { ok: true }
      }
      case 'walk_to_coords':
        await withTimeout(bot.walkTo(args.x, args.y, args.facing || 0), 15_000, 'walkTo')
        return { ok: true }
      case 'face_direction':
        await withTimeout(bot.faceDirection(args.direction), 5_000, 'faceDirection')
        return { ok: true }
      case 'wait':
        await bot.wait(Math.min(5, Math.max(0.5, args.seconds || 1)) * 1000)
        return { ok: true }

      // ── posture ─────────────────────────────────────────────────
      case 'do_posture':
        await withTimeout(bot.doPosture(args.posture), 5_000, 'doPosture')
        return { ok: true }

      // ── speech ──────────────────────────────────────────────────
      case 'whisper':
        await whisperTo(bot, args.text || '')
        return { ok: true }

      // ── object manipulation ─────────────────────────────────────
      case 'pick_up':
        await withTimeout(getObj(bot, args.ref, args.noid), 10_000, 'pick_up')
        return { ok: true }
      case 'put_down':
        await withTimeout(putDown(bot, args.ref, args.container_noid, args.x, args.y, args.orientation), 10_000, 'put_down')
        return { ok: true }
      case 'give_to_avatar':
        await withTimeout(bot.giveObject(args.item_noid, args.recipient_noid), 10_000, 'give_to_avatar')
        return { ok: true }
      case 'touch_avatar':
        await withTimeout(bot.touchAvatar(args.noid), 10_000, 'touch_avatar')
        return { ok: true }

      // ── containers ──────────────────────────────────────────────
      case 'open':
        await withTimeout(bot.openDoor(args.ref), 10_000, 'open')
        return { ok: true }
      case 'close':
        await withTimeout(bot.closeDoor(args.ref), 10_000, 'close')
        return { ok: true }

      // ── avatar state ────────────────────────────────────────────
      case 'sit_down':
        await withTimeout(bot.sitOrstand(1, args.noid), 10_000, 'sit_down')
        return { ok: true }
      case 'stand_up':
        await withTimeout(bot.sitOrstand(0, 0), 10_000, 'stand_up')
        return { ok: true }
      case 'discorporate':
        await withTimeout(bot.discorporate(), 10_000, 'discorporate')
        return { ok: true }

      // ── memory ──────────────────────────────────────────────────
      case 'recall': {
        if (!mem) return { ok: false, error: 'memory not configured' }
        const hits = await mem.recall({ bot: botName, query: args.query, avatar: args.avatar, limit: 5 })
        // Trim each row to fields Claude will actually use — full mongo
        // _ids and ts objects are noise.
        return {
          ok: true,
          conversations: (hits.conversations || []).map((r) => ({
            avatar: r.avatar, direction: r.direction, text: r.text, ts: r.ts,
          })),
          notes: (hits.notes || []).map((r) => ({
            subject: r.subject, fact: r.fact, ts: r.ts,
          })),
        }
      }
      case 'remember': {
        if (!mem) return { ok: false, error: 'memory not configured' }
        await mem.remember({ bot: botName, subject: args.subject, fact: args.fact })
        return { ok: true }
      }
      case 'list_inventory':
        return { ok: true, items: awareness.getInventory(bot) }

      default:
        log.warn('Unknown tool: %s', name)
        return { ok: false, error: `unknown tool ${name}` }
    }
  } catch (e) {
    log.warn('Tool %s failed: %s', name, e.message)
    return { ok: false, error: e.message }
  }
}

// Resolve an avatar by name (case-insensitive). HabiBot keeps avatars
// in `bot.avatars` keyed by name, but tools accept whatever case Claude
// produced — typically matching the scene description, but humans (and
// LLMs) get casing wrong sometimes.
function findAvatarByName(bot, name) {
  if (!name) return null
  const want = name.toLowerCase()
  for (const k in bot.avatars) {
    if (k.toLowerCase() === want) return bot.avatars[k]
  }
  return null
}

module.exports = { TOOLS, executeAction }
