#!/usr/bin/env node
/* jshint esversion: 8 */

'use strict'

// textclient — a human, text-only client for NeoHabitat.
//
// It is a HabiBot (habibots/habibot.js) driven by a person at a terminal
// instead of by a bot loop or an LLM. HabiBot already owns the socket
// connection, reconnect/region-transit logic, the habiworld world model
// (bot.world), and the full verb-helper set; this client only CONSUMES
// that public API:
//   - inbound world events  → narrated to stdout (lib/render.js)
//   - typed command lines    → dispatched to HabiBot (lib/commands.js)
//
// We never modify the habibots or habiworld libraries from here (see the
// "textclient: no habibots changes" rule) — if something is missing, we
// surface it rather than patch shared code that habibots/sagebot depend on.
//
// Launch:
//   node index.js -c <context> -u <username> [-h host] [-p port] [--loglevel lvl]
// Defaults: host 127.0.0.1, port 2026 (the dev bridge_v2), loglevel warn.

const readline = require('readline')

const HabiBot = require('../habibots/habibot')
const { makeRenderer } = require('./lib/render')
const commands = require('./lib/commands')

// ── arg parsing (zero-dep; mirrors the -h/-p/-c/-u flags the bots use) ──
function parseArgs(argv) {
  const out = { host: '127.0.0.1', port: 2026, loglevel: 'warn' }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '-h': case '--host': out.host = next(); break
      case '-p': case '--port': out.port = Number(next()); break
      case '-c': case '--context': out.context = next(); break
      case '-u': case '--username': out.username = next(); break
      case '--loglevel': out.loglevel = next(); break
      case '--help': case '-?': out.help = true; break
      default: console.error(`unknown argument: ${a}`); out.help = true
    }
  }
  return out
}

function usage() {
  console.log([
    'NeoHabitat text client',
    '',
    'Usage: node index.js -c <context> -u <username> [options]',
    '  -c, --context   region context to enter (required), e.g. context-Downtown_5f',
    '  -u, --username  avatar username (required)',
    '  -h, --host      server/bridge host (default 127.0.0.1)',
    '  -p, --port      server/bridge port (default 2026)',
    '      --loglevel  HabiBot log level: error|warn|info|debug (default warn)',
    '',
    'Once connected, type HELP for the in-world command list.',
  ].join('\n'))
}

const argv = parseArgs(process.argv)
if (argv.help || !argv.context || !argv.username) {
  usage()
  process.exit(argv.help ? 0 : 1)
}

// Quiet (or tune) HabiBot's own winston output so it doesn't drown the
// narration. We configure the SAME winston instance habibot.js requires
// (resolved from the habibots tree); this also silences winston's
// "no transports" warning. Best-effort — if the path ever changes the
// client still runs, just noisier.
try {
  const habiLog = require('../habibots/node_modules/winston')
  habiLog.configure({
    level: argv.loglevel,
    transports: [new habiLog.transports.Console({
      format: habiLog.format.combine(habiLog.format.timestamp(), habiLog.format.splat(), habiLog.format.simple()),
    })],
  })
} catch (e) {
  // ignore — habibot will use its default winston config
}

// ── readline UI ────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })

// Print a narration / system line without clobbering whatever the user is
// mid-typing: clear the current input line, print, then redraw the prompt
// with the buffered input intact (rl.prompt(true) preserves the line).
function print(line) {
  if (line === undefined || line === null) return
  readline.cursorTo(process.stdout, 0)
  readline.clearLine(process.stdout, 0)
  process.stdout.write(String(line) + '\n')
  rl.prompt(true)
}

// ── the bot ──────────────────────────────────────────────────────────
const bot = HabiBot.newWithConfig(argv.host, argv.port, argv.username)
const renderer = makeRenderer(print)

bot.on('connected', (b) => {
  print(`Connected to ${argv.host}:${argv.port}. Entering ${argv.context}...`)
  b.gotoContext(argv.context)
})

bot.on('disconnected', () => {
  print('* Disconnected from server. (will retry)')
})

// Narrate every inbound message (verbose). Fires after world.apply, so
// noids resolve to current names/positions.
bot.on('msg', (b, o) => {
  try { renderer.op(b, o) } catch (e) { print(`  [render error: ${e.message}]`) }
})

// Departures: the habiworld 'removed' event hands us the record before it
// is gone (the raw delete op can't be resolved to a name after the fact).
bot.world.on('removed', (record) => {
  try { renderer.departed(bot, record) } catch (e) { /* non-fatal */ }
})

// On region entry, become corporeal then show the room. ensureCorporated
// waits ~10s for imagery on a fresh corporate; that's fine for a human.
let arrivedOnce = false
bot.on('enteredRegion', (b) => {
  b.ensureCorporated()
    .then(() => {
      print(commands.describeScene(b))
      if (!arrivedOnce) {
        arrivedOnce = true
        print("Type HELP for commands. Just type a line to say it out loud.")
      }
    })
    .catch((e) => print(`  (could not embody: ${e}); type LOOK to inspect the room`))
})

// ── input loop ─────────────────────────────────────────────────────────
rl.on('line', async (line) => {
  await commands.run(bot, line, { print })
  rl.prompt()
})

rl.on('close', () => {
  print('\nBye.')
  process.exit(0)
})

print('Connecting...')
bot.connect()
rl.prompt()
