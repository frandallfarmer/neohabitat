#!/usr/bin/env node
/**
 * discord-webhook-capture.js — a stand-in for a Discord webhook, so the
 * bridge's alert and oracle-relay output can be seen on a dev box without
 * touching a real server.
 *
 * bridge_v2/DISCORD_ALERTS.md says to point DISCORD_WEBHOOK_* at "a local
 * capture server" and never post test traffic to the public channels.
 * This is that server.
 *
 *   node tools/discord-webhook-capture.js            # listens on :9099
 *   node tools/discord-webhook-capture.js --port=... # somewhere else
 *
 * Then, in the repo-local .env the dev bridge reads:
 *   DISCORD_WEBHOOK_ORACLE_REQUESTS=http://host.docker.internal:9099/oracle
 *   DISCORD_WEBHOOK_LOGINS=http://host.docker.internal:9099/logins
 * and restart the bridge:  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d bridge_v2
 *
 * Prints each post the way it matters for the oracle work: the prose, and
 * the embed footer that carries the routing key the answering bot reads
 * back (see formatOracleFooter in bridge_v2/bridge/oracle.go).
 *
 * Answers 204 like Discord does. --fail=CODE returns that status instead,
 * to exercise the notifier's retry path.
 */

'use strict'

const http = require('http')

const opts = { port: 9099, fail: 0 }
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.replace(/^--/, '').split('=')
  if (key === 'port' && value) opts.port = parseInt(value, 10)
  else if (key === 'fail' && value) opts.fail = parseInt(value, 10)
  else if (key === 'help' || key === 'h') {
    console.log('usage: discord-webhook-capture.js [--port=9099] [--fail=STATUS]')
    process.exit(0)
  } else { console.error(`Unrecognised argument: ${arg}`); process.exit(1) }
}

let seq = 0

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    seq += 1
    const when = new Date().toISOString().slice(11, 19)
    console.log(`\n[${when}] #${seq}  ${req.method} ${req.url}`)
    let payload
    try { payload = JSON.parse(body) } catch (err) {
      console.log('  (unparseable body) ' + body.slice(0, 400))
      res.writeHead(204).end()
      return
    }
    if (payload.content) console.log('  content: ' + payload.content)
    for (const embed of payload.embeds || []) {
      if (embed.description) console.log('  embed:   ' + embed.description)
      // The contract the answering bot depends on: "<user ref> · <name>",
      // name last because it is the free-form field. Reported for every
      // embed, since a missing footer is just as unanswerable as a malformed
      // one and is the likelier mistake.
      const footer = (embed.footer && embed.footer.text) || ''
      if (footer) console.log('  footer:  ' + footer)
      const parts = footer.split(' · ')
      if (footer && parts.length >= 2 && parts[0].startsWith('user-')) {
        console.log(`           -> ref=${parts[0]}  mails to "${parts.slice(1).join(' · ').toLowerCase()}"`)
      } else {
        console.log('           -> NOT answerable: no "user-<ref> · <name>" footer')
      }
    }
    // allowed_mentions must stay locked: avatar names are player input.
    const parse = payload.allowed_mentions && payload.allowed_mentions.parse
    if (!Array.isArray(parse) || parse.length !== 0) {
      console.log('  !! allowed_mentions is not locked: ' + JSON.stringify(payload.allowed_mentions))
    }
    if (opts.fail) {
      res.writeHead(opts.fail, { 'Retry-After': '1' }).end()
      console.log(`  (answered ${opts.fail} to exercise the retry path)`)
      return
    }
    res.writeHead(204).end()
  })
})

server.listen(opts.port, () => {
  console.log(`Discord webhook capture listening on http://0.0.0.0:${opts.port}`)
  console.log('From a container, reach it as http://host.docker.internal:' + opts.port + '/<channel>')
  if (opts.fail) console.log(`Answering every post with HTTP ${opts.fail}.`)
})
