/* jshint esversion: 8 */

'use strict'

// oracle.js — carries Oracle answers from Discord into Habitat mail.
//
// The loop this closes:
//   1. An avatar ASKs a fountain / crystal ball / bureaucrat, or WISHes on
//      a magic lamp. bridge_v2's relay (bridge/oracle.go) posts it to
//      Discord's #oracle-requests as an embed whose footer names the
//      asker: "user-randy · Randy".
//   2. An Oracle right-clicks that message -> Apps -> "Answer as the Oracle".
//   3. A modal opens; they write the answer.
//   4. This bot mails it to the asker, as the Oracle avatar.
//
// Mail rather than speech because by the time a human reads the channel
// the asker has almost certainly logged out, and mail is the one in-world
// mechanism that survives that: Paper.sendMailToUser queues to mongo when
// the recipient is offline, and Avatar.check_mail drains it on their next
// region entry with "* You have MAIL in your pocket. *".
//
// Why a context-menu command rather than watching for replies: the
// interaction payload resolves the target message for us, so the footer is
// readable with NO Message Content intent — this bot never sees the text
// of a message nobody pointed it at. Application commands also arrive over
// the gateway, so there is no HTTPS interactions endpoint to expose.
//
// Required env:
//   DISCORD_BOT_TOKEN          the Oracle bot's token
//   DISCORD_ORACLE_GUILD_ID    server to register the command in (guild-scoped
//                              registration is instant; global takes ~an hour)
//   DISCORD_ORACLE_CHANNEL_ID  only messages in this channel may be answered
// Optional env:
//   DISCORD_ORACLE_ROLE_ID     if set, only members holding it may answer
//   HABIBOTS_MONGO_URL         outbox storage (default mongodb://neohabitatmongo:27017)
//
// Discord permissions needed: View Channel, Send Messages (for the
// "answered by" marker) and Read Message History in #oracle-requests.
// No privileged intents.
//
// The in-world Oracle is deliberately unreachable. It is a normal
// corporeal avatar — a ghost cannot mail, because HabitatMod
// objectIsComplete skips Region.addToNoids for a ghost's contents, so a
// ghost's pocket Paper never exists to pick up. Instead it carries the
// HIDDEN_AVATAR nitty_bit, which keeps it out of Region.NameToUser and
// so out of the F3 list, /online counts, ESP, /join, /invite and
// /teleport; and it lives in context-oraclehome, a region with no exits
// that nothing else links to. Players reach the Oracle only by asking an
// oracular object, and it answers only through this bot.

const log = require('winston')
log.configure({
  transports: [new log.transports.Console({
    format: log.format.combine(log.format.timestamp(), log.format.splat(), log.format.simple())
  })]
})

const HabiBot = require('../habibot')
const mail = require('../lib/mail')
const awareness = require('../lib/sage/awareness')
const { OracleOutbox } = require('../lib/oracle-outbox')
const { askerFromMessage } = require('../lib/oracle-footer')

const Defaults = {
  host: '127.0.0.1',
  port: 1337,
  loglevel: 'info',
  reconnect: true,
}

const { hideBin } = require('yargs/helpers')
const Argv = require('yargs/yargs')(hideBin(process.argv))
  .usage('Usage: $0 [options]')
  .help('help')
  .option('host',      { alias: 'h', default: Defaults.host })
  .option('port',      { alias: 'p', default: Defaults.port })
  .option('loglevel',  { default: Defaults.loglevel })
  .option('context',   { alias: 'c', describe: 'Context to enter on connect.', demandOption: true })
  .option('username',  { alias: 'u', describe: 'Avatar username.', demandOption: true })
  .option('reconnect', { alias: 'r', default: Defaults.reconnect })
  .argv

log.level = Argv.loglevel

const TOKEN = process.env.DISCORD_BOT_TOKEN
const GUILD_ID = process.env.DISCORD_ORACLE_GUILD_ID
const CHANNEL_ID = process.env.DISCORD_ORACLE_CHANNEL_ID
const ROLE_ID = process.env.DISCORD_ORACLE_ROLE_ID || null

if (!TOKEN || !GUILD_ID || !CHANNEL_ID) {
  // Exit 0 (success) so supervisor doesn't read a missing secret as a
  // crash and put us in a restart loop. The bots container starts before
  // the deploy has necessarily written /etc/neohabitat/bots.env; the
  // oracle simply sits out that cycle, exactly as sage does.
  log.info('oracle: DISCORD_BOT_TOKEN / GUILD_ID / CHANNEL_ID not all set; not starting.')
  process.exit(0)
}

