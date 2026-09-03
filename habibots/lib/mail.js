/* jshint esversion: 8 */

'use strict'

// mail.js — compose and send in-world Habitat mail.
//
// Lives at lib/ rather than lib/sage/ because two bots need it: sage
// (via its compose_and_send_mail tool) and oracle (which mails an
// operator's Discord reply to the avatar who asked). It reaches into
// lib/sage/ for awareness + petscii, which are bot-agnostic despite
// where they sit.
//
// Habitat mail has no addressee field on the wire. The recipient is the
// literal first line of the page ("to: name"), which Paper.PSENDMAIL
// parses with ADDRESS_REGEX and then OVERWRITES with the postmark
// ("From: <sender>  Postmark: yy-MM-dd"). So the shape of the page IS
// the protocol, and the three landmines below are all shape problems.

const log = require('winston')
const awareness = require('./sage/awareness')
const { sanitizeForC64 } = require('./sage/petscii')

// A page is 40x16 (Document.MAX_LINE_WIDTH x LINES_PER_PAGE; see
// webclient/lib/text-view.js). Row 0 is spent on the "to:" line, which
// PSENDMAIL replaces with the postmark, so the body gets the other 15.
const MAIL_COLS = 40
const MAIL_ROWS = 16
const MAIL_BODY_ROWS = MAIL_ROWS - 1
const MAIL_BODY_MAX = MAIL_COLS * MAIL_BODY_ROWS // 600

// Paper.java:157 — WRITE treats a request_ascii of exactly 16 elements as
// "erase this sheet", the same sentinel an empty page sends. A 16-char
// page therefore blanks the Paper and mails nothing, silently. Since
// "to: oracle\n" is 11 chars, a five-character reply lands right on it.
// webclient/lib/text-view.js:81 fixes this by padding a space; do the same.
const CLEAR_SENTINEL_LENGTH = 16

// Any numbered pocket slot (0-3) works for disposal; Paper.PUT destroys a
// blank sheet wherever it lands.
const DISCARD_SLOT = 0

// The numbered pockets, in the order stowHeldItem will fill them. MAIL_SLOT (4)
// is excluded on purpose: it is the mailbox, and a second Paper parked there is
// its own bug (see db/patchOracleHome.js).
const POCKET_SLOTS = [0, 1, 2, 3]

// Paper.retrievePaperContents loads a letter body from mongo asynchronously, so
// the first read after the slot is repointed can legitimately come back empty.
const READ_ATTEMPTS = 4
const READ_RETRY_MS = 1200

