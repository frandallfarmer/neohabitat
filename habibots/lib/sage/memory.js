/* jslint bitwise: true */
/* jshint esversion: 8 */

'use strict'

// memory.js — sage's persistent memory.
//
// Three collections in a SEPARATE mongo database (`habibots`) so we can't
// possibly collide with elko's `elko.odb` collection:
//
//   habibots.conversations   — episodic log; one doc per inbound or
//                              outbound chat turn. TTL 30 days.
//   habibots.notes           — semantic facts sage has chosen to remember
//                              about a subject (an avatar name, an object,
//                              a region). Subject-scoped, persists forever.
//   habibots.inventory       — single doc per bot with last-seen pocket
//                              contents, so a restart can prime sage's
//                              awareness from disk before the next make
//                              storm overwrites it.
//
// Each document carries a `bot` field so eliza/hatchery could later share
// this infrastructure without overwriting each other's memory.
//
// Connection is lazy + idempotent. If mongo is unreachable (dev without
// the docker stack up), every method becomes a logged no-op so sage stays
// alive and just runs without persistence — the bot doesn't crash.

const log = require('winston')
const { MongoClient } = require('mongodb')

const DEFAULT_URI = process.env.HABIBOTS_MONGO_URL || 'mongodb://neohabitatmongo:27017'
const DB_NAME = 'habibots'
const TTL_SECONDS = 30 * 24 * 60 * 60   // 30 days

// Module-level singleton so connectMemory() is idempotent across requires.
let _instance = null

class Memory {
  constructor(uri) {
    this.uri = uri
    this.client = null
    this.db = null
    this.conversations = null
    this.notes = null
    this.inventory = null
    this.ready = false
    this._initPromise = null   // outstanding connect; awaited by ops
  }

  // Connect lazily. Concurrent calls share one promise so we don't open
  // multiple clients on a flurry of early ops.
  async _ensureReady() {
    if (this.ready) return true
    if (this._initPromise) return this._initPromise
    this._initPromise = (async () => {
      try {
        this.client = new MongoClient(this.uri, {
          // Short timeouts — if mongo is down we want to fail fast and
          // degrade to no-op, not stall the bot's event loop.
          serverSelectionTimeoutMS: 3000,
          connectTimeoutMS: 3000,
        })
        await this.client.connect()
        this.db = this.client.db(DB_NAME)
        this.conversations = this.db.collection('conversations')
        this.notes = this.db.collection('notes')
        this.inventory = this.db.collection('inventory')
        await this._ensureIndexes()
        this.ready = true
        log.info('memory: connected to %s/%s', this.uri, DB_NAME)
        return true
      } catch (e) {
        log.warn('memory: could not connect to %s — running without persistence: %s', this.uri, e.message)
        this.ready = false
        return false
      }
    })()
    return this._initPromise
  }

  async _ensureIndexes() {
    // {bot, avatar, ts desc} — recentTurns lookups
    await this.conversations.createIndex({ bot: 1, avatar: 1, ts: -1 })
    // TTL — auto-purge old conversation rows so the collection doesn't
    // grow forever. expireAfterSeconds counts from the value of `ts`.
    await this.conversations.createIndex({ ts: 1 }, { expireAfterSeconds: TTL_SECONDS })
    // {bot, subject, ts desc} — notesAbout lookups
    await this.notes.createIndex({ bot: 1, subject: 1, ts: -1 })
  }

  // Fire-and-forget: log a single chat turn. Callers shouldn't block on
  // this — wrap in `.catch(...)` if you care about errors but typically
  // we just want to write and move on.
  async logTurn({ bot, avatar, region, direction, text }) {
    if (!(await this._ensureReady())) return
    if (!text) return
    try {
      await this.conversations.insertOne({
        bot,
        avatar: (avatar || '').toLowerCase(),
        region: region || '',
        direction,           // 'incoming' | 'outgoing'
        text,
        ts: new Date(),
      })
    } catch (e) {
      log.warn('memory.logTurn failed: %s', e.message)
    }
  }