// Required after the env check so an unconfigured deploy never depends on
// the module being installed (the same reason the old Slack build loaded
// its client lazily).
const {
  Client, Events, GatewayIntentBits, MessageFlags, ApplicationCommandType,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js')

const ANSWER_COMMAND = 'Answer as the Oracle'
const MODAL_PREFIX = 'oracle_reply:'
const ANSWER_FIELD = 'answer'
const NO_PINGS = { parse: [] }

// The relay in bridge/oracle.go keys an icon off the object spoken to —
// a fountain, a crystal ball, a genie. A letter has no object, so it gets
// its own, in the same slot.
const LETTER_ICON = '✉️'
const LETTER_TEXT_MAX = 300 // matches oracleTextMax on the bridge side

// How often to look for mail addressed to the Oracle. See pollForMail for why
// this has to be a poll rather than an event.
const MAIL_POLL_SECONDS = parseInt(process.env.HABIBOTS_ORACLE_MAIL_POLL_SECONDS || '120', 10)
// Worst-case latency before a letter to the Oracle is noticed.
// Each region entry hands over exactly one letter, so a backlog needs a pass
// each; bounded so one tick cannot run away.
const MAIL_DRAIN_PASSES = 5
// Region entry -> check_mail -> the letter appears in the slot, all asynchronous.
const MAIL_SETTLE_MS = 3000
// How many consecutive checks may find the SAME unreadable page in hand before
// it is set aside. elko loads a letter body asynchronously (Paper.retrieve-
// PaperContents), so one empty read proves nothing and patience is right. A page
// still unreadable minutes later has a text_path pointing at a document that no
// longer exists and will never read - waiting forever just keeps the bot deaf.
const UNREADABLE_STOW_AFTER = 3

const outbox = new OracleOutbox()

// ── Habitat side ───────────────────────────────────────────────────────

const OracleBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username)
let inWorld = false

OracleBot.on('connected', (bot) => {
  log.debug('OracleBot connected.')
  bot.gotoContext(Argv.context)
})

OracleBot.on('enteredRegion', (bot) => {
  bot.ensureCorporated()
    .then(() => {
      inWorld = true
      log.info('OracleBot is in-world; draining any queued answers.')
      return drainOutbox()
    })
    .catch((err) => log.error(`OracleBot could not corporate: ${err.message}`))
})

// Collecting mail addressed to the Oracle. Two facts shape this, both measured
// rather than assumed:
//
//   - Avatar.check_mail() — the only thing that moves a letter from the
//     mail-<name> queue into the pocket — runs ONLY in Region.noteUserArrival.
//     This bot enters its region once and then stands still, so without a nudge
//     it checks for mail exactly once, at startup, and letters sit in mongo.
//   - The game's own "* You have MAIL in your pocket. *" announcement did NOT
//     reliably reach us on that path in testing, so it is treated as a bonus
//     trigger below, never as the mechanism.
//
// So: peek at the queue (a read-only look at elko's own data), and only when
// something is actually waiting, re-enter the region to make elko hand it over.
// Re-entering on a bare timer instead would churn context entries for nothing
// and can trip the region's capacity limit — elko answers a full context with
// {"op":"exit","why":"full"}, which would lock the Oracle out of its own house.
let checking = false
let lastLetterText = null
// Blocked-hands bookkeeping: which page is stuck, for how many checks running,
// and which ones we have already reported to Discord (once each, not per tick).
let stuckRef = null
let stuckStrikes = 0
const stowedReported = new Set()