// Mirrors bridge_v2's validAvatarName, lowercased: mail is addressed by
// DISPLAY NAME (Region.addUser keys NameToUser on name().toLowerCase()),
// and those legally contain spaces and apostrophes. Paper.findAddressee
// trims and lowercases whatever follows "to:", so both survive the page.
const RECIPIENT_REGEX = /^[a-z0-9][a-z0-9 ._'-]{0,31}$/

// Paper.addPostmark overwrites the "to:" line with
//   String.format("From: %-14s Postmark: %s ", from.name(), yy-MM-dd)
// so the sender's name is recoverable from the page itself — there is no
// sender field on a Paper. The name is padded to 14 and may contain
// spaces, hence the non-greedy match up to " Postmark:".
const POSTMARK_REGEX = /^From:\s+(.*?)\s+Postmark:\s*(\S+)\s*/

function parsePostmark(text) {
  const page = String(text || '')
  const m = POSTMARK_REGEX.exec(page)
  if (!m) return { sender: null, date: null, body: page.trim() }
  return { sender: m[1].trim(), date: m[2], body: page.slice(m[0].length).trim() }
}

// sanitizeForC64 is built for single-line speech: its final pass drops
// everything outside printable ASCII, and \n (0x0A) is outside it — so
// running a whole page through at once welds the lines together. Fold
// line by line instead, which keeps the author's paragraph breaks. Not
// fixed in petscii.js itself because sage's SPEAK and ESP paths want
// exactly the collapsing behavior it has today.
function sanitizeLines(text) {
  return String(text).split('\n').map((line) => sanitizeForC64(line) || '')
}

// Word-wrap to the page grid. The client wraps at 40 columns on its own,
// but only mid-word — wrapping here keeps breaks on word boundaries and
// lets us tell the caller when the text did not fit.
function wrapForPaper(text, cols = MAIL_COLS, rows = MAIL_BODY_ROWS) {
  const lines = []
  for (const paragraph of String(text).split('\n')) {
    if (paragraph === '') { lines.push(''); continue }
    let line = ''
    for (const word of paragraph.split(/ +/)) {
      // A single word longer than the column width has to be split.
      if (word.length > cols) {
        if (line) { lines.push(line); line = '' }
        for (let i = 0; i < word.length; i += cols) lines.push(word.slice(i, i + cols))
        line = lines.length && lines[lines.length - 1].length < cols ? lines.pop() : ''
        continue
      }
      if (!line) { line = word }
      else if (line.length + 1 + word.length <= cols) { line += ' ' + word }
      else { lines.push(line); line = word }
    }
    if (line) lines.push(line)
  }
  const truncated = lines.length > rows
  const kept = lines.slice(0, rows)
  if (truncated && kept.length) {
    // Mark the cut so the reader knows the letter was clipped.
    const last = kept[kept.length - 1]
    kept[kept.length - 1] = (last.length + 4 <= cols ? last : last.slice(0, cols - 4)).trimEnd() + ' ...'
  }
  return { lines: kept, truncated }
}

// Build the page a Paper should hold: "to: <recipient>" then the wrapped
// body. Kept separate from the send so it can be unit-tested and so a
// caller can preview exactly what the recipient will read.
function buildMailPage(recipient, body) {
  const { lines, truncated } = wrapForPaper(sanitizeLines(body).join('\n'))
  let text = `to: ${recipient}\n${lines.join('\n')}`
  if (text.length === CLEAR_SENTINEL_LENGTH) text += ' '
  return { text, truncated }
}

// Pick the Paper to write on, in the order that loses the least.
//   1. blank Paper already in HANDS — write + mail in place.
//   2. blank Paper in a numbered pocket slot — pick_up first.
//   3. blank Paper in MAIL_SLOT — pick_up; elko auto-spawns a fresh
//      blank Paper there (the Paper.GET special-case).
//   4. unread LETTER in MAIL_SLOT — refuse: picking it up dismisses
//      mail the bot has not read.
function chooseBlankPaper(bot) {
  const papers = awareness.getInventory(bot).filter((it) => it.type === 'Paper')
  if (!papers.length) return { error: 'you have no Paper in your pocket' }
  const isBlank = (p) => (p.grState || 0) === awareness.PAPER_BLANK_STATE
  const chosen =
    papers.find((p) => p.slot === awareness.HANDS_SLOT && isBlank(p)) ||
    papers.find((p) => p.slot !== awareness.MAIL_SLOT && p.slot !== awareness.HANDS_SLOT && isBlank(p)) ||
    papers.find((p) => p.slot === awareness.MAIL_SLOT && isBlank(p))
  if (!chosen) {
    return {
      error:
        'all pocket Paper is in LETTER state (unread mail). READ it first, then a blank ' +
        'paper will be available for composing.',
    }
  }
  return { paper: chosen }
}

// A letter sitting unread in MAIL_SLOT blocks composing: chooseBlankPaper
// refuses to consume it (dismissing unread mail is destructive), and it is
// usually the ONLY paper source left, because Paper.GET only auto-respawns
// a sheet for MAIL_SLOT — a numbered pocket slot is single-use. So one
// player typing "to: <bot>" can otherwise stop the bot mailing anyone ever
// again.
//
// Draining reads the letter out and blanks the sheet, which both unblocks
// the slot and hands back what the player wrote. Opt-in, because for sage
// dismissing someone's unread mail would be wrong; for the Oracle, reading
// what was sent to it is the point.
async function drainMailSlot(bot) {
  const letter = awareness.getInventory(bot).find(
    (it) => it.type === 'Paper' && it.slot === awareness.MAIL_SLOT &&
      (it.grState || 0) === awareness.PAPER_LETTER_STATE)
  if (!letter) return { drained: false, text: '' }
  const hands = await clearHands(bot)
  if (!hands.ok) {
    log.warn(`cannot collect mail: ${hands.error}`)
    return { drained: false, text: '' }
  }
  // GET moves it to HANDS and pops the next queued letter into MAIL_SLOT
  // (Paper.GET's update_mail_slot call). READ requires it be held.
  await withTimeout(getObj(bot, letter.ref), 10000, 'drainMailSlot.pick_up')
  // Retry an empty read. advance_mail_slot repoints text_path and then loads
  // the body from mongo ASYNCHRONOUSLY (Paper.retrievePaperContents), so a read
  // that wins the race gets an empty page — and clearing on the strength of
  // that would destroy a player's letter without anyone ever seeing it.
  let text = ''
  for (let attempt = 0; attempt < READ_ATTEMPTS && !text; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, READ_RETRY_MS))
    try {
      text = decodePage(await withTimeout(readPaperPage(bot, letter.ref), 10000, 'drainMailSlot.read'))
    } catch (err) {
      log.warn(`could not read the letter in MAIL_SLOT: ${err.message}`)
    }
  }
  if (!text) {
    // Leave it where it is rather than clear it away unread. The slot stays
    // blocked, which is visible and recoverable; a silently destroyed letter
    // is neither.
    log.warn('a letter in MAIL_SLOT read back empty after retries; leaving it intact')
    return { drained: false, text: '', unreadable: true }
  }
  // Blank it (an empty write is Paper.WRITE's clear sentinel, which also
  // resets text_path so is_blank() holds), then put it back in a pocket so
  // the server destroys it. Reusing this sheet instead would leave the
  // MAIL_SLOT replacement behind as a second Paper in the same slot.
  await withTimeout(bot.writePaper(letter.ref, ''), 10000, 'drainMailSlot.clear')
  await withTimeout(discardBlankPaper(bot, letter.ref), 10000, 'drainMailSlot.discard')
  const letterInfo = parsePostmark(text)
  log.info(`read a letter from ${letterInfo.sender || 'an unknown sender'} out of MAIL_SLOT`)
  // `text` is the whole page including the postmark, which is the only
  // identity a caller can use to spot the same letter twice: text_path lives
  // server-side and never reaches the client's world model.
  return { drained: true, ref: letter.ref, text: text, sender: letterInfo.sender, body: letterInfo.body }
}

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// GET takes no parameters beyond `to`; the old containerNoid field drew
// an "ignored unknown parameter" warning on every send.
//
// sendForReply, not send: plain send resolves as soon as the message is on
// the wire, so the next op can race ahead of elko actually moving the
// sheet. Everything after a pick-up (READ, WRITE, PSENDMAIL) is gated on
// holding(avatar, this) server-side, so the reply is the only real signal
// that it is safe to continue.
function getObj(bot, ref) {
  return bot.sendForReply({ op: 'GET', to: ref })
}

