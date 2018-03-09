const net = require('net');

const log = require('winston');

const ActionTypes = require('./actionTypes');


function stringifyID(socket) {
  return '' + socket.remoteAddress + ':' + socket.remotePort;
}


class HabitatSession {
  constructor(elkoHost, elkoPort, client) {
    this.elkoHost = elkoHost;
    this.elkoPort = elkoPort;

    this.client = client;
    this.avatarContext = null;
    this.avatarObj = null;
    this.avatarName = 'unknown';
    this.elkoConnection = null;
    this.region = 'unknown';
    this.regionContents = {};

    this.clientAttached = false;
    this.elkoAttached = false;
    this.connected = false;
    this.ready = false;

    this.updatedAt = Math.round((new Date()).getTime() / 1000);

    this.clearCallbacks();
  }

  attachClient() {
    if (!this.clientAttached) {
      // Begins listening for client events.
      this.client.on('data', this.handleClientData.bind(this));
      this.client.on('end', this.handleClientDisconnect.bind(this));
      this.clientAttached = true;
    }
  }

  attachElko() {
    if (!this.elkoAttached) {
      // Begins listening for Elko events.
      this.elkoConnection.on('data', this.handleElkoData.bind(this));
      this.elkoConnection.on('end', this.handleElkoDisconnect.bind(this));
      this.elkoAttached = true;
    }
  }

  handleElkoDisconnect() {
    log.debug('Elko disconnected for client %s, moving session to ASLEEP', this.id());
    this.handleProxyDisconnect();
  }

  handleClientDisconnect() {
    log.debug('Client disconnected for client %s, moving session to ASLEEP', this.id());
    this.handleProxyDisconnect();
  }

  avatarHealth() {
    if (this.avatarObj === null) {
      return 'Unknown';
    }
    if (this.avatarObj.mods[0].health > 200) {
      return 'Peak';
    } else if (this.avatarObj.mods[0].health > 150) {
      return 'Good';
    } else if (this.avatarObj.mods[0].health > 100) {
      return 'Fair';
    } else if (this.avatarObj.mods[0].health > 50) {
      return 'Poor';
    } else {
      return "Near Death";
    }
  }

  avatarOrientation() {
    if (this.avatarContext === null) {
      return 'Unknown';
    }
    switch (this.avatarContext.mods[0].orientation) {
      case 0:
        return 'West';
      case 1:
        return 'North';
      case 2:
        return 'East';
      case 3:
        return 'West';
      default:
        return 'Unknown';
    }
  }

  ensureElkoConnected() {
    if (!this.connected || this.elkoConnection === null) {
      // Opens a connection to Elko and begins listening for events.
      this.elkoAttached = false;
      this.elkoConnection = new net.Socket();
      this.elkoConnection.connect(this.elkoPort, this.elkoHost,
        this.handleElkoConnect.bind(this));
      this.attachElko();
      this.connected = true;
    }
  }

  start() {
    this.ensureElkoConnected();
    this.attachClient();
    this.attachElko();
  }

  // Wakes up an asleep Habitat session with the contents of a freshly-ready session.
  resume(readySession) {
    readySession.detachClient();
    readySession.detachElko();
    readySession.clearCallbacks();

    this.client = readySession.client;

    this.avatarContext = readySession.avatarContext;
    this.avatarObj = readySession.avatarObj;
    this.avatarName = readySession.avatarName;
    this.elkoConnection = readySession.elkoConnection;
    this.region = readySession.region;
    this.regionContents = readySession.regionContents;

    this.clientAttached = false;
    this.elkoAttached = false;
    this.connected = true;
    this.ready = true;

    this.updatedAt = Math.round((new Date()).getTime() / 1000);

    this.ensureElkoConnected();
    this.attachClient();
    this.attachElko();
    this.fireEnteredRegion();

    return this;
  }

  avatarRegion() {
    if (this.avatarContext === null) {
      return 'unknown';
    }
    return this.avatarContext.ref.split('-')[1];
  }

  clearCallbacks() {
    this.callbacks = {
      connected: [],
      delete: [],
      disconnected: [],
      enteredRegion: [],
      msg: [],
      sessionReady: [],
    };
  }

  detachClient() {
    this.client.removeAllListeners();
    this.clientAttached = false;
  }

  detachElko() {
    this.elkoConnection.removeAllListeners();
    this.elkoAttached = false;
  }

  doAction(action) {
    if (!this.ready) {
      console.info('Tried to do action %s on unready session: %s',
        JSON.stringify(action), this.id());
      return false;
    }
    log.debug('Performing ACTION on session %s: %s', this.id(), JSON.stringify(action));
    switch (action.type) {
      case ActionTypes.START_ESP:
        return this.sendMessage({
          "to": this.avatarObj.ref,
          "op": "SPEAK",
          "esp": 0,
          "text": "to:"+action.params.avatar,
        });
      case ActionTypes.SEND_TELEPORT_INVITE:
        return this.sendMessage({
          "to": this.avatarObj.ref,
          "op": "SPEAK",
          "esp": 0,
          "text": "/i "+action.params.avatar,
        });
      case ActionTypes.SEND_TELEPORT_REQUEST:
        return this.sendMessage({
          "to": this.avatarObj.ref,
          "op": "SPEAK",
          "esp": 0,
          "text": "/j "+action.params.avatar,
        });
      default:
        log.error('Unknown action type: %s', action.type);
        return false;
    }
  }