// Full hands are the bot's most dangerous state: Paper.GET is gated on
// empty_handed(avatar), so a single stranded page disables mail in BOTH
// directions, and every failure downstream of it presents as "the letter read
// back empty" rather than as "the hands are full". Recovery ladder, in order of
// preference: deliver it (clearHands hands a readable letter back), discard it
// if it is only our own blank draft, and failing both, set it aside intact in a
// pocket. Destroying an unread page is never on the ladder.
//
// Returns true if the hands are now free and the caller should carry on.
async function freeTheHands(hands) {
  const ref = hands.ref || null
  if (ref === stuckRef) stuckStrikes++
  else {
    stuckRef = ref
    stuckStrikes = 1
  }
  // Give an unreadable page a few checks to become readable before giving up on
  // it - a body still loading is indistinguishable from a body that is gone.
  if (hands.unreadable && stuckStrikes < UNREADABLE_STOW_AFTER) {
    log.warn(`hands blocked: ${hands.error} (attempt ${stuckStrikes}/${UNREADABLE_STOW_AFTER})`)
    return false
  }
  log.error(`hands blocked: ${hands.error}; setting it aside so mail can flow again`)
  const stowed = await serialize(() => mail.stowHeldItem(OracleBot))
  if (!stowed.ok) {
    log.error(`could not free the hands: ${stowed.error}`)
    return false
  }
  stuckRef = null
  stuckStrikes = 0
  // Our own PUT is announced with send_neighbor_msg, which EXCLUDES the actor —
  // the same blindness that stops us seeing our own GET. So elko has moved the
  // page into a pocket while our world model still shows it in HANDS, and
  // without a refresh the next check finds the "same" blocked hands and sets it
  // aside again, forever, never reaching the mail. Re-entering the region
  // rebuilds contents from elko's own makes; it is the same nudge used below to
  // make check_mail run.
  await OracleBot.gotoContext(Argv.context)
  await new Promise((r) => setTimeout(r, MAIL_SETTLE_MS))
  if (stowed.stowed && stowed.ref && !stowedReported.has(stowed.ref)) {
    stowedReported.add(stowed.ref)
    await noteStowed(stowed).catch((err) =>
      log.error(`could not report the set-aside page: ${err.message}`))
  }
  return true
}

// Say so in the channel. A page nobody can read is a real loss - somebody may
// have mailed the Oracle and got no answer - and the alternative is that it
// happens silently, which is how this went unnoticed for sixteen hours.
async function noteStowed(stowed) {
  const channel = await discord.channels.fetch(CHANNEL_ID)
  await channel.send({
    embeds: [{
      description: `⚠️ The Oracle was holding a ${stowed.type} it could not read, which blocks all mail. ` +
        `It has been set aside intact in pocket slot ${stowed.slot} — nothing was destroyed — and mail is flowing again.`,
    }],
    allowedMentions: NO_PINGS,
  })
  log.info(`reported a set-aside ${stowed.type} to Discord`)
}

async function checkForMail() {
  if (!inWorld || checking) return
  checking = true
  try {
    for (let pass = 0; pass < MAIL_DRAIN_PASSES; pass++) {
      // A letter can be stranded in hand by an interrupted collection, which
      // blocks every pick-up until it is dealt with. Deliver it, then let go.
      const hands = await serialize(() => mail.clearHands(OracleBot))
      if (hands.ok) {
        stuckRef = null
        stuckStrikes = 0
      }
      if (hands.recovered) {
        if (hands.recovered.text !== lastLetterText) {
          lastLetterText = hands.recovered.text
          log.info(`delivering a letter from ${hands.recovered.sender} that was stuck in hand`)
          await relayLetter(hands.recovered).catch((err) =>
            log.error(`could not relay a recovered letter: ${err.message}`))
        }
        await serialize(() => mail.discardHeldPaper(OracleBot, hands.ref))
        stuckRef = null
        stuckStrikes = 0
        continue
      }
      // Anything else in the hands blocks every Paper.GET, so the bot can
      // neither collect mail nor compose a reply. Never leave it there.
      if (!hands.ok) {
        if (!await freeTheHands(hands)) return
        continue
      }

      const slotLetter = awareness.getInventory(OracleBot).some((it) =>
        it.type === 'Paper' && it.slot === awareness.MAIL_SLOT &&
        (it.grState || 0) === awareness.PAPER_LETTER_STATE)
      const waiting = slotLetter ? 0 : await outbox.queuedMailFor(Argv.username)
      if (!slotLetter && !waiting) return
      if (!slotLetter) {
        log.info(`${waiting} letter(s) waiting; re-entering ${Argv.context} to collect`)
        await OracleBot.gotoContext(Argv.context)
        await new Promise((r) => setTimeout(r, MAIL_SETTLE_MS))
      }
      const drained = await serialize(() => mail.drainMailSlot(OracleBot))
      if (!drained || !drained.drained) return
      // The world model can still show the old letter for a moment after the
      // slot is cleared, and draining again would post the same letter to
      // Discord twice. The page text is the only identity available here —
      // text_path is server-side and never reaches the client — so an
      // identical page back-to-back ends the sweep.
      if (drained.text && drained.text === lastLetterText) {
        log.debug('same letter read twice; the mail slot has not caught up yet')
        return
      }
      lastLetterText = drained.text || null
      log.info(`picked up a letter from ${drained.sender || 'an unknown sender'}`)
      await relayLetter(drained).catch((err) =>
        log.error(`could not relay a letter to Discord: ${err.message}`))
      await new Promise((r) => setTimeout(r, MAIL_SETTLE_MS))
    }
  } catch (err) {
    log.error(`mail check failed: ${err.message}`)
  } finally {
    checking = false
  }
}