// Paper.READ replies with the raw PETSCII page. Sent as a raw op rather
// than through bot.readObject, which routes via habiworld's paper_do and
// gates on ctx.inHand — and our world model can never satisfy that gate,
// because Paper.GET announces the pick-up with send_neighbor_msg, which
// excludes the actor. The server's own holding() check is the authority.
function readPaperPage(bot, ref) {
  return bot.sendForReply({ op: 'READ', to: ref, page: 0 })
}

function decodePage(reply) {
  const codes = (reply && reply.ascii) || []
  let out = ''
  for (const c of codes) {
    if (c === 0) break
    out += String.fromCharCode(c)
  }
  return out
}

// Paper.PUT destroys a sheet outright once it is blank (Paper.java:334) —
// the same way a player gets rid of scrap by stuffing it back in a pocket.
// This is what keeps MAIL_SLOT at exactly one Paper: GET spawns the
// replacement, and the sheet we read gets disposed of instead of piling up
// as a second occupant of the slot.
function discardBlankPaper(bot, ref) {
  const me = bot.world && bot.world.me
  if (!me) return Promise.resolve({ ok: false })
  return bot.send({ op: 'PUT', to: ref, containerNoid: me.noid, x: 0, y: DISCARD_SLOT, orientation: 0 })
}

