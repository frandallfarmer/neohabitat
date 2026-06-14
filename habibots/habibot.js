/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict'

const log = require('winston')
const net = require('net')

const Queue = require('promise-queue')

const constants = require('./constants')
const util = require('./util')
const { Capture } = require('./lib/capture')
const { HabitatWorld, actions: worldActions, dispatch: worldDispatch } = require('../habiworld')


const DirectionToPoseId = {
  LEFT:    254,
  RIGHT:   255,
  FORWARD: 146,
  BEHIND:  143,
}

const AvatarPostures = {
  WAVE:        141,
  POINT:       136,
  EXTEND_HAND: 148,
  JUMP:        139,
  BEND_OVER:   134,
  STAND_UP:    135,
  PUNCH:       140,
  FROWN:       142,
}

const NeighborIndexToCardinal = {
  0: 'NORTH',
  1: 'EAST',
  2: 'SOUTH',
  3: 'WEST',
}

const CardinalToNeighborIndex = {
  NORTH: 0,
  EAST:  1,
  SOUTH: 2,
  WEST:  3,
}

// Screen-direction labels in clockwise order: index matches the k value
// used in walkToExit (UP=0, RIGHT=1, DOWN=2, LEFT=3).
const SCREEN_DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT']

const DefaultHabiBotConfig = {
  shouldReconnect: true,
}


class HabiBot {

  constructor(host, port, username) {
    this.host = host
    this.port = port
    this.username = username

    this.server = null
    this.connected = false

    // Ensures that only 1 Elko request is in flight at any given time.
    // We're talking to the 80's after all...
    this.actionQueue = new Queue(1, Infinity)

    this.config = util.clone(DefaultHabiBotConfig)
    // Mirror username into config so callers can read bot.config.username.
    // The memory subsystem keys its `bot` field on it; without this the
    // field was undefined and stored as null in mongo (issue #537). The
    // instance still carries this.username; the two stay in sync.
    this.config.username = username

    this.callbacks = {
      connected: [],
      delete: [],
      disconnected: [],
      enteredRegion: [],
      msg: [],
    }

    this.world = new HabitatWorld()
    this.world.on('unhandledDelta', (msg) => {
      log.debug('habiworld[%s]: unhandled delta op=%s noid=%d', username, msg.op, msg.noid)
    })
    this.world.on('regionChanged', (ctx) => {
      log.debug('habiworld[%s]: regionChanged → %s (world cleared)', username, ctx)
    })

    this.clearState()

    // Wire tap for test-fixture capture — null unless HABITAT_CAPTURE is set
    // (see lib/capture.js). Tapped in sendWithDelay and processData below.
    this._capture = Capture.fromEnv(username)
    if (this._capture) {
      log.info('wire capture enabled → %s', this._capture.path)
    }

    log.debug('Constructed HabiBot @%s:%d: %j', this.host, this.port, this.config)
  }

  static newWithConfig(host, port, username, config) {
    var bot = new HabiBot(host, port, username)
    Object.assign(bot.config, config)
    return bot
  }


  /**
   * Connects this HabiBot to the Neohabitat server if it is not yet connected.
   *
   * Listens for both 'end' AND 'error'. 'end' fires on a clean half-close
   * (FIN from peer); 'error' fires on a hard reset (RST/ECONNRESET) — which
   * is what happens when the bridge process gets killed mid-flight (e.g.
   * systemd nukes the cgroup, container OOM, kill -9). Without an 'error'
   * listener, Node would either crash or silently leave the socket dead
   * with this.connected still true, and the bot would zombie until restart.
   *
   * If `connect()` itself fails (server down at reconnect time), it also
   * surfaces as an 'error' event on the socket — funnel that into
   * onDisconnect so the shouldReconnect retry path keeps trying with backoff.
   */
  connect() {
    var self = this
    if (this.host === undefined || this.port === undefined) {
      log.error('No host or port specified: %s:%d', this.host, this.port)
      return
    }

    if (!this.connected && !this.connecting) {
      self.connecting = true
      self.clearState()
      this.server = net.connect(this.port, this.host, () => {
        self.connecting = false
        self.connected = true
        self.reconnectDelayMs = 1000  // reset backoff on successful connect
        log.info('Connected to server @%s:%d', self.host, self.port)
        log.debug('Running callbacks for connect @%s:%d', self.host, self.port)
        for (var i in self.callbacks.connected) {
          self.callbacks.connected[i](self)
        }
      })
      self.server.on('data', self.processData.bind(self))
      self.server.on('end', self.onDisconnect.bind(self))
      self.server.on('error', (err) => {
        log.warn('Socket error @%s:%d: %s', self.host, self.port, err.message)
        self.connecting = false
        self.onDisconnect()
      })
    }
  }

  /**
   * Turns the HabiBot into an Avatar if it is currently a Ghost.
   * @returns {Promise}
   */
  corporate() {
    var self = this
    if (!self.isGhosted()) {
      return Promise.resolve()
    }
    return self.send({
      op: 'CORPORATE',
      to: 'GHOST',
    })
      .then(() => {
        // Hardwaits 10 seconds for all C64 clients to load imagery.
        return self.wait(10000)
      })
  }

  /**
   * Turns the HabiBot's Avatar into a Ghost, useful for bots which only need to monitor
   * events in a Region.
   * @returns {Promise}
   */
  discorporate() {
    return this.send({
      op: 'DISCORPORATE',
      to: 'ME',
    })
  }
  
  /**
   * Returns a random number
   */
  static rnd(max) {
    return Math.floor(Math.random() * max)
  }

  /**
   * Runs an Avatar posture animation.
   * @param {string} posture One of WAVE, POINT, EXTEND_HAND, JUMP, BEND_OVER, STAND_UP, PUNCH, or FROWN
   * @returns {Promise}
   */
  doPosture(posture) {
    var self = this
    var postureUpper = posture.toUpperCase()
    if (postureUpper in AvatarPostures) {
      log.debug('Bot @%s:%d running posture animation: %s',
          self.host, self.port, postureUpper)
      return self.send({
        op:   'POSTURE',
        to:   'ME',
        pose: AvatarPostures[postureUpper],
      }).then(() => { self.wait(2000) })
    }
    return Promise.reject(`Invalid posture: ${posture}`)
  }

  /**
   * Ensures that the current HabiBot's Avatar is corporated, e.g. not a ghost.
   * Useful to call in enteredRegion callbacks.
   * @returns {Promise}
   */
  ensureCorporated() {
    return this.tryEnsureCorporated(0)
  }

  /**
   * Faces the HabiBot's Avatar towards a provided direction:
   * @param {string} direction One of LEFT, RIGHT, FORWARD, BEHIND
   * @returns {Promise}
   */
  faceDirection(direction) {
    var directionUpper = direction.toUpperCase()
    if (directionUpper in DirectionToPoseId) {
      log.debug('Bot @%s:%d facing direction: %s', this.host, this.port, directionUpper)
      return this.sendWithDelay({
        op:   'POSTURE',
        to:   'ME',
        pose: DirectionToPoseId[directionUpper],
      }, 5000)
    }
    return Promise.reject(`Invalid direction: ${direction}`)
  }

  /**
   * Activates FNKEY commands
   * @param {int} key     function key to use
   * @param {int} target  the HabiBot's noid
   * @returns {Promise}
   */
  fnKey(key, target) {
    return this.sendWithDelay({
      op: 'FNKEY',
      to: 'ME',
      key: key,
      target: target,
    }, 10000)
  }
  
  /**
   * Tells the HabiBot to "attack" 
   * @param {int} 'pointed_noid' Avatar noid of the target
   * @returns {Promise}
   */
  attackAvatar(objRef, pointed_noid) {
    return this.sendWithDelay({
      op: 'ATTACK',
      to:  objRef,
      pointed_noid: pointed_noid,
    }, 5000)
  }