// Free extra trigger when the game does announce (habibot promotes the balloon
// into this event). Never depended upon — see above.
OracleBot.on('mailArrived', () => {
  checkForMail().catch((err) => log.error(`mail check: ${err.message}`))
})

OracleBot.on('disconnected', () => {
  inWorld = false
  log.warn('OracleBot disconnected; answers will queue until it is back.')
})

// Mailing is a multi-step avatar action (pick up a Paper, WRITE it,
// PSENDMAIL it). Two of those interleaved would write one answer onto the
// other's sheet, so every delivery goes through this one chain.
let deliveryChain = Promise.resolve()
function serialize(work) {
  const next = deliveryChain.then(work, work)
  deliveryChain = next.catch(() => {})
  return next
}

function deliver(entry) {
  return serialize(async () => {
    if (!inWorld) return { ok: false, error: 'the Oracle is not in-world yet' }
    const res = await mail.composeAndSendMail(OracleBot, {
      recipient: entry.recipient,
      body: entry.body,
      // Players can mail "to: oracle". Those letters land in our MAIL_SLOT
      // via check_mail and, once the spare pocket sheet is spent, would
      // leave us with no blank paper and no way to answer anyone. Read
      // them and reuse the sheet.
      drainMail: true,
    })
    for (const letter of res.readLetters || []) {
      relayLetter(letter).catch((err) =>
        log.error(`could not relay a letter to Discord: ${err.message}`))
    }
    if (res.ok) {
      await outbox.markSent(entry._id)
      log.info(`delivered oracle answer ${entry._id} to ${entry.recipient}`)
    } else {
      await outbox.noteFailure(entry._id, res.error)
      log.warn(`could not deliver oracle answer ${entry._id}: ${res.error}`)
    }
    return res
  })
}

async function drainOutbox() {
  let pending
  try {
    pending = await outbox.pending()
  } catch (err) {
    log.error(`could not read the oracle outbox: ${err.message}`)
    return
  }
  for (const entry of pending) {
    const res = await deliver(entry)
    // Stop on the first failure: they are almost always "not in-world" or
    // "no blank paper", and both apply equally to everything behind it.
    if (!res.ok) break
  }
}

// ── Discord side ───────────────────────────────────────────────────────

// Letters addressed "to: oracle" arrive as in-world mail, not as an ASK,
// so the bridge never sees them. Post them into the same channel in the
// same shape — including the footer — so an Oracle answers a letter with
// exactly the command they use on a fountain request.
async function relayLetter(letter) {
  const sender = letter.sender
  let body = String(letter.body || '').trim()
  if (!body) return
  if (body.length > LETTER_TEXT_MAX) body = body.slice(0, LETTER_TEXT_MAX) + '…'
  const channel = await discord.channels.fetch(CHANNEL_ID)
  const embed = sender
    ? {
      description: `${LETTER_ICON} **${sender}** mails the Oracle: “${body}”`,
      // Same "<user ref> · <display name>" contract as formatOracleFooter.
      // The ref is reconstructed the way ensureUserCreated builds it.
      footer: { text: `user-${sender.toLowerCase().replace(/ /g, '_')} · ${sender}` },
    }
    // No postmark means no way to address a reply, so it goes up without a
    // footer — the answer command will refuse it rather than mail nowhere.
    : { description: `${LETTER_ICON} A letter reached the Oracle: “${body}”` }
  await channel.send({ embeds: [embed], allowedMentions: NO_PINGS })
  log.info(`relayed a letter from ${sender || 'an unknown sender'} to Discord`)
}

function mayAnswer(interaction) {
  if (!ROLE_ID) return true
  const roles = interaction.member && interaction.member.roles
  if (!roles) return false
  return typeof roles.cache?.has === 'function' ? roles.cache.has(ROLE_ID) : (roles || []).includes(ROLE_ID)
}

function ephemeral(interaction, content) {
  const payload = { content: content, flags: MessageFlags.Ephemeral }
  return interaction.deferred || interaction.replied
    ? interaction.editReply({ content: content })
    : interaction.reply(payload)
}

const discord = new Client({ intents: [GatewayIntentBits.Guilds] })