// Every Paper.GET is gated on empty_handed(avatar) — ANY object in HANDS makes
// the pick-up fail. Worse, the failure is quiet: Paper.READ answers
// showEmptyPaper when you are not holding the sheet, so a draft left in hands by
// an interrupted compose breaks both sending and receiving and presents as "the
// letter read back empty". Seen in production. So: empty the hands first.
async function clearHands(bot) {
  const held = awareness.getInventory(bot).find((it) => it.slot === awareness.HANDS_SLOT)
  if (!held) return { ok: true }
  if (held.type !== 'Paper') {
    log.warn(`holding a ${held.type}, which blocks picking anything up`)
    return { ok: false, error: `hands are full (holding a ${held.type})` }
  }
  const state = held.grState || 0
  if (state === awareness.PAPER_BLANK_STATE) return { ok: true } // usable as-is

  // Everything else gets READ, and the page decides what happens to it.
  //
  // WRITTEN is ambiguous and dangerous to guess at: Paper.GET fiddles an
  // INCOMING letter to WRITTEN as you pick it up, so a written page in hands is
  // either our own abandoned draft or somebody's letter we collected and never
  // finished reading. A page with a sender on it is never destroyed here - it is
  // handed back for the caller to deliver first. (Production had exactly this: a
  // player's letter stuck in hands, blocking every pick-up, where blind cleanup
  // would have erased it.)
  //
  // LETTER used to be refused here without even looking, on the theory that
  // unread mail must never be touched. That was the wrong end of the stick:
  // reading it IS how it gets delivered, and refusing left the hands full
  // forever. Since every Paper.GET is gated on empty_handed, the bot then went
  // silently deaf - it could neither collect mail nor compose a reply, and
  // logged nothing. Production, 2026-09-02: a letter sat in the Oracle's hands
  // for sixteen hours while it looped every two minutes doing nothing.
  let text = ''
  for (let attempt = 0; attempt < READ_ATTEMPTS && !text; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, READ_RETRY_MS))
    try {
      text = decodePage(await withTimeout(readPaperPage(bot, held.ref), 10000, 'clearHands.read'))
    } catch (err) {
      log.warn(`could not read the page in hand: ${err.message}`)
    }
  }
  const info = parsePostmark(text)
  // A postmark means somebody else wrote it. So does arriving as a LETTER, even
  // if the postmark is missing - anything handed to us through the mail system
  // gets delivered before it is disposed of.
  if (text && (info.sender || state === awareness.PAPER_LETTER_STATE)) {
    log.info(`recovered a letter from ${info.sender || 'an unknown sender'} that was stuck in hand`)
    return { ok: false, recovered: { sender: info.sender, body: info.body, text: text }, ref: held.ref }
  }
  if (!text) {
    // Could not read it at all - refuse rather than destroy something unseen.
    // `unreadable` tells the caller this is the recoverable kind of stuck: the
    // page is intact and can be set aside (stowHeldItem) once patience runs
    // out, which is not the same as being free to destroy it.
    return { ok: false, unreadable: true, ref: held.ref, error: 'holding a page that cannot be read' }
  }
  await discardHeldPaper(bot, held.ref)
  log.info('discarded an abandoned draft that was blocking the hands')
  return { ok: true, cleared: true }
}