  /**
   * Returns the Habitat object corresponding to this HabiBot's Avatar returns null if
   * none was found.
   * @returns {Object} Habitat object of this HabiBot's avatar if found, null otherwise
   */
  getAvatar() {
    if ('ME' in this.names) {
      return this.history[this.names.ME].obj
    }
    return null
  }

  /**
   * Obtains the noid of the HabiBot's Avatar.
   * @returns {int} noid of the HabiBot's Avatar, -1 if no Avatar was found
   */
  getAvatarNoid() {
    var avatar = this.getAvatar()
    if (avatar != null) {
      return avatar.mods[0].noid
    }
    return -1
  }
  
   /**
   * Obtains the noid of every Avatar in the current region, but excludes ghosted Avatars and the HabiBot.
   * @returns {Object} Array holding the noid of every Avatar in the same location as the HabiBot
   */
  collectAvatarNoids() {
    var ar = []
    for (var i in this.avatars) {
      if (this.getAvatarNoid() != this.avatars[i].mods[0].noid 
      && this.avatars[i].mods[0].noid < 255) {
        ar.push(this.avatars[i])
      }
    }
    return ar
  }

  /**
   * Returns the direction of a Habitat object relative to the HabiBot's current region
   * position.
   * @param {Object} obj Habitat object to return direction of
   * @returns {string} LEFT, RIGHT, FORWARD, or UNKNOWN
   */
  getDirection(obj) {
    var myAvatar = this.getAvatar()
    if (myAvatar != null && 
        obj != null &&
        'mods' in obj &&
        obj.mods.length > 0) {
      var avatarMod = myAvatar.mods[0]
      var mod = obj.mods[0]
      if ('x' in mod) {
        if (mod.x < avatarMod.x) {
          return constants.LEFT
        } else if (mod.x == avatarMod.x) {
          return constants.FORWARD
        } else {
          return constants.RIGHT
        }
      }
      return constants.UNKNOWN
    }
    return constants.UNKNOWN
  }

  /**
   * Returns the direction of the Habitat object corresponding to the provided noid
   * relative to the HabiBot's current region position.
   * @param {int} noid noid of Habitat object to return direction of
   * @returns {string} LEFT, RIGHT, FORWARD, or UNKNOWN
   */
  getDirectionOfNoid(noid) {
    return this.getDirection(this.getNoid(noid))
  }

  /**
   * Returns the Habitat mod corresponding to a provided noid.
   * @param {int} noid noid of a Habitat object
   * @returns {Object} Habitat mod if an object is found, null otherwise
   */
  getMod(noid) {
    return this.getNoid(noid).mods[0]
  }

  /**
   * Returns the Habitat object corresponding to a provided noid.
   * @param {int} noid noid of a Habitat object
   * @returns {Object} Habitat object is an object is found, null otherwise
   */
  getNoid(noid) {
    if (noid in this.noids) {
      log.debug('Object at noid %d: %j', noid, this.noids[noid])
      return this.noids[noid]
    } else {
      log.error('Could not find noid: %s', noid)
      return null
    }
  }

  /**
   * Moves the HabiBot to the provided context name.
   * @param {string} context Context to move HabiBot to
   * @returns {Promise}
   */
  gotoContext(context) {
    // Changing a context will replace all current bot state with new state from the
    // region we're transitioning from.
    this.clearState()

    return this.send({
      op: 'entercontext',
      to: 'session',
      context: context,
      user: `user-${this.username}`,
    })
  }

  /**
   * Returns true if this HabiBot's Avatar is currently in Ghost form.
   * @returns {boolean}
   */
  isGhosted() {
    var avatar = this.getAvatar()
    if (avatar != null) {
      return avatar.mods[0].amAGhost
    }
    return false
  }