discord.once(Events.ClientReady, async (c) => {
  log.info(`oracle Discord client ready as ${c.user.tag}`)
  try {
    await c.application.commands.set(
      [{ name: ANSWER_COMMAND, type: ApplicationCommandType.Message }], GUILD_ID)
    log.info(`registered "${ANSWER_COMMAND}" in guild ${GUILD_ID}`)
  } catch (err) {
    log.error(`could not register the answer command: ${err.message}`)
  }
})

discord.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isMessageContextMenuCommand() && interaction.commandName === ANSWER_COMMAND) {
      return await onAnswerCommand(interaction)
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_PREFIX)) {
      return await onAnswerSubmitted(interaction)
    }
  } catch (err) {
    log.error(`interaction failed: ${err.stack || err.message}`)
    try { await ephemeral(interaction, `Something went wrong: ${err.message}`) } catch (_) { /* the interaction may already be dead */ }
  }
})

async function onAnswerCommand(interaction) {
  if (interaction.channelId !== CHANNEL_ID) {
    return ephemeral(interaction, 'Oracle answers can only be sent from the oracle-requests channel.')
  }
  if (!mayAnswer(interaction)) {
    return ephemeral(interaction, 'You do not hold the Oracle role.')
  }
  const asker = askerFromMessage(interaction.targetMessage)
  if (!asker) {
    return ephemeral(interaction, 'That is not an oracle request — no asker recorded on it.')
  }
  const modal = new ModalBuilder()
    .setCustomId(MODAL_PREFIX + interaction.targetMessage.id)
    .setTitle(`Answer ${asker.name}`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(ANSWER_FIELD)
        .setLabel('Your answer (arrives as Habitat mail)')
        .setStyle(TextInputStyle.Paragraph)
        // A page is 40x16 and the first row becomes the postmark, so
        // anything past this cannot be shown; cap it here rather than
        // silently clipping after they hit send.
        .setMaxLength(mail.MAIL_BODY_MAX)
        .setRequired(true)))
  return interaction.showModal(modal)
}

async function onAnswerSubmitted(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const targetId = interaction.customId.slice(MODAL_PREFIX.length)
  const body = interaction.fields.getTextInputValue(ANSWER_FIELD)

  // Re-fetch rather than trusting the id alone: it re-checks the channel
  // and footer at send time, and the marker below needs the message.
  const channel = await discord.channels.fetch(CHANNEL_ID)
  const target = await channel.messages.fetch(targetId)
  const asker = askerFromMessage(target)
  if (!asker) return ephemeral(interaction, 'That request no longer names an asker.')

  if (!mayAnswer(interaction)) {
    // Re-checked here as well as before the modal: a role can be revoked
    // in between, and this is the call that actually writes to a player.
    return ephemeral(interaction, 'You do not hold the Oracle role.')
  }

  // Claim the request before writing anything. Anything other than a fresh
  // insert means another Oracle already answered it — including one still
  // sitting in the queue undelivered, which would otherwise become a
  // second letter for the same question.
  const status = await outbox.enqueue({
    id: targetId,
    recipient: asker.name.toLowerCase(),
    body: body,
    askedBy: asker.userRef,
    answeredBy: interaction.user.id,
  })
  if (status !== 'inserted') {
    return ephemeral(interaction, status === 'sent'
      ? `${asker.name} has already been answered.`
      : `${asker.name} already has an answer waiting to be delivered.`)
  }

  const res = await deliver({ _id: targetId, recipient: asker.name.toLowerCase(), body: body })
  if (!res.ok) {
    // Written down before Discord was told anything, so it goes out on
    // the next drain — the operator does not have to retype it.
    return ephemeral(interaction,
      `Queued for ${asker.name} — not delivered yet (${res.error}). It will be mailed when the Oracle is back in-world.`)
  }
  await ephemeral(interaction,
    `Mailed to ${asker.name}.${res.truncated ? ' (Trimmed to fit one page.)' : ''}`)
  try {
    await target.reply({
      content: `:envelope: answered by <@${interaction.user.id}>`,
      allowedMentions: NO_PINGS,
    })
  } catch (err) {
    log.warn(`could not mark ${targetId} answered: ${err.message}`)
  }
}

setInterval(() => { checkForMail().catch((err) => log.error(`mail check: ${err.message}`)) },
  MAIL_POLL_SECONDS * 1000)

OracleBot.connect()
discord.login(TOKEN).catch((err) => {
  log.error(`oracle could not log in to Discord: ${err.message}`)
  process.exit(1)
})