// Blank a held sheet and put it away; Paper.PUT destroys a blank one.
// The escape hatch for a page the bot cannot read: move it out of HANDS into a
// free numbered pocket slot, WITHOUT blanking it first. Nothing is destroyed -
// Paper.PUT only destroys a sheet that is already blank - so an unreadable page
// survives for a human to look at, while the hands come free and mail flows
// again. Slots 0-3 are the pockets; MAIL_SLOT (4) is the mailbox and must stay
// available for incoming letters, so it is never a target.
//
// Preferred over destroying an unreadable page (which risks erasing a player's
// letter) and over leaving it in hands (which silently disables the whole bot).
async function stowHeldItem(bot) {
  const inv = awareness.getInventory(bot)
  const held = inv.find((it) => it.slot === awareness.HANDS_SLOT)
  if (!held) return { ok: true, stowed: false }
  const me = bot.world && bot.world.me
  if (!me) return { ok: false, error: 'no avatar in the world model' }
  const taken = new Set(inv.map((it) => it.slot))
  const slot = POCKET_SLOTS.find((n) => !taken.has(n))
  if (slot === undefined) {
    return { ok: false, error: 'every pocket slot is full' }
  }
  await withTimeout(
    bot.send({ op: 'PUT', to: held.ref, containerNoid: me.noid, x: 0, y: slot, orientation: 0 }),
    10000, 'stowHeldItem.put')
  log.warn(`set aside ${held.type} ${held.ref} in pocket slot ${slot} to free the hands`)
  return { ok: true, stowed: true, slot: slot, ref: held.ref, type: held.type }
}

async function discardHeldPaper(bot, ref) {
  await withTimeout(bot.writePaper(ref, ''), 10000, 'discardHeld.blank')
  await withTimeout(discardBlankPaper(bot, ref), 10000, 'discardHeld.discard')
}

// composeAndSendMail — pick up a blank Paper, write the addressed page,
// and PSENDMAIL it. The bot must be logged in: mailing is an avatar
// action, not a server call.
//
// Resolves { ok: true, recipient, truncated } or { ok: false, error }.
// Never throws for an expected condition (bad name, no blank paper) —
// callers surface `error` to a human.
async function composeAndSendMail(bot, opts) {
  const recipient = String((opts && opts.recipient) || '').trim().toLowerCase()
  const body = String((opts && opts.body) || '')
  if (!recipient) return { ok: false, error: 'recipient is required' }
  if (!RECIPIENT_REGEX.test(recipient)) {
    return { ok: false, error: `recipient "${recipient}" doesn't look like an avatar name` }
  }
  if (!sanitizeLines(body).join('').trim()) {
    return { ok: false, error: 'body is empty after sanitizing' }
  }

  const hands = await clearHands(bot)
  if (!hands.ok && !hands.letter) return { ok: false, error: hands.error }
  let { paper, error } = chooseBlankPaper(bot)
  const readLetters = []
  if (error && opts && opts.drainMail) {
    // Out of blank paper because someone mailed us. Read their letter and
    // reuse the sheet rather than going mute.
    const drained = await drainMailSlot(bot)
    if (drained.drained) {
      if (drained.body) readLetters.push({ sender: drained.sender, body: drained.body })
      await new Promise((r) => setTimeout(r, 500)) // let the FIDDLE_$ land
      ;({ paper, error } = chooseBlankPaper(bot))
    }
  }
  if (error) return { ok: false, error, readLetters: readLetters }

  const { text, truncated } = buildMailPage(recipient, body)
  if (paper.slot !== awareness.HANDS_SLOT) {
    await withTimeout(getObj(bot, paper.ref), 10000, 'composeAndSendMail.pick_up')
  }
  await withTimeout(bot.writePaper(paper.ref, text), 10000, 'composeAndSendMail.write')
  await withTimeout(bot.mailPaper(paper.ref), 10000, 'composeAndSendMail.send')
  log.info(`mailed a letter to ${recipient} (${text.length} chars, truncated=${truncated})`)
  return { ok: true, recipient, truncated, readLetters: readLetters }
}

module.exports = {
  composeAndSendMail,
  drainMailSlot,
  clearHands,
  discardHeldPaper,
  stowHeldItem,
  parsePostmark,
  buildMailPage,
  wrapForPaper,
  MAIL_COLS,
  MAIL_ROWS,
  MAIL_BODY_ROWS,
  MAIL_BODY_MAX,
  CLEAR_SENTINEL_LENGTH,
}