  /**
   * Informs the Neohabitat server that the bot's Avatar is entering a new region via
   * the provided direction and passage. The returned Promise resolves only when
   * the bot's own avatar has actually arrived in the new region (signalled by the
   * `enteredRegion` callback, fired from the inbound `make ... you:true`). If the
   * region transit doesn't complete within `timeoutMillis` (default 15s) the
   * Promise rejects so callers like walkToExit() / wanderTick() see the failure
   * instead of silently looping (issue #506).
   *
   * Pre-fix this resolved as soon as NEWREGION hit the socket — a successful
   * write was indistinguishable from a stuck region transition, and bots that
   * lost their elko session (issue #505) hammered NEWREGION every wanderTick
   * forever without anyone noticing.
   *
   * @param {Number} direction direction from which the bot is entering the new region
   * @param {Number} [timeoutMillis] how long to wait for enteredRegion before rejecting
   * @returns {Promise} resolves on arrival, rejects on send failure or timeout
   */
  newRegion(direction, timeoutMillis) {
    const self = this
    const timeout = typeof timeoutMillis === 'number' ? timeoutMillis : 15000
    // Capture the region we're leaving BEFORE the send. enteredRegion
    // fires from every `make ... you:true` — including the one that
    // arrives after a silent reconnect's re-enter of the SAME context
    // (bridge_v2 issue #505 recovery). Without this guard the listener
    // resolves prematurely on the same-region re-enter, the caller
    // thinks the transit succeeded, and the bot appears to keep
    // walking but never actually leaves the room.
    const startRegion = this._scanForCurrentRegionRef()
    // Pre-register the arrival listener BEFORE the wire write, so we
    // can't race against an unusually fast server (changeContext +
    // make storm + `you:true` arriving before the .then chain attaches).
    const arrivalP = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        self._removeOnce('enteredRegion', onArrived)
        reject(new Error(`newRegion(${direction}) timed out after ${timeout}ms waiting for enteredRegion`))
      }, timeout)
      function onArrived(bot, o) {
        // o.to is the destination region ref on the `make ... you:true`.
        // Ignore same-region arrivals — those are silent reconnects
        // re-entering the room we were already in, NOT the transit we
        // asked for. Keep the listener active so the actual new-region
        // arrival can still resolve.
        const arrivedAt = o && o.to
        if (startRegion && arrivedAt && arrivedAt === startRegion) {
          log.debug('newRegion: ignoring same-region enteredRegion at %s (likely silent reconnect)', arrivedAt)
          return
        }
        clearTimeout(timer)
        self._removeOnce('enteredRegion', onArrived)
        resolve()
      }
      self.on('enteredRegion', onArrived)
    })
    return this.sendWithDelay({
      to: 'ME',
      op: 'NEWREGION',
      direction: direction,
    }, 10000).then(() => arrivalP)
  }

  /**
   * Walk this.history for a Region-typed mod, returning its ref. Used
   * by newRegion() to capture the pre-transit region so the arrival
   * listener can distinguish a real region change from a same-region
   * re-enter (e.g. bridge_v2 silent reconnect).
   */
  _scanForCurrentRegionRef() {
    for (const ref in this.history) {
      const o = this.history[ref]
      if (o && o.obj && o.obj.mods && o.obj.mods[0] && o.obj.mods[0].type === 'Region') {
        return ref
      }
    }
    return ''
  }

  /**
   * Register a callback that fires at most once, then unregisters itself.
   * Used internally for transit-completion synchronization; exposed so
   * other bots can do the same kind of "wait for one event then move on"
   * pattern without leaking listeners.
   * @param {string} eventType Habitat event type (e.g. 'enteredRegion')
   * @param {function} callback fired on first matching event
   */
  once(eventType, callback) {
    const self = this
    function wrapper(...args) {
      self._removeOnce(eventType, wrapper)
      callback(...args)
    }
    this.on(eventType, wrapper)
    return wrapper
  }

  /**
   * Internal: remove a specific callback from an event's callback list.
   * Used by once() and by newRegion()'s timeout path to release its
   * waiter without leaking through to a later region transit.
   */
  _registerOnce(eventType, wrapper) {
    this.on(eventType, wrapper)
  }
  _removeOnce(eventType, target) {
    const list = this.callbacks[eventType]
    if (!list) return
    const idx = list.indexOf(target)
    if (idx >= 0) list.splice(idx, 1)
  }
  
  /**
   * Registers a callback for a Habitat event type, which can include one of the below
   * built-in event types or a Neohabitat server message, such as <tt>APPEARING_$</tt> or
   * <tt>SPEAK$</tt>.
   *
   * <b>Built-in event types:</b>
   * <ul>
   *   <li><b>connected</b> - The HabiBot has connected to the Neohabitat server</li>
   *   <li><b>delete</b> - A Habitat object in the current region has been deleted</li>
   *   <li><b>disconnected</b> - The HabiBot has disconnect from the Neohabitat server</li>
   *   <li><b>enteredRegion</b> - The HabiBot has entered a Habitat region</li>
   *   <li><b>msg</b> - The HabiBot has received a message from the Neohabitat server</li>
   * </ul>
   *
   * Callbacks typically take two parameters, the first being an instance of this HabiBot
   * and the second being the JSON object received from the server, if present:
   *
   * <pre>
   * const HabiBot = require('habibot')
   * const PhilCollinsBot = new HabiBot('127.0.0.1', 1337, 'pcollins')
   * PhilCollinsBot.on('APPEARING_$', (bot, msg) => {
   *   // msg: {"type":"broadcast","noid":0,"op":"APPEARING_$","appearing":170}
   *   var avatar = bot.getNoid(msg.appearing)
   *   bot.say(`Hey ${avatar.name}! I'm Phil Collins.`)
   * })
   * </pre>
   *
   * <b>Please note</b>, the <tt>connected</tt> and <tt>disconnected</tt> callbacks take
   * only one argument:
   *
   * <pre>
   * const HabiBot = require('habibot')
   * const PhilCollinsBot = new HabiBot('127.0.0.1', 1337, 'pcollins')
   * PhilCollinsBot.on('connected', (bot) => {
   *   // Go to the Fountain region upon first connect.
   *   bot.gotoContext('context-Downtown_5f')
   * })
   * </pre>
   * @param {string} eventType Habitat event type
   * @param {function} callback callback to register for provided Habitat event type
   */
  on(eventType, callback) {
    if (eventType in this.callbacks) {
      this.callbacks[eventType].push(callback)
    } else {
      this.callbacks[eventType] = [callback]
    }
  }

  /**
   * Puts the object that the HabiBot is holding onto the provided (x, y) coords
   * @param {int} containerNoid  where the item is being stored 
   * @param {int} x              x coordinate to drop the item
   * @param {int} y              y coordinate to drop the item
   * @param {int} orientation    new orientation when transfered    
   * @returns {Promise}
   */
  putObj(objRef, containerNoid, x, y, orientation) {
    return this.sendWithDelay({
      op: 'PUT',
      to: objRef,
      containerNoid: containerNoid,
      x: x,
      y: y,
      orientation: orientation,
    }, 10000)
  }

  /**
   * Speaks the provided text line within the HabiBot's current region.
   * @param {string} text text to speak
   * @return {Promise}
   */
  say(text) {
    return this.send({
      op: 'SPEAK',
      to: 'ME',
      esp: 0,
      text: text,
    })
  }
  
  /**
   * Sends the provided text in the form of an ESP message.
   * @param {string} text text to speak
   * @return {Promise}
   */
  ESPsay(text) {
    return this.send({
      op: 'ESP',
      to: 'ME',
      esp: 1,
      text: text,
    })
  }
  
  /**
   * Speaks each line provided within an array of Strings within the HabiBot's
   * current region, pausing for 2 seconds between each.
   * @param {array} textLines text lines to speak
   * @return {Promise}
   */
  sayLines(textLines) {
    var self = this
    return Promise.all(textLines.map((line) => {
      return self.sendWithDelay({
        op: 'SPEAK',
        to: 'ME',
        esp: 0,
        text: line
      }, 2000)
    }))
  }
  
  /**
   * 
   * Functions exactly like sayLines, but it sends ESP messages.
   * @param {array} textLines text lines to speak
   * @return {Promise}
   */
  ESPsayLines(textLines) {
    var self = this
    return Promise.all(textLines.map((line) => {
      return self.sendWithDelay({
        op: 'ESP',
        to: 'ME',
        esp: 1,
        text: line
      }, 2000)
    }))
  }

  /**
   * Sends the provided Elko message to the Neohabitat server.
   * @param {Object} obj Elko message to send
   * @returns {Promise}
   */
  send(obj) {
    return this.sendWithDelay(obj, 500)
  }

  /**
   * Sends the provided Elko message to the Neohabitat server after the provided number
   * of delay milliseconds.
   * @param {Object} obj Elko message to send
   * @param {int} delayMillis number of milliseconds to delay by
   * @returns {Promise}
   */
  sendWithDelay(obj, delayMillis) {
    var self = this
    // Cap pre-send delays to keep bots interactive. Original callsites
    // ask for 5s–10s pauses (a relic of the legacy node bridge's slower
    // pacing); bridge_v2 throttles outbound at the wire (--rate=1200)
    // so the bot doesn't need to space itself out to keep elko happy.
    // The actionQueue still serializes, so messages still arrive in
    // order — they just don't sit idle for 10 seconds first. Floored
    // to a small value so callers that explicitly pass 0 still get a
    // tick of breathing room (some elko ops want NOT-instant
    // back-to-back).
    var MAX_PRE_SEND_DELAY_MS = 500
    var clamped = Math.min(Math.max(delayMillis || 0, 50), MAX_PRE_SEND_DELAY_MS)
    return self.actionQueue.add(() => {
      return new Promise((resolve, reject) => {
        if (!self.connected) {
          reject(`Not connected to ${self.host}:${self.port}`)
          return
        }
        if (obj.to) {
          obj.to = self.substituteName(obj.to)
        }
        self.substituteState(obj)
        var msg = JSON.stringify(obj)
        setTimeout(() => {
          log.debug('->SEND@%s:%s [%s]: %s', self.host, self.port, self.username, msg.trim())
          if (self._capture) self._capture.record('send', obj)
          self.server.write(msg + '\n\n', 'UTF8', () => {
            resolve()
          })
        }, clamped)
      })
    })
  }

  /**
   * Tells the HabiBot to "touch" an adjacent Avatar
   * @param {int} 'target' the Avatar that the bot is touching
   * @returns {Promise}
   */
  touchAvatar(noid) {
    return this.sendWithDelay({
      op: 'TOUCH',
      to: 'ME',
      target: noid,
    }, 10000)
  }

  /**
   * Hand whatever this bot is currently holding (HANDS slot) to another
   * adjacent avatar. Wire op is HAND.
   *
   * Elko's Avatar.HAND semantics (see neohabitat
   * src/main/java/org/made/neohabitat/mods/Avatar.java :: HAND):
   *   - The op is addressed to the RECIPIENT's avatar (`to:` = the
   *     receiver's user-ref). The implementation looks at `from` (the
   *     sender) as the giver and `this` (the addressee) as the
   *     receiver.
   *   - Transfer succeeds only if recipient.HANDS is empty AND
   *     giver.HANDS is non-empty AND the giver isn't sitting.
   *   - There is NO `item` parameter — `item` and `target` fields on
   *     the JSON message are silently ignored. The transferred object
   *     is whatever sits in the giver's HANDS slot at call time.
   *
   * Practical implication: a bot that wants to give a specific pocket
   * item must first move it into HANDS (by issuing a GET on the item)
   * before calling giveObject. The itemNoid argument here is informational
   * only — used for logging — and recipientNoid is what we actually need
   * to resolve to the target user-ref.
   *
   * @param {int} itemNoid the noid the bot intends to give (informational)
   * @param {int} recipientNoid the noid of the avatar to hand it to
   * @returns {Promise}
   */
  giveObject(itemNoid, recipientNoid) {
    var recipient = this.getNoid(recipientNoid)
    if (!recipient || !recipient.ref) {
      return Promise.reject(`giveObject: no avatar at noid ${recipientNoid}`)
    }
    return this.sendWithDelay({
      op: 'HAND',
      to: recipient.ref,
    }, 5000)
  }
  
  /**
   * Tells the HabiBot to open a door
   * @param {ref} the door's ref
   * @returns {Promise}
   */
  openDoor(ref) {
    return this.sendWithDelay({
      op: 'OPEN',
      to: ref,
    }, 10000)
  }
  
  /**
   * Tells the HabiBot to close a door
   * @param {ref} the door's ref
   * @returns {Promise}
   */
  closeDoor(ref){
    return this.sendWithDelay({
      op: 'CLOSE',
      to: ref,
    }, 10000)
  }

  sitOrstand(num, chairNoid) {
    return this.sendWithDelay({
      op: 'SITORSTAND',
      to: 'ME',
      up_or_down: num,
      seat_id: chairNoid
    }, 5000)
  }

  // ── Coverage for the remaining Habitat verbs ────────────────────────
  // These are thin wrappers over send/sendWithDelay so any bot can
  // exercise the whole Habitat verb set without re-discovering the
  // wire shape every time. Wire shapes were derived from each verb's
  // @JSONMethod signature in src/main/java/org/made/neohabitat/mods/*.java.
  //
  // Two cross-cutting conventions:
  //   • For item verbs, `to:` is the item's ref (item-… or i-…). Elko
  //     routes the message to the matching mod's handler.
  //   • For avatar-targeting verbs (GRAB), `to:` is the OTHER avatar's
  //     ref; the sender is implicit (`from` = our User).
  //
  // Most helpers use a 500ms sendWithDelay so they slot into the same
  // action queue as the rest. A few that have long-running side effects
  // (mail, vending) get 2000ms to let elko broadcast the result before
  // the next action fires.

  // GRAB — take whatever the other avatar has in HANDS into our HANDS.
  // Counterintuitive `to:` direction: we send the verb TO the giver
  // (we're the implicit caller). Region's grabable() check enforces
  // theft-free zones; otherwise empty-handed-receiver + holding-giver
  // is the only precondition.
  grabFromAvatar(giverNoid) {
    var giver = this.getNoid(giverNoid)
    if (!giver || !giver.ref) {
      return Promise.reject('grabFromAvatar: no avatar at noid ' + giverNoid)
    }
    return this.sendWithDelay({ op: 'GRAB', to: giver.ref }, 500)
  }

  // USERLIST — elko broadcasts the global online-user list to us via
  // object_say. Reply lands as OBJECTSPEAK_$ messages.
  userList() {
    return this.sendWithDelay({ op: 'USERLIST', to: 'ME' }, 500)
  }

  // THROW — fling an item we're holding. target is a noid (avatar to
  // catch, or 0 for "no target — land at x,y"); x/y are landing coords.
  throwObj(itemRef, targetNoid, x, y) {
    return this.sendWithDelay({
      op: 'THROW',
      to: itemRef,
      target: targetNoid || 0,
      x: (x == null) ? 80 : x,
      y: (y == null) ? 144 : y,
    }, 500)
  }

  // ASK — query Crystal_ball, Fountain, or Bureaucrat. Reply arrives as
  // object_say back to us.
  askObject(itemRef, text) {
    return this.sendWithDelay({ op: 'ASK', to: itemRef, text: text || '' }, 500)
  }

  // READ — Book/Paper/Plaque. page=0 means "next page"; positive jumps
  // directly. Reply contents come back as object_say (one page at a time).
  readObject(itemRef, page) {
    return this.sendWithDelay({ op: 'READ', to: itemRef, page: page == null ? 0 : page }, 500)
  }

  // WRITE — overwrite a Paper's contents. text is a regular string; we
  // convert to a 7-bit ASCII int array per the wire format. Pass empty
  // string to clear the paper.
  writePaper(paperRef, text) {
    var ascii = []
    if (text) {
      for (var i = 0; i < text.length; i++) ascii.push(text.charCodeAt(i) & 0x7F)
    }
    return this.sendWithDelay({ op: 'WRITE', to: paperRef, request_ascii: ascii }, 500)
  }

  // PSENDMAIL — send a Paper via mail. Recipient is encoded into the
  // paper itself (no separate addressee on the wire).
  mailPaper(paperRef) {
    return this.sendWithDelay({ op: 'PSENDMAIL', to: paperRef }, 2000)
  }

  // SENDMAIL — drop a paper into a Dropbox for delivery.
  sendMail(dropboxRef) {
    return this.sendWithDelay({ op: 'SENDMAIL', to: dropboxRef }, 2000)
  }

  // ── Device toggles ─────────────────────────────────────────────────
  // ON/OFF apply to Flashlight, Floor_lamp, Movie_camera. Side effects
  // (region lighting, recording state) are managed elko-side.
  deviceOn(itemRef) {
    return this.sendWithDelay({ op: 'ON', to: itemRef }, 500)
  }
  deviceOff(itemRef) {
    return this.sendWithDelay({ op: 'OFF', to: itemRef }, 500)
  }

  // ── Apparel ────────────────────────────────────────────────────────
  // WEAR moves a Head/Ring from HANDS to the corresponding worn slot;
  // REMOVE reverses it. Avatar appearance updates broadcast to neighbors.
  wearItem(itemRef) {
    return this.sendWithDelay({ op: 'WEAR', to: itemRef }, 500)
  }
  removeItem(itemRef) {
    return this.sendWithDelay({ op: 'REMOVE', to: itemRef }, 500)
  }

  // ── Toys / games ───────────────────────────────────────────────────
  windToy(toyRef) {
    return this.sendWithDelay({ op: 'WIND', to: toyRef }, 500)
  }
  // ROLL a die. The server (Die.java) replies to the roller with
  // ROLL_STATE = the new gr_state (the face value, 1..faces), and only
  // broadcasts ROLL$ to NEIGHBORS — so our own roll result arrives in the
  // reply, never as a delta. Read it, update the die's gr_state locally,
  // and return the value so the caller can report it.
  async rollDie(dieRef) {
    const reply = await this.sendForReply({ op: 'ROLL', to: dieRef })
    const value = reply.ROLL_STATE
    if (value !== undefined) {
      const die = this.world.getByRef(this.substituteName(dieRef))
      if (die) die.mod.gr_state = value
    }
    return { ok: value !== undefined, value }
  }
  kingPiece(pieceRef) {
    return this.sendWithDelay({ op: 'KING', to: pieceRef }, 500)
  }

  // ── Magic ──────────────────────────────────────────────────────────
  // RUB the lamp to summon the genie; once genied, WISH with a message.
  // MAGIC is the generic per-class trigger used by wands/staves/amulets/
  // rings/etc. — target is the noid the magic is aimed at (0 = self/no
  // target, depends on the specific item's class).
  rubLamp(lampRef) {
    return this.sendWithDelay({ op: 'RUB', to: lampRef }, 500)
  }
  wishOnLamp(lampRef, text) {
    return this.sendWithDelay({ op: 'WISH', to: lampRef, text: text || '' }, 500)
  }
  useMagic(itemRef, targetNoid) {
    return this.sendWithDelay({ op: 'MAGIC', to: itemRef, target: targetNoid || 0 }, 500)
  }

  // ── Misc world objects ─────────────────────────────────────────────
  // DIRECT a Compass. Compass.java replies (no `err`) with
  //   { text: "WEST: <arrow>" }
  // where <arrow> is a PETSCII direction char pointing the way to the
  // West Pole: 124 '|' = UP, 125 '}' = DOWN, 126 '~' = LEFT, 127 = RIGHT.
  // Translate it to a screen direction so the caller can report it.
  async directCompass(compassRef) {
    const reply = await this.sendForReply({ op: 'DIRECT', to: compassRef })
    const ARROWS = { 124: 'UP', 125: 'DOWN', 126: 'LEFT', 127: 'RIGHT' }
    const text = reply.text || ''
    const arrow = text.charCodeAt(text.length - 1)
    const direction = ARROWS[arrow] || null
    return { ok: true, text, direction }
  }
  // SPRAY paints a body part from a Spray_can held in HANDS. `limb` is
  // the body-part code (Spray_can.java enumerates HEAD/CHEST/etc.).
  //
  // Spray_can.java replies in TWO shapes, neither using `err`:
  //   guard failure (not holding the can / out of charges):
  //     { success: 0|1, custom_1, custom_2 }
  //   main path:
  //     { SPRAY_SUCCESS: 0|1, SPRAY_CUSTOMIZE_0, SPRAY_CUSTOMIZE_1 }
  // In both, success==1 means the spray landed and the two customize
  // bytes are the avatar's new custom[0]/custom[1]. Apply them locally
  // and report failure honestly (the common failure is spraying without
  // the can in HANDS).
  async sprayCan(canRef, limb) {
    const reply = await this.sendForReply({
      op: 'SPRAY', to: canRef, limb: limb == null ? 0 : limb,
    })
    const flag = reply.SPRAY_SUCCESS !== undefined ? reply.SPRAY_SUCCESS : reply.success
    const ok = flag === 1 || flag === true
    const c0 = reply.SPRAY_CUSTOMIZE_0 !== undefined ? reply.SPRAY_CUSTOMIZE_0 : reply.custom_1
    const c1 = reply.SPRAY_CUSTOMIZE_1 !== undefined ? reply.SPRAY_CUSTOMIZE_1 : reply.custom_2
    const me = this.world.me
    if (me && Array.isArray(me.mod.custom)) {
      if (c0 !== undefined) me.mod.custom[0] = c0
      if (c1 !== undefined) me.mod.custom[1] = c1
    }
    return { ok, reason: ok ? undefined : 'spray-failed (need the can in HANDS, or it is empty)' }
  }
  fillBottle(bottleRef) {
    return this.sendWithDelay({ op: 'FILL', to: bottleRef }, 500)
  }
  pourBottle(bottleRef) {
    return this.sendWithDelay({ op: 'POUR', to: bottleRef }, 500)
  }
  digShovel(shovelRef) {
    return this.sendWithDelay({ op: 'DIG', to: shovelRef }, 500)
  }
  feedAquarium(aquariumRef) {
    return this.sendWithDelay({ op: 'FEED', to: aquariumRef }, 500)
  }
  flushCan(canRef) {
    return this.sendWithDelay({ op: 'FLUSH', to: canRef }, 500)
  }
  takeDrug(drugRef) {
    return this.sendWithDelay({ op: 'TAKE', to: drugRef }, 500)
  }
  scanSensor(sensorRef) {
    return this.sendWithDelay({ op: 'SCAN', to: sensorRef }, 500)
  }
  // ZAPTO — Teleport. `port_number` is a string address code (like a
  // phone number — "HOME", "DOWNTOWN", etc.) matching the booth's
  // `address` field. The server requires a String, not an integer.
  zapToPort(deviceRef, portNumber) {
    return this.sendWithDelay({ op: 'ZAPTO', to: deviceRef, port_number: String(portNumber || '') }, 500)
  }

  // ── Dangerous / one-shot ───────────────────────────────────────────
  // Sage's persona may genuinely want these (an old-timer demonstrating
  // a stun gun, lighting a fake-gun gag) so they're exposed. Each carries
  // an in-world cost or side effect; bots that don't want them just
  // don't call them.
  stunAvatar(gunRef, targetNoid) {
    return this.sendWithDelay({ op: 'STUN', to: gunRef, target: targetNoid }, 500)
  }
  // PULLPIN on a Grenade. Grenade.java replies { PULLPIN_SUCCESS } (1/0,
  // not `err`). It only succeeds if you are HOLDING the grenade, the pin
  // isn't already pulled, and you're not in a weapons-free zone — so a
  // failure almost always means hands weren't on it. Surface that.
  async pullGrenadePin(grenadeRef) {
    const reply = await this.sendForReply({ op: 'PULLPIN', to: grenadeRef })
    const ok = reply.PULLPIN_SUCCESS === 1 || reply.PULLPIN_SUCCESS === true
    return {
      ok,
      reason: ok ? undefined
        : 'pin not pulled — you must be HOLDING the grenade (pick_up first), the pin must not already be out, and it must not be a weapons-free zone',
    }
  }
  fakeShoot(gunRef) {
    return this.sendWithDelay({ op: 'FAKESHOOT', to: gunRef }, 500)
  }
  // ATTACK fires a REAL weapon (Gun/Sword/etc., anything extending
  // Weapon) at a target noid — distinct from FAKESHOOT, which only the
  // gag Fake_gun answers (a real Gun silently ignores FAKESHOOT). The
  // server replies { ATTACK_target, ATTACK_result }: result 0 = no effect
  // (missed, out of range, or a weapons-free zone), non-zero = a hit of
  // that damage level, and the top value = a kill. Read it so the caller
  // knows whether the shot actually landed instead of assuming it did.
  async attack(weaponRef, targetNoid) {
    const reply = await this.sendForReply({ op: 'ATTACK', to: weaponRef, pointed_noid: targetNoid })
    const result = reply.ATTACK_result
    return { ok: !!result, result, target: reply.ATTACK_target }
  }
  resetFakeGun(gunRef) {
    return this.sendWithDelay({ op: 'RESET', to: gunRef }, 500)
  }
  bugOut(deviceRef) {
    return this.sendWithDelay({ op: 'BUGOUT', to: deviceRef }, 500)
  }
  sexChange(deviceRef) {
    return this.sendWithDelay({ op: 'SEXCHANGE', to: deviceRef }, 500)
  }

  // ── Commerce ───────────────────────────────────────────────────────
  // DEPOSIT — feed a Tokens stack (by noid) into an Atm. The Atm
  // destroys the Tokens object and credits the avatar's bank balance.
  depositToAtm(atmRef, tokenNoid) {
    return this.sendWithDelay({ op: 'DEPOSIT', to: atmRef, token_noid: tokenNoid }, 500)
  }
  // WITHDRAW — Atm spawns a fresh Tokens stack in our HANDS for the
  // requested amount (16-bit little-endian split into lo/hi bytes).
  withdrawFromAtm(atmRef, amount) {
    amount = amount || 0
    return this.sendWithDelay({
      op: 'WITHDRAW',
      to: atmRef,
      amount_lo: amount & 0xff,
      amount_hi: (amount >> 8) & 0xff,
    }, 500)
  }
  // PAY — Coke_machine / Fortune_machine / Teleport. The machine charges a
  // fixed price by spending a TOKENS item the avatar is HOLDING IN HANDS
  // (Tokens.spend → avatar.heldObject must be CLASS_TOKENS). It does NOT
  // touch the bank balance, and pocket-stored tokens don't count — you must
  // be holding tokens. Reply is { err, amount_lo, amount_hi }: err 1 = paid,
  // 0 = not enough money (no tokens in HANDS / not enough); amount = price.
  //
  // IMPORTANT: paying does NOT imply anything is dispensed. A Coke_machine
  // (the "Choke" gag) charges you, plays an OPERATE/CHUNK animation, and
  // hands you nothing — that's the joke. Return the facts so the caller
  // reports truthfully instead of inventing a drink.
  async payMachine(machineRef) {
    const reply = await this.sendForReply({ op: 'PAY', to: machineRef })
    const paid = !!reply.err
    const amount = (reply.amount_lo || 0) + (reply.amount_hi || 0) * 256
    return {
      ok: paid,
      amount,
      reason: paid ? undefined : 'not enough money — you must be HOLDING a Tokens item worth at least the price (bank balance does not count)',
    }
  }
  // VEND — buy the currently-displayed item from a Vendo_front (charged
  // against pocket Tokens). VSELECT cycles through what's on display
  // for a multi-slot vendo.
  vendItem(vendoFrontRef) {
    return this.sendWithDelay({ op: 'VEND', to: vendoFrontRef }, 2000)
  }
  selectVendo(vendoFrontRef) {
    return this.sendWithDelay({ op: 'VSELECT', to: vendoFrontRef }, 500)
  }
  // MUNCH — Pawn_machine eats the HANDS item and credits bank balance.
  munchPawn(machineRef) {
    return this.sendWithDelay({ op: 'MUNCH', to: machineRef }, 2000)
  }
  /**
   * Returns a list of all cardinal directions from this region which connect to other
   * regions, useful when determining an exit when calling walkToExit.
   */
  travelableDirections() {
    const o = this.orientation || 0
    return this.neighbors
      .map((neighbor, i) => neighbor !== '' ? SCREEN_DIRS[(i + 5 - o) % 4] : null)
      .filter(d => d !== null)
  }
  
  /**
   * Returns the realm of the Habibot's current region.
   */
  currentRealm() {
    return this.realm  
  }

  /**
   * Waits for the provided number of milliseconds, resolving the returned Promise.
   * @param {int} millis number of milliseconds to wait
   * @returns {Promise} promise to be resolved after waiting
   */
  wait(millis) {
    var self = this
    return this.actionQueue.add(() => {
      return new Promise((resolve, reject) => {
        log.debug('Bot @%s:%d waiting %d milliseconds', self.host, self.port, millis)
        setTimeout(() => {
          resolve()
        }, millis)
      })
    })
  }

  /**
   * Walks the HabiBot's Avatar to the provided (x, y) coordinates.
   * @param {int} x    coordinate to walk to
   * @param {int} y    coordinate to walk to
   * @param {int} how  direction Avatar is facing
   * @returns {Promise}
   */
  walkTo(x, y, how) {
    return this.sendWithDelay({
      op: 'WALK',
      to: 'ME',
      x: x,
      y: y,
      how: how,
    }, 10000)
  }

  /**
   * Sends a request and resolves with its type:"reply" message — the
   * C64's getResponse. Habitat is a single-request-in-flight protocol
   * (actionQueue serializes sends), so the next reply after our write
   * is ours.
   *
   * The pending listener is registered AFTER the write completes: any
   * reply already in flight from an earlier fire-and-forget send (e.g.
   * the WALK inside an action recipe) arrives while nothing is pending
   * and is dropped, instead of being mistaken for our reply. Our own
   * reply can't be missed by this ordering — registration happens in a
   * microtask, which always runs before the socket's next data event.
   *
   * @param {Object} msg Elko request to send
   * @param {Number} [timeoutMillis] how long to wait for the reply (default 10s)
   * @returns {Promise<Object>} resolves with the reply JSON, rejects on timeout
   */
  sendForReply(msg, timeoutMillis) {
    const self = this
    const timeout = typeof timeoutMillis === 'number' ? timeoutMillis : 10000
    return this.send(msg).then(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (self._pendingReply === onReply) self._pendingReply = null
        reject(new Error(`sendForReply(${msg.op}) timed out after ${timeout}ms waiting for reply`))
      }, timeout)
      function onReply(reply) {
        clearTimeout(timer)
        resolve(reply)
      }
      self._pendingReply = onReply
    }))
  }

  /**
   * The C64 client's animation wait (waitWhile animation_wait_bit /
   * asyncAnimationWait): bots have no animation engine, so this is a
   * plain pause the action recipes use to let walks and chores "play
   * out" before firing the next step of a goToAnd* script.
   * @param {Number} [millis] pause length, default 1000
   * @returns {Promise}
   */
  animationWait(millis) {
    const ms = typeof millis === 'number' ? millis : 1000
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Runs a habiworld action recipe — the C64 goToAnd* choreography:
   * preconditions checked against the world model, walk to the target,
   * wait out the walk animation, send the request, apply the state
   * change locally on a success reply. Verbs: 'GET' {noid}, 'PUT'
   * {x, y}, 'HAND' {noid}.
   *
   * Resolves {ok, reason?}: in-world failures (hands full, server
   * denial) are outcomes, not rejections; only transport errors reject.
   *
   * @param {String} verb action recipe name
   * @param {Object} opts recipe arguments (see above)
   * @returns {Promise<{ok: boolean, reason: ?string}>}
   */
  performAction(verb, opts) {
    return worldActions.perform(this.world, verb, opts, this.worldClient())
  }

  /**
   * Class-dispatched verb, straight through habiworld's behavior table:
   * the C64 user-verb slots (DO/RDO/GO/STOP/GET/PUT/TALK/DESTROY — use
   * habiworld constants.ACTION_*). DO on a flashlight toggles it, GO on
   * a chair sits (and stands), DO on a jukebox flips its catalog —
   * whatever new.mud says the class does.
   *
   * @param {int} verb   action slot (constants.ACTION_*)
   * @param {int} noid   target object noid
   * @param {Object} args verb arguments (x/y, amount, text, itemNoid...)
   * @returns {Promise<{ok: boolean, reason: ?string}>}
   */
  performVerb(verb, noid, args) {
    return worldDispatch(this.world, verb, noid, args || {}, this.worldClient())
  }

  /**
   * The client-callback set habiworld behaviors run against — shared by
   * performAction and performVerb.
   */
  worldClient() {
    const self = this
    return {
      // Walk to the exact coordinates given by the behavior (adjacentCoords
      // has already computed the precise stand-spot; no sidestep here).
      // The WALK reply carries the server-confirmed destination; return it
      // so the recipe can track position and scale the walk-animation wait.
      walkTo: (x, y) => {
        const how = x <= 80 ? 0 : 1
        return self.sendForReply({ op: 'WALK', to: 'ME', x, y, how })
          .then((reply) => ({
            x: reply.x !== undefined ? reply.x : x,
            y: reply.y !== undefined ? reply.y : y,
          }))
      },
      send: (msg) => self.sendForReply(msg),
      animationWait: (ms) => self.animationWait(ms),
      // Balloon text (read results, key numbers, oracle answers) is the
      // bot's eyes — log it so sage's tool results can surface it.
      balloon: (text) => {
        if (text) log.debug('balloon [%s]: %s', self.username, text)
      },
      // Region transit for pass-through doors and sky/wall exits.
      // The behavior has already walked to the exit; just send NEWREGION.
      // Direction math mirrors walkToExit's formula: newRegionDirection =
      //   (k - 2*orientation + 9) % 4   where k = up=0, right=1, down=2, left=3.
      changeRegion: (direction) => {
        const DIR = { up: 0, right: 1, down: 2, left: 3 }
        const k = DIR[String(direction).toLowerCase()]
        if (k === undefined) return Promise.resolve({ ok: false, reason: 'unknown-direction' })
        const o = self.orientation || 0
        const newRegionDirection = (k - 2 * o + 9) % 4
        return self.sendForReply({ op: 'NEWREGION', to: 'ME', direction: newRegionDirection })
          .then(() => ({ ok: true }))
      },
    }
  }

  /**
   * Walks the bot's Avatar to a screen-side exit in the current region.
   * @param {String} direction  UP | RIGHT | DOWN | LEFT (screen position of the exit)
   * @returns {Promise}
   *
   * Screen coordinates are fixed regardless of region orientation:
   *   UP    → walkTo(80,  160, 0)   RIGHT → walkTo(156, 142, 1)
   *   DOWN  → walkTo(80,  128, 0)   LEFT  → walkTo(0,   142, 1)
   *
   * The NEWREGION direction value must account for orientation so the
   * server's formula (direction + orientation + 2) % 4 indexes the right
   * neighbors slot. With k = screen-dir index (UP=0,RIGHT=1,DOWN=2,LEFT=3):
   *   newRegion((k - 2*orientation + 9) % 4)
   *
   * Exit existence is checked via map index (k - orientation + 7) % 4.
   */
  walkToExit(direction) {
    const o = this.orientation || 0
    // Screen-direction coords indexed by k (UP=0, RIGHT=1, DOWN=2, LEFT=3).
    const WALK = [[80, 160, 0], [156, 142, 1], [80, 128, 0], [0, 142, 1]]
    const COMPASS_MAP = { NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3 }

    let k
    const si = SCREEN_DIRS.indexOf(direction)
    if (si >= 0) {
      // Screen direction: position is known, orientation determines neighbor.
      k = si
    } else if (COMPASS_MAP[direction] !== undefined) {
      // Compass direction: orientation determines both screen side and neighbor.
      k = (COMPASS_MAP[direction] + 5 - o) % 4
    } else {
      return Promise.reject(`Bot given invalid direction: ${direction}`)
    }

    const mapIdx = (k + o + 3) % 4
    const target = this.neighbors && this.neighbors[mapIdx]
    if (!target || target.length < 1) {
      return Promise.reject(`Could not find a region to the: ${direction}`)
    }
    const [x, y, how] = WALK[k]
    return this.walkTo(x, y, how).then(() => this.newRegion((k + 1) % 4))
  }

  /**
   * Returns true if there is an exit in the given direction (screen or compass).
   * Uses the same orientation logic as walkToExit so callers don't duplicate it.
   */
  canExit(direction) {
    const o = this.orientation || 0
    const COMPASS_MAP = { NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3 }
    const si = SCREEN_DIRS.indexOf(direction)
    let k
    if (si >= 0) {
      k = si
    } else if (COMPASS_MAP[direction] !== undefined) {
      k = (COMPASS_MAP[direction] + 5 - o) % 4
    } else {
      return false
    }
    const mapIdx = (k + o + 3) % 4
    const target = this.neighbors && this.neighbors[mapIdx]
    return !!(target && target.length > 0)
  }

  /**
   * Walks the bot's Avatar to a random exit adjacent to the current region.
   * @returns {Promise}
   */
  walkToRandomExit() {
    var travelableDirections = this.travelableDirections()
    if (travelableDirections.length === 0) {
      return Promise.reject('No exits exist from the current region.')
    }
    return this.walkToExit(travelableDirections.random())
  }
  
  walkToAvatar(avatar) {
    const ax = avatar.mods[0].x
    const ay = avatar.mods[0].y
    const how = ax <= 80 ? 0 : 1
    const tx = ax <= 80 ? ax + 20 : ax - 20
    return this.walkTo(tx, ay, how)
  }

  // Private methods:

  /**
   * Tracks an Elko object in <tt>names</tt> by all subsections of its ref for ease of
   * shorthand reference.
   */
  addNames(s) {
    var self = this
    s.split('-').forEach((dash) => {
      self.names[dash] = s
      dash.split('.').forEach((dot) => {
        self.names[dot] = s
      })
    })
  }

  /**
   * Clears all shorthand references to an Elko object.
   */
  clearNames(s) {
    var self = this
    s.split('-').forEach((dash) => {
      delete self.names[dash]
      dash.split('.').forEach((dot) => {
        delete self.names[dot]
      })
    })
  }

  /**
   * Clears all local HabiBot state.
   */
  clearState() {
    this.names = {}
    this.history = {}
    this.noids = {}
    this.avatars = {}
    this.neighbors = {}
    this.realm = {}
    this.orientation = 0
    if (this.world) this.world.clear()
  }

  onDisconnect() {
    // Idempotent: 'end' followed by 'error' (or vice versa) on the same
    // dead socket would otherwise schedule two reconnects and double the
    // disconnect callback fan-out.
    if (!this.connected && this._disconnectFiredAt &&
        Date.now() - this._disconnectFiredAt < 100) {
      return
    }
    this._disconnectFiredAt = Date.now()
    log.info('Disconnected from server @%s:%d...', this.host, this.port)
    this.connected = false

    log.debug('Running callbacks for disconnect @%s:%d', this.host, this.port)
    for (var i in this.callbacks.disconnected) {
      this.callbacks.disconnected[i](this)
    }

    if (this.config.shouldReconnect) {
      // Exponential backoff capped at 30s. Reset to 1s on successful
      // connect (see connect()). Without backoff, every failed reconnect
      // attempt synchronously triggers another 'error' → onDisconnect →
      // connect, which spins the event loop and floods logs.
      var delay = this.reconnectDelayMs || 1000
      log.debug('Scheduling reconnect in %dms', delay)
      setTimeout(() => this.connect(), delay)
      this.reconnectDelayMs = Math.min(delay * 2, 30000)
    }
  }

  processData(buffer) {
    var self = this;
    util.parseElko(buffer).forEach((message) => {
      log.debug('<-RCVD@%s:%s [%s]: %s', self.host, self.port, self.username, JSON.stringify(message));
      if (self._capture) self._capture.record('recv', message)
      this.processElkoMessage(message);
    });
  }

  processElkoMessage(o) {
    if (o.to) {
      this.addNames(o.to)
    }

    if (o === null) {
      return;
    }

    // Request replies (type:"reply", no op). Habitat is a single-
    // request-in-flight protocol (the C64's getResponse blocks until
    // the reply lands), so the next reply belongs to whoever is waiting
    // in sendForReply. The world model never consumes replies — the
    // state effects of our OWN requests are applied by the habiworld
    // action recipes on a success reply, mirroring the C64's
    // getResponse → changeContainers pattern.
    if (o.type === 'reply') {
      if (this._pendingReply) {
        const pending = this._pendingReply
        this._pendingReply = null
        pending(o)
      }
      return;
    }

    this.world.apply(o)

    // Region transition. Elko sends `{type: "changeContext", context: ..., immediate: ...}`
    // when the avatar's location changes (e.g. after a NEWREGION walk). The
    // server then streams a fresh batch of `make` messages for the new
    // region's contents. Without resetting our local state here, old
    // noids/avatars/neighbors from the previous region linger and collide
    // with the new region's noids — leaving the bot's world model
    // incoherent. (This was the "bot gets super screwed up on region
    // transition" bug. gotoContext() already does this explicitly because
    // it knows it's about to transition; `newRegion()` walks rely on the
    // server-initiated path here.)
    if (o.type === 'changeContext') {
      log.debug('changeContext[%s] to %s — clearing local region state', this.username, o.context)
      this.clearState()
      return;
    }

    // AUTO_TELEPORT_$ is elko's "you've been teleported, finish the
    // transition" notification — fired when something other than the
    // user initiated the move (accept-invite, /j accept, magic items,
    // turfsetting, etc). The legacy C64 firmware responds by sending
    // NEWREGION direction=AUTO_TELEPORT_DIR (4); elko then reads the
    // pre-saved `to_region` and emits the actual changeContext, kicking
    // off the standard region-transit cycle. Without this auto-response
    // the bot just sits where it was while elko thinks it teleported —
    // visible as "OK, joining X..." with no actual movement.
    //
    // direction=4 (AUTO_TELEPORT_DIR) is the magic value Avatar.NEWREGION
    // checks for; passage_id=0 because there's no door involved.
    if (o.op === 'AUTO_TELEPORT_$') {
      log.debug('AUTO_TELEPORT_$ received — completing teleport via NEWREGION direction=4')
      this.newRegion(4).catch((err) => {
        log.warn('AUTO_TELEPORT_$ followup newRegion failed: %s', err)
      })
      return;
    }

    // If this is not a state-modifying Elko message, ignores it.
    if (!o.op) {
      return;
    }

    // HEREIS does not use the same params as make. TODO fix one day.
    if (o.op === 'HEREIS_$') {
      o.obj = o.object
    }

    // Adds the object to this Habibot's state if it specifies a 'make' operation.
    if (o.op === 'make' || o.op == 'HEREIS_$') {
      var ref = o.obj.ref
      this.addNames(ref)
      this.history[ref] = o
      if ('mods' in o.obj && o.obj.mods.length > 0) {
        // Stash the message's `to` field as a non-public _container
        // marker so a bot can later answer "what's in my pockets?" by
        // walking noids and matching _container against its own
        // user-ref. Elko's wire format uses `to` to express the
        // container relationship: items in the avatar's hand have
        // to=user-X-..., items lying in the region have
        // to=context-...-..., items inside an open box have
        // to=item-box-... etc. Underscore-prefix to signal "client-
        // side bookkeeping, never sent back to server."
        o.obj._container = o.to
        this.noids[o.obj.mods[0].noid] = o.obj
      }
      if (o.you) {
        var split = ref.split('-')
        this.names.ME = ref
        this.names.USER = `${split[0]}-${split[1]}`
        // Shadow-model sanity trace: habiworld should have seen the same
        // you:true make (world.apply runs first), so me must be set and
        // object counts should track the legacy noid table.
        log.debug('habiworld[%s]: me=%s (noid %s); world objects=%d, legacy noids=%d',
          this.username,
          this.world.me ? this.world.me.ref : 'NOT SET',
          this.world.me ? this.world.me.noid : '-',
          this.world.objects.size,
          Object.keys(this.noids).length)
        log.debug('Running callbacks for enteredRegion')
        this.callbacks.enteredRegion.forEach((callback) => {
          callback(this, o)
        })
      }
      if (o.obj.mods[0].type === 'Ghost') {
        this.names.GHOST = ref
      }
      if (o.obj.mods[0].type === 'Avatar') {
        this.avatars[o.obj.name] = o.obj
      }
      if (o.obj.mods[0].type === 'Region') {
        this.neighbors = o.obj.mods[0].neighbors
        this.realm = o.obj.mods[0].realm
        this.orientation = o.obj.mods[0].orientation || 0
      }
    }

    // Another avatar walked — update their tracked position so walkToAvatar
    // uses fresh coords instead of the frozen make-message snapshot.
    if (o.op === 'WALK$') {
      const obj = this.noids[o.noid]
      if (obj && obj.mods && obj.mods[0]) {
        obj.mods[0].x = o.x
        obj.mods[0].y = o.y
      }
    }

    // Removes the local object reference if a delete message has been sent.
    if (o.op === 'delete') {
      var obj = this.history[o.to]
      this.clearNames(o.to)
      // obj can be undefined: the server reaps ghost avatars from PRIOR
      // sessions on reconnect, broadcasting deletes for refs this bot
      // never saw a make for. Unguarded, `'obj' in undefined` threw and
      // killed the process — supervisor restarted it, the fresh session
      // triggered another ghost reap, and every bot in the region
      // crash-looped on each other's reap broadcasts.
      if (obj && 'obj' in obj && obj.obj.mods[0].type === 'Avatar') {
        delete this.avatars[obj.obj.name]
      }
      delete this.history[o.to]
    }

    // MAILARRIVED$ detection. Elko does NOT ship a dedicated op for the
    // "* You have MAIL in your pocket. *" notification — Avatar.send_mail_arrived
    // (mods/Avatar.java) just object_says the literal string from the
    // recipient's own avatar noid (OBJECTSPEAK_$, speaker = self). We
    // promote this into a real `mailArrived` callback so bots can react
    // without sniffing every OBJECTSPEAK_$ themselves. Matching on BOTH
    // self-speaker AND the literal "You have MAIL" substring avoids
    // false positives from /h, /online, and other self-routed system msgs.
    if (o.op === 'OBJECTSPEAK_$' && o.text && o.text.indexOf('You have MAIL') !== -1) {
      const myNoid = this.getAvatarNoid()
      if (myNoid !== -1 && o.speaker === myNoid && 'mailArrived' in this.callbacks) {
        log.debug('MAILARRIVED detected — firing mailArrived callbacks')
        for (var i in this.callbacks.mailArrived) {
          this.callbacks.mailArrived[i](this, o)
        }
      }
    }

    // If the operation specified by this Elko message is within this Habibot's callbacks,
    // calls it.
    if (o.op in this.callbacks) {
      log.debug('Running callbacks for op: %s', o.op)
      for (var i in this.callbacks[o.op]) {
        this.callbacks[o.op][i](this, o)
      }
    }

    // Calls callbacks that receive all general messages.
    for (var i in this.callbacks.msg) {
      this.callbacks.msg[i](this, o)
    }

    return o
  }

  /**
   * 
   * @param String s The message to be scanned for references ('ref's)
   */
  substituteName(s) {
    return this.names[s] || s
  }

  /**
   * Telko supports a special state substitution. Any string that starts with "$" will trigger a lookup of the 
   * state via the this.names table. Example "$randy.obj.mod[0].x" will lookup "randy"'s formal ref in the $Names
   * table, then the value of this.history.user-randy-1230958410291.obj.mod[0].x will be substituted. All substitutions will
   * occur in place.
   * 
   * @param {Object} m The object/message that will have it's parameters ($) substituted.
   */
  substituteState(m) {
    for (var name in m) {
      if(m.hasOwnProperty(name)) {
        var prop = m[name]
        if ((typeof prop === 'string' || prop instanceof String) && prop.indexOf('$') !== -1) {
          var chunks = prop.split("$")
          for (var i = 1; i < chunks.length; i++) {
            var value  = chunks[i]
            var keys   = chunks[i].split('.')
            var first  = true
            var obj
            var mod
            for (var j = 0; j < keys.length; j++) {
              var varseg = keys[j]
              if (first) {
                value = this.history[this.substituteName(varseg)]
                if (undefined === value) {
                  // No matching object, so substitute the key's value.
                  value = this.names[varseg] || chunks[i]
                  break
                }
                if (undefined !== value.obj) {
                  obj = value.obj
                  if (undefined !== obj.mods & obj.mods.length === 1) {
                    mod = obj.mods[0]
                  }
                }
                first = false
              } else {
                value = (undefined !== mod && undefined !== mod[varseg]) ? mod[varseg] :
                  (undefined !== obj && undefined !== obj[varseg]) ? obj[varseg] :
                    value[varseg]
              }
            }
            chunks[i] = value
          }
          if (chunks.length === 2 && chunks[0] === "") {
            // This preserves integer types, which have no leading chars.
            m[name] = chunks[1]
          } else {
            // For in-string substitutions. 
            m[name] = chunks.join("")
          }
        }
      }
    }
  }

  tryEnsureCorporated(curTry) {
    var self = this
    if (self.isGhosted()) {
      // If the Avatar is in ghost form but their Ghost object has not yet
      // come down the wire, retries up to 5 times, every 2 seconds.
      if (!('GHOST' in self.names)) {
        return new Promise((resolve, reject) => {
          if (curTry < 5) {
            setTimeout(() => {
              self.ensureCorporated(curTry + 1)
                .then(() => { resolve() })
                .catch((reason) => { reject(reason) })
            }, 2000)
          } else {
            reject('Could not ensure corporation after 5 tries.')
          }
        })
      }
      return this.corporate()
    }
    return Promise.resolve()
  }

}


module.exports = HabiBot
