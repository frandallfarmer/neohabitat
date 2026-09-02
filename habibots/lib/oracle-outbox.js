/* jshint esversion: 8 */

'use strict'

// oracle-outbox.js — durable queue for Oracle answers awaiting delivery.
//
// Mailing is an avatar action: PSENDMAIL only works while the bot is
// logged in and holding a Paper. An operator in Discord has no idea
// whether that's true right now, and their answer is hand-written — it
// is not the kind of message the DiscordNotifier's drop-on-full posture
// is acceptable for. So every answer is written down BEFORE Discord is
// told anything, and drained whenever the Habitat session comes up.
//
// Storage mirrors lib/sage/memory.js: the `habibots` mongo database (kept
// apart from elko's `elko.odb`), lazy idempotent connect, and a fall back
// to process memory if mongo is unreachable so the bot still runs in dev.
// Keyed by Discord message id, so a double modal submit — or a retry
// after a crash — cannot mail the same answer twice.

const log = require('winston')
const { MongoClient } = require('mongodb')

const DEFAULT_URI = process.env.HABIBOTS_MONGO_URL || 'mongodb://neohabitatmongo:27017'
const DB_NAME = 'habibots'
const COLLECTION = 'oracle_outbox'
// elko's own database, read only, purely to see whether mail is waiting.
const ELKO_DB = 'elko'
const ELKO_COLLECTION = 'odb'

class OracleOutbox {
  constructor(uri) {
    this.uri = uri || DEFAULT_URI
    this.client = null
    this.col = null
    this.ready = false
    this._initPromise = null
    this.fallback = new Map() // used only when mongo is unreachable
  }

  async _ensureReady() {
    if (this.ready) return true
    if (this._initPromise) return this._initPromise
    this._initPromise = (async () => {
      try {
        this.client = new MongoClient(this.uri, {
          serverSelectionTimeoutMS: 3000,
          connectTimeoutMS: 3000,
        })
        await this.client.connect()
        this.col = this.client.db(DB_NAME).collection(COLLECTION)
        await this.col.createIndex({ status: 1, queuedAt: 1 })
        this.ready = true
        log.info('oracle outbox connected to mongo')
      } catch (err) {
        log.warn(`oracle outbox: mongo unavailable (${err.message}); queueing in memory only`)
        this.client = null
        this.col = null
      }
      return this.ready
    })()
    return this._initPromise
  }

  // Record an answer. Returns 'inserted' when this is the first answer to
  // the request, or the EXISTING status ('queued' | 'sent') when the
  // request has already been answered — two Oracles can both open a modal
  // on the same message, and only the first may mail. Distinguishing the
  // two matters: "already queued but not yet delivered" still means don't
  // send again.
  async enqueue(entry) {
    const doc = {
      _id: entry.id,
      recipient: entry.recipient,
      body: entry.body,
      askedBy: entry.askedBy || null,
      answeredBy: entry.answeredBy || null,
      status: 'queued',
      queuedAt: new Date(),
    }
    await this._ensureReady()
    if (!this.col) {
      if (this.fallback.has(entry.id)) return this.fallback.get(entry.id).status
      this.fallback.set(entry.id, doc)
      return 'inserted'
    }
    try {
      await this.col.insertOne(doc)
      return 'inserted'
    } catch (err) {
      if (err && err.code === 11000) {
        const existing = await this.col.findOne({ _id: entry.id })
        return (existing && existing.status) || 'queued'
      }
      throw err
    }
  }

  async pending() {
    await this._ensureReady()
    if (!this.col) {
      return [...this.fallback.values()].filter((d) => d.status === 'queued')
    }
    return this.col.find({ status: 'queued' }).sort({ queuedAt: 1 }).toArray()
  }

  async markSent(id) {
    await this._ensureReady()
    if (!this.col) {
      const doc = this.fallback.get(id)
      if (doc) { doc.status = 'sent'; doc.sentAt = new Date() }
      return
    }
    await this.col.updateOne({ _id: id }, { $set: { status: 'sent', sentAt: new Date() } })
  }

  // Delivery failures stay 'queued' so the next drain retries them; the
  // error is recorded for the operator reading logs.
  async noteFailure(id, message) {
    await this._ensureReady()
    if (!this.col) {
      const doc = this.fallback.get(id)
      if (doc) { doc.lastError = message; doc.attempts = (doc.attempts || 0) + 1 }
      return
    }
    await this.col.updateOne(
      { _id: id },
      { $set: { lastError: message, lastAttemptAt: new Date() }, $inc: { attempts: 1 } })
  }

  // Is there mail waiting for this avatar? A READ-ONLY peek at elko's own
  // queue, used only to decide whether it is worth re-entering the region;
  // every actual change still goes through the game. Returns 0 when mongo is
  // unavailable, so an unreachable database means "do nothing", never a storm
  // of region entries.
  async queuedMailFor(avatarName) {
    await this._ensureReady()
    if (!this.client) return 0
    try {
      const doc = await this.client.db(ELKO_DB).collection(ELKO_COLLECTION)
        .findOne({ ref: `mail-${String(avatarName).toLowerCase()}` })
      return (doc && Array.isArray(doc.queue)) ? doc.queue.length : 0
    } catch (err) {
      log.warn(`could not peek at the mail queue: ${err.message}`)
      return 0
    }
  }

  async close() {
    if (this.client) await this.client.close()
    this.client = null
    this.col = null
    this.ready = false
    this._initPromise = null
  }
}

module.exports = { OracleOutbox }