  fireEnteredRegion() {
    for (var i in this.callbacks.enteredRegion) {
      log.debug('Running callbacks for enteredRegion %s on: %s',
        this.avatarRegion, this.id());
      this.callbacks.enteredRegion[i](this, this.avatarRegion);
    }
  }

  // Proxies any data from the client to this session's Elko connection.
  handleClientData(buffer) {
    log.debug('%s -> %s', this.id(), buffer);
    try {
      this.elkoConnection.write(buffer);
    } catch (err) {
      log.error('Unable to write to Elko connection: %s', err)
    }
  }

  // Proxies data between the session's Elko connection to the client, then processes
  // the JSON message sent from Elko to both set session state and trigger any assigned
  // callbacks.
  handleElkoData(buffer) {
    // Sends the Elko message to this session's client.
    log.debug('%s -> %s', buffer, this.id());
    try {
      this.client.write(buffer);
    } catch (err) {
      log.error('Unable to write to client: %s', err)
    }

    // Parses Elko message; if we receive bad data from Elko, terminates this session.
    var messages = buffer.toString('utf8').split('\n');
    for (var i in messages) {
      var message = messages[i];
      if (message.length == 0) {
        continue;
      }
      try {
        var parsedMessage = JSON.parse(message);
      } catch (err) {
        log.error('JSON failed to parse, ignoring: "%s" %s', message, err);
        continue;
      }
      this.processMessage(parsedMessage);
    }
  }

  handleProxyDisconnect() {
    log.debug('Disconnecting Habiproxy connection on: %s', this.id());

    this.detachClient();
    this.detachElko();

    var shouldFireDisconnected = false;
    if (this.connected) {
      shouldFireDisconnected = true;
    }
    
    if (this.client !== null) {
      this.client.end();
      this.client = null;
    }

    if (this.elkoConnection !== null) {
      this.elkoConnection.destroy();
      this.elkoConnection = null;
    }

    this.connected = false;
    this.ready = false;

    if (shouldFireDisconnected) {
      for (var i in this.callbacks.disconnected) {
        log.debug('Running callback for session disconnected on: %s', this.id());
        this.callbacks.disconnected[i](this);
      }
    }
  }

  handleElkoConnect() {
    log.debug('Elko connection established on: %s', this.id());
    this.connected = true;
    for (var i in this.callbacks.connected) {
      log.debug('Running callback for session connected on: %s', this.id());
      this.callbacks.connected[i](this);
    }
  }

  id() {
    if (this.client !== null) {
      return stringifyID(this.client) + ' (' + this.avatarName + ')';
    } else {
      return 'DISCONNECTED (' + this.avatarName + ')';
    }
  }

  on(eventType, callback) {
    if (eventType in this.callbacks) {
      this.callbacks[eventType].push(callback);
    } else {
      this.callbacks[eventType] = [callback];
    }
  }

  processMessage(message) {
    log.debug('Processing Elko message for client %s: %s',
      this.id(), JSON.stringify(message));

    // Populates the region's contents for the current Habitat session.
    if (message.op === 'make') {
      // If this is a new context, tracks it within this session for ease of rendering.
      if (message.obj.type === 'context') {
        this.avatarContext = message.obj;
      }
      this.regionContents[message.obj.ref] = message.obj;
    }

    // If the Elko message indicates that it is directed to the client of this proxy
    // session, it will BOTH contain the Avatar's object and indicate that the Avatar has
    // entered a new Habitat region.
    if (message.you) {
      this.avatarObj = message.obj;
      if (!this.ready) {
        this.ready = true;
        this.avatarName = this.avatarObj.name;
        for (var i in this.callbacks.sessionReady) {
          log.debug('Running callbacks for sessionReady on: %s', this.id());
          this.callbacks.sessionReady[i](this, message);
        }
      }
      log.debug('YOU for client %s: %s', this.id(), JSON.stringify(message));
      this.fireEnteredRegion();
    }

    // Fires any message-specific callbacks.
    if (message.op in this.callbacks) {
      log.debug('Running callbacks for %s on: %s', message.op, this.id());
      for (var i in this.callbacks[message.op]) {
        this.callbacks[message.op][i](this, message);
      }
    }

    // Fires any generic message callbacks.
    for (var i in this.callbacks.msg) {
      this.callbacks.msg[i](this, message)
    }

    if (message.type === 'changeContext' && message.immediate) {
      log.debug('Client %s received changeContext with immediate=true, disconnecting...');
      this.handleProxyDisconnect();
    }
  }

  sendMessage(message) {
    if (!this.ready) {
      console.info('Tried to send message %s on unready session: %s',
        JSON.stringify(message), this.id());
      return false;
    }
    var jsonMessage = JSON.stringify(message);
    log.debug('Sending Habiproxy-injected Elko message for client %s: %s',
      this.id(), jsonMessage);
    this.elkoConnection.write(jsonMessage + '\n\n');
    return true;
  }
}


module.exports = HabitatSession;
