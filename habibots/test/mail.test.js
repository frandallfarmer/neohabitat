/* jshint esversion: 8 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const mail = require('../lib/mail')

// Paper.java:157 treats a 16-element request_ascii as "erase this sheet".
// "to: oracle\n" is 11 chars, so a 5-character body lands exactly on the
// sentinel and would blank the Paper instead of mailing it.
test('a 16-character page is padded off the clear sentinel', () => {
  const { text } = mail.buildMailPage('oracle', 'abcde')
  assert.notStrictEqual(text.length, mail.CLEAR_SENTINEL_LENGTH)
  assert.strictEqual(text, 'to: oracle\nabcde ')
})

test('pages that are not 16 chars are left alone', () => {
  assert.strictEqual(mail.buildMailPage('randy', 'Hi').text, 'to: randy\nHi')
})

test('the address is the literal first line PSENDMAIL parses', () => {
  const { text } = mail.buildMailPage('Randy', 'seek within')
  assert.strictEqual(text.split('\n')[0], 'to: Randy')
})

test('no line exceeds the 40-column page width', () => {
  const body = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
  for (const line of mail.buildMailPage('randy', body).text.split('\n')) {
    assert.ok(line.length <= mail.MAIL_COLS, `line too wide: ${line.length}`)
  }
})

test('a word longer than the page width is split rather than lost', () => {
  const { text } = mail.buildMailPage('randy', 'x'.repeat(95))
  assert.strictEqual(text.split('\n').slice(1).join('').length, 95)
})

test('a body longer than the page is truncated and marked', () => {
  const body = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
  const { text, truncated } = mail.buildMailPage('randy', body)
  assert.ok(truncated)
  // Row 0 is the address line; the body gets the remaining 15.
  assert.strictEqual(text.split('\n').length, mail.MAIL_ROWS)
  assert.ok(text.endsWith(' ...'), `expected a truncation marker, got ${JSON.stringify(text)}`)
})

test('a body that fits is not marked truncated', () => {
  const { truncated } = mail.buildMailPage('randy', 'short enough')
  assert.strictEqual(truncated, false)
})

// habibot.writePaper does charCodeAt(i) & 0x7F, so anything above 7-bit
// ASCII has to be folded before it reaches the wire or it renders as
// garbage block glyphs on the C64.
test('non-ASCII is folded before it can reach the wire', () => {
  const { text } = mail.buildMailPage('randy', 'Seek — the “oracle” \u{1F52E}')
  assert.strictEqual(text, 'to: randy\nSeek - the "oracle" :-)')
  for (const ch of text) {
    assert.ok(ch === '\n' || (ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e), `bad char ${ch}`)
  }
})

test('author paragraph breaks survive wrapping', () => {
  const { text } = mail.buildMailPage('randy', 'one\n\ntwo')
  assert.deepStrictEqual(text.split('\n'), ['to: randy', 'one', '', 'two'])
})

test('composeAndSendMail rejects a bad recipient before touching the world', async () => {
  const bot = { send: () => assert.fail('must not talk to elko') }
  assert.strictEqual((await mail.composeAndSendMail(bot, { recipient: '', body: 'x' })).ok, false)
  assert.strictEqual((await mail.composeAndSendMail(bot, { recipient: 'a b', body: 'x' })).ok, false)
})

test('composeAndSendMail rejects a body that sanitizes away to nothing', async () => {
  const bot = { send: () => assert.fail('must not talk to elko') }
  const res = await mail.composeAndSendMail(bot, { recipient: 'randy', body: '\u{1F52E}'.repeat(0) + '   ' })
  assert.strictEqual(res.ok, false)
})

// Mail is addressed by display name, not by user ref, and Habitat names
// may contain spaces ("Phil Collins" → mail-phil collins).
test('a display name with a space is a valid recipient', async () => {
  const { text } = mail.buildMailPage('Phil Collins', 'seek within')
  assert.strictEqual(text.split('\n')[0], 'to: Phil Collins')
  const bot = { send: () => assert.fail('must not talk to elko') }
  // Rejection here would have to come from the world, not the name check;
  // with no inventory it stops at "no Paper", proving the name passed.
  const res = await mail.composeAndSendMail(bot, { recipient: 'Phil Collins', body: 'x' })
  assert.strictEqual(res.ok, false)
  assert.match(res.error, /Paper/)
})

// Paper.WRITE's clear sentinel is a request_ascii of exactly 16 elements.
// habibot.writePaper documented "pass empty string to clear" but sent a
// length-0 array, which takes the write branch instead and leaves the
// sheet WRITTEN holding nothing — so a drained mail sheet never became
// reusable. Both directions of that are now handled at the wire level.
test('writePaper sends the clear sentinel for an empty page', () => {
  const HabiBot = require('../habibot')
  const bot = Object.create(HabiBot.prototype)
  let sent = null
  bot.sendWithDelay = (msg) => { sent = msg; return Promise.resolve({ ok: true }) }
  bot.writePaper('item-x', '')
  assert.strictEqual(sent.request_ascii.length, mail.CLEAR_SENTINEL_LENGTH)
})

test('writePaper never lets a real page collide with the clear sentinel', () => {
  const HabiBot = require('../habibot')
  const bot = Object.create(HabiBot.prototype)
  let sent = null
  bot.sendWithDelay = (msg) => { sent = msg; return Promise.resolve({ ok: true }) }
  bot.writePaper('item-x', 'x'.repeat(mail.CLEAR_SENTINEL_LENGTH))
  assert.notStrictEqual(sent.request_ascii.length, mail.CLEAR_SENTINEL_LENGTH)
  assert.strictEqual(sent.request_ascii[mail.CLEAR_SENTINEL_LENGTH], 32) // padded with ' '
})

// A player mailing "to: oracle" parks a LETTER in the bot's MAIL_SLOT.
// That slot is the only self-replenishing paper source (Paper.GET's
// special_get is MAIL_SLOT-only), so without draining, one letter stops
// the bot answering anyone.
test('drainMailSlot is a no-op when the mail slot holds no letter', async () => {
  const bot = { world: null, send: () => assert.fail('must not talk to elko') }
  assert.deepStrictEqual(await mail.drainMailSlot(bot), { drained: false, text: '' })
})

test('composeAndSendMail only dismisses unread mail when asked to', async () => {
  // No drainMail flag: an unread LETTER must be left alone, even though it
  // means refusing to send. This is what keeps sage from eating someone's mail.
  const inv = [{ ref: 'p1', type: 'Paper', slot: 4, grState: 2, name: 'Pad and mailbox' }]
  const bot = {
    world: { me: { noid: 1 }, inventory: () => inv.map((i) => ({ ref: i.ref, type: i.type, name: i.name, noid: 1, mod: { y: i.slot, gr_state: i.grState } })) },
    send: () => assert.fail('must not touch the letter'),
  }
  const res = await mail.composeAndSendMail(bot, { recipient: 'randy', body: 'hello' })
  assert.strictEqual(res.ok, false)
  assert.match(res.error, /LETTER state/)
})

// A Paper carries no sender field. Paper.addPostmark overwrites the "to:"
// line with "From: %-14s Postmark: %s ", so that line is the only record
// of who wrote — and it is what the Oracle relays to Discord.
test('the sender is recovered from the postmark line', () => {
  const p = mail.parsePostmark('From: Steve          Postmark: 26-09-01 Oracle, why is the sky green?')
  assert.deepStrictEqual(p, { sender: 'Steve', date: '26-09-01', body: 'Oracle, why is the sky green?' })
})

test('a display name with a space survives the %-14s padding', () => {
  const p = mail.parsePostmark('From: Phil Collins   Postmark: 26-09-01 Two words.')
  assert.strictEqual(p.sender, 'Phil Collins')
  assert.strictEqual(p.body, 'Two words.')
})

test('a multi-line letter body keeps its lines', () => {
  const p = mail.parsePostmark('From: Steve          Postmark: 26-09-01 line one\nline two')
  assert.strictEqual(p.body, 'line one\nline two')
})

// No postmark means no addressable sender — the relay posts it without a
// footer so the answer command refuses rather than mailing nowhere.
test('an unpostmarked page yields no sender rather than a wrong one', () => {
  const p = mail.parsePostmark('just some scribbles')
  assert.strictEqual(p.sender, null)
  assert.strictEqual(p.body, 'just some scribbles')
  assert.strictEqual(mail.parsePostmark('').sender, null)
  assert.strictEqual(mail.parsePostmark(null).sender, null)
})

// elko loads a letter body from mongo asynchronously (Paper.retrievePaperContents),
// so a read can win the race and come back empty. Clearing on the strength of
// that would destroy a player's letter with nobody having seen it, so an
// unreadable letter is left in the slot instead — blocked but recoverable.
test('a letter that reads back empty is left intact, not cleared', async () => {
  const inv = [{ ref: 'p1', type: 'Paper', slot: 4, grState: 2, name: 'Pad and mailbox' }]
  const sent = []
  const bot = {
    world: { me: { noid: 1 }, getByRef: () => null, inventory: () => inv.map((i) => ({ ref: i.ref, type: i.type, name: i.name, noid: 1, mod: { y: i.slot, gr_state: i.grState } })) },
    sendForReply: (msg) => { sent.push(msg.op); return Promise.resolve({ ascii: [] }) },  // always empty
    writePaper: () => { sent.push('WRITE'); return Promise.resolve({ ok: true }) },
    send: (msg) => { sent.push(msg.op); return Promise.resolve({ ok: true }) },
  }
  const res = await mail.drainMailSlot(bot)
  assert.strictEqual(res.drained, false)
  assert.strictEqual(res.unreadable, true)
  assert.ok(!sent.includes('WRITE'), 'must not clear a letter it could not read')
  assert.ok(!sent.includes('PUT'), 'must not discard a letter it could not read')
})

// Paper.GET is gated on empty_handed(avatar), and the failure is silent —
// Paper.READ answers showEmptyPaper when you aren't holding the sheet. So a
// draft abandoned in HANDS breaks both sending and receiving, and looks like an
// unreadable letter. This bit production.
function fakeBot(items, sent) {
  return {
    world: { me: { noid: 1 }, getByRef: () => null,
      inventory: () => items.map((i) => ({ ref: i.ref, type: i.type, name: i.name, noid: 1, mod: { y: i.slot, gr_state: i.grState } })) },
    writePaper: (ref, text) => { sent.push(`WRITE:${ref}:${text === '' ? 'clear' : 'text'}`); return Promise.resolve({ ok: true }) },
    send: (msg) => { sent.push(`${msg.op}:${msg.to}`); return Promise.resolve({ ok: true }) },
    sendForReply: (msg) => { sent.push(`${msg.op}:${msg.to}`); return Promise.resolve({ ascii: [] }) },
  }
}

// A WRITTEN page in hand is ambiguous — Paper.GET fiddles an INCOMING letter to
// WRITTEN as you pick it up — so the postmark decides. This is the case that
// bit production: a player's letter stranded in hand, where treating "WRITTEN"
// as "my draft" would have erased it.
function pageBot(items, sent, pageText) {
  const bot = fakeBot(items, sent)
  bot.sendForReply = (msg) => {
    sent.push(`${msg.op}:${msg.to}`)
    return Promise.resolve({ ascii: [...String(pageText)].map((c) => c.charCodeAt(0)) })
  }
  return bot
}

test('a postmarked page in hand is handed back, never destroyed', async () => {
  const sent = []
  const bot = pageBot([{ ref: 'stuck', type: 'Paper', slot: 5, grState: 1 }], sent,
    'From: Randy          Postmark: 26-09-02 Does mail work too?')
  const res = await mail.clearHands(bot)
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.recovered.sender, 'Randy')
  assert.strictEqual(res.recovered.body, 'Does mail work too?')
  assert.strictEqual(res.ref, 'stuck')
  assert.ok(!sent.some((s) => s.startsWith('WRITE')), 'must not blank a letter')
  assert.ok(!sent.some((s) => s.startsWith('PUT')), 'must not discard a letter')
})

test('an unpostmarked draft in hand is blanked and discarded', async () => {
  const sent = []
  const bot = pageBot([{ ref: 'draft', type: 'Paper', slot: 5, grState: 1 }], sent, 'to: someone')
  const res = await mail.clearHands(bot)
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.cleared, true)
  assert.ok(sent.includes('WRITE:draft:clear'), 'blanks the draft')
  assert.ok(sent.some((s) => s.startsWith('PUT:draft')), 'puts it away so the server destroys it')
})

test('an unreadable page in hand is refused rather than destroyed', async () => {
  const sent = []
  const bot = pageBot([{ ref: 'mystery', type: 'Paper', slot: 5, grState: 1 }], sent, '')
  const res = await mail.clearHands(bot)
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.unreadable, true, 'the caller needs to know this one is recoverable')
  assert.strictEqual(res.ref, 'mystery')
  assert.ok(!sent.some((s) => s.startsWith('WRITE')), 'must not blank what it cannot read')
  assert.ok(!sent.some((s) => s.startsWith('PUT')))
})

// Refusing to even LOOK at an unread letter was the 2026-09-02 production jam:
// the hands stayed full, and since Paper.GET is gated on empty_handed the bot
// went silently deaf in both directions. Reading it is how it gets delivered.
test('an unread letter in hands is read and handed back for delivery', async () => {
  const sent = []
  const bot = pageBot([{ ref: 'letter', type: 'Paper', slot: 5, grState: 2 }], sent,
    'From: Naibor         Postmark: 26-09-02 Works like a charm')
  const res = await mail.clearHands(bot)
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.recovered.sender, 'Naibor')
  assert.strictEqual(res.recovered.body, 'Works like a charm')
  assert.ok(sent.some((s) => s.startsWith('READ:letter')), 'must actually read it')
  assert.ok(!sent.some((s) => s.startsWith('WRITE')), 'must not blank a letter')
  assert.ok(!sent.some((s) => s.startsWith('PUT')), 'delivery comes before disposal')
})

// A LETTER with no postmark still came through the mail system, so it goes up
// to Discord unattributed rather than being treated as our own scrap paper.
test('an unpostmarked LETTER is still delivered, not discarded', async () => {
  const sent = []
  const bot = pageBot([{ ref: 'odd', type: 'Paper', slot: 5, grState: 2 }], sent, 'no postmark here')
  const res = await mail.clearHands(bot)
  assert.strictEqual(res.recovered.sender, null)
  assert.strictEqual(res.recovered.body, 'no postmark here')
  assert.ok(!sent.some((s) => s.startsWith('WRITE')), 'must not blank it')
})

// The escape hatch. An unreadable page must not sit in the hands forever (that
// disables the bot) and must not be destroyed (it may be someone's letter), so
// it is moved intact into a free pocket.
test('stowHeldItem moves the held page to a free pocket without blanking it', async () => {
  const sent = []
  const bot = fakeBot([
    { ref: 'husk', type: 'Paper', slot: 5, grState: 2 },
    { ref: 'mailbox', type: 'Paper', slot: 4, grState: 0 },
  ], sent)
  const res = await mail.stowHeldItem(bot)
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.slot, 0)
  assert.strictEqual(res.ref, 'husk')
  assert.ok(sent.includes('PUT:husk'), 'moves it out of the hands')
  assert.ok(!sent.some((s) => s.startsWith('WRITE')), 'never blanks it — that would destroy it on PUT')
})

test('stowHeldItem skips occupied pockets and never targets the mail slot', async () => {
  const sent = []
  const bot = fakeBot([
    { ref: 'husk', type: 'Paper', slot: 5, grState: 2 },
    { ref: 'a', type: 'Paper', slot: 0, grState: 1 },
    { ref: 'b', type: 'Paper', slot: 1, grState: 1 },
    { ref: 'mailbox', type: 'Paper', slot: 4, grState: 0 },
  ], sent)
  assert.strictEqual((await mail.stowHeldItem(bot)).slot, 2)
})

test('stowHeldItem reports failure when every pocket is full', async () => {
  const sent = []
  const bot = fakeBot([
    { ref: 'husk', type: 'Paper', slot: 5, grState: 2 },
    ...[0, 1, 2, 3].map((n) => ({ ref: `p${n}`, type: 'Paper', slot: n, grState: 1 })),
  ], sent)
  const res = await mail.stowHeldItem(bot)
  assert.strictEqual(res.ok, false)
  assert.deepStrictEqual(sent, [], 'no half-move')
})

test('stowHeldItem is a no-op with empty hands', async () => {
  const sent = []
  const res = await mail.stowHeldItem(fakeBot([], sent))
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.stowed, false)
  assert.deepStrictEqual(sent, [])
})

test('a blank sheet in hands is left alone - it is usable', async () => {
  const sent = []
  const bot = fakeBot([{ ref: 'blank', type: 'Paper', slot: 5, grState: 0 }], sent)
  assert.strictEqual((await mail.clearHands(bot)).ok, true)
  assert.deepStrictEqual(sent, [])
})

test('empty hands need no clearing', async () => {
  const sent = []
  assert.strictEqual((await mail.clearHands(fakeBot([], sent))).ok, true)
  assert.deepStrictEqual(sent, [])
})