  // Most recent turns with a given avatar, newest-first.
  async recentTurns({ bot, avatar, limit = 5 }) {
    if (!(await this._ensureReady())) return []
    try {
      return await this.conversations
        .find({ bot, avatar: (avatar || '').toLowerCase() })
        .sort({ ts: -1 })
        .limit(limit)
        .toArray()
    } catch (e) {
      log.warn('memory.recentTurns failed: %s', e.message)
      return []
    }
  }

  // Semantic-fact upsert. We don't dedupe by content — if Claude wants
  // to record "Steve runs the made" three times, that's three rows; the
  // {bot, subject, ts desc} index makes the freshest one easy to find.
  async remember({ bot, subject, fact }) {
    if (!(await this._ensureReady())) return
    if (!subject || !fact) return
    try {
      await this.notes.insertOne({
        bot,
        subject: subject.toLowerCase(),
        fact,
        ts: new Date(),
      })
    } catch (e) {
      log.warn('memory.remember failed: %s', e.message)
    }
  }

  // Last N notes about a subject, newest-first.
  async notesAbout({ bot, subject, limit = 5 }) {
    if (!(await this._ensureReady())) return []
    try {
      return await this.notes
        .find({ bot, subject: (subject || '').toLowerCase() })
        .sort({ ts: -1 })
        .limit(limit)
        .toArray()
    } catch (e) {
      log.warn('memory.notesAbout failed: %s', e.message)
      return []
    }
  }

  // Free-text search across both conversations and notes. Regex on the
  // text/fact field — full $text indexes are overkill for the volume
  // we'll see (a few hundred docs/day at most). Optional `avatar` filter
  // narrows to one person.
  async recall({ bot, query, avatar, limit = 5 }) {
    if (!(await this._ensureReady())) return { conversations: [], notes: [] }
    if (!query) return { conversations: [], notes: [] }
    // RegExp.escape isn't standard yet — manual escape of the meta chars
    // we care about so a query like "what's up?" doesn't barf.
    const pat = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const convFilter = { bot, text: pat }
    const noteFilter = { bot, fact: pat }
    if (avatar) {
      convFilter.avatar = avatar.toLowerCase()
      noteFilter.subject = avatar.toLowerCase()
    }
    try {
      const [conversations, notes] = await Promise.all([
        this.conversations.find(convFilter).sort({ ts: -1 }).limit(limit).toArray(),
        this.notes.find(noteFilter).sort({ ts: -1 }).limit(limit).toArray(),
      ])
      return { conversations, notes }
    } catch (e) {
      log.warn('memory.recall failed: %s', e.message)
      return { conversations: [], notes: [] }
    }
  }

  // Inventory snapshot — one doc per bot, upserted on every update.
  async saveInventory({ bot, items }) {
    if (!(await this._ensureReady())) return
    try {
      await this.inventory.updateOne(
        { bot },
        { $set: { bot, items: items || [], updatedAt: new Date() } },
        { upsert: true },
      )
    } catch (e) {
      log.warn('memory.saveInventory failed: %s', e.message)
    }
  }

  async loadInventory({ bot }) {
    if (!(await this._ensureReady())) return []
    try {
      const doc = await this.inventory.findOne({ bot })
      return (doc && doc.items) || []
    } catch (e) {
      log.warn('memory.loadInventory failed: %s', e.message)
      return []
    }
  }

  async close() {
    if (this.client) {
      try { await this.client.close() } catch (e) { /* swallow */ }
      this.ready = false
      this._initPromise = null
    }
  }
}

// connectMemory is idempotent — multiple requires across modules return
// the same Memory instance. Pass a fresh URI to replace (uncommon, but
// supported for tests).
function connectMemory(uri = DEFAULT_URI) {
  if (_instance && _instance.uri === uri) return _instance
  if (_instance) {
    // Different URI requested — close the old one before swapping.
    _instance.close().catch(() => {})
  }
  _instance = new Memory(uri)
  // Kick off the connect in the background so the first real op doesn't
  // pay the connect latency synchronously.
  _instance._ensureReady().catch(() => {})
  return _instance
}

module.exports = { connectMemory, Memory }
