const net = require('net');

const log = require('winston');

const ActionTypes = require('./actionTypes');


function stringifyID(socket) {
  return '' + socket.remoteAddress + ':' + socket.remotePort;
}


class HabitatSession {
  constructor(serverHost, serverPort, client) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;

    this.clientConnection = client;
    this.serverConnection = null;
    this.avatarContext = null;
    this.avatarObj = null;
    this.avatarName = 'unknown';
    this.clientBuffer = '';
    this.hatcheryState = 'idle';
    this.hatcheryAvatar = null;
    this.hatcheryUser = null;
    this.hatcherySession = null;
    this.region = 'unknown';
    this.regionContents = {};

    this.clientConnectionAttached = false;
    this.serverConnectionAttached = false;
    this.connected = false;
    this.ready = false;

    // Bytes from the client buffered while the server-side connection
    // is being re-established after a changeContext. Drained when the
    // new server socket finishes its TCP handshake. Kept here (rather
    // than relying on Node's socket write buffer) because the socket
    // may not exist at all between cycleServerSide() and reconnectServer().
    this.serverWriteQueue = [];
    this.serverReconnecting = false;

    this.updatedAt = Math.round((new Date()).getTime() / 1000);

    this.clearCallbacks();
  }

  start() {
    this.ensureServerConnected();
    this.attachClient();
    this.attachServer();
  }

  attachClient() {
    if (!this.clientConnectionAttached) {
      // Begins listening for Client events.
      this.clientConnection.on('data', this.handleClientData.bind(this));
      this.clientConnection.on('end', this.handleClientDisconnect.bind(this));
      this.clientConnection.on('error', this.handleClientDisconnect.bind(this));
      this.clientConnectionAttached = true;
    }
  }

  attachServer() {
    if (!this.serverConnectionAttached) {
      // Begins listening for Server events.
      this.serverConnection.on('data', this.handleServerData.bind(this));
      this.serverConnection.on('end', this.handleServerDisconnect.bind(this));
      this.serverConnection.on('error', this.handleServerDisconnect.bind(this));
      this.serverConnectionAttached = true;
    }
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
        return 'East';
      case 2:
        return 'North';
      case 3:
        return 'South';
      default:
        return 'Unknown';
    }
  }

  avatarRegion() {
    if (this.avatarContext === null) {
      return 'unknown';
    }
    return this.avatarContext.ref.split('-')[1];
  }

  clearCallbacks() {
    this.clientCallbacks = {
      msg: [],
    };
    this.serverCallbacks = {
      connected: [],
      delete: [],
      disconnected: [],
      enteredRegion: [],
      msg: [],
      sessionReady: [],
    };
  }

  detachClient() {
    if (this.clientConnection !== null) {
      this.clientConnection.removeAllListeners();
    }
    this.clientConnectionAttached = false;
  }

  // Null-safe — cycleServerSide() can have already nulled serverConnection
  // before a later disconnectProxy() runs (e.g. during the binary-mode
  // bridge's reconnect-after-changeContext flow). Without this guard the
  // NPE bubbles out of an event handler and crashes the whole pushserver
  // process, taking every habiproxy session down with it.
  detachServer() {
    if (this.serverConnection !== null) {
      this.serverConnection.removeAllListeners();
    }
    this.serverConnectionAttached = false;
  }

  // Tear down ONLY the server-side (habiproxy↔elko) connection,
  // leaving the client-side (bridge↔habiproxy) intact. Used on
  // changeContext: elko's session model demands a fresh TCP per
  // context, but the bridge's socket has no such requirement, so we
  // cycle only the elko hop. The next client write will lazily open
  // a new server connection via reconnectServer().
  cycleServerSide() {
    if (this.serverConnection !== null) {
      log.debug('Cycling Habiproxy server-side only on: %s', this.id());
      this.serverConnection.removeAllListeners();
      this.serverConnectionAttached = false;
      this.serverConnection.destroy();
      this.serverConnection = null;
    }
  }

  // Asynchronously open a fresh elko connection and drain whatever
  // client bytes arrived while we were between sockets. Idempotent —
  // a second call while a connect is in flight just falls through.
  reconnectServer() {
    if (this.serverReconnecting) {
      return;
    }
    this.serverReconnecting = true;
    log.debug('Re-establishing Habiproxy server connection for: %s', this.id());
    this.serverConnectionAttached = false;
    this.serverConnection = new net.Socket();
    var self = this;
    this.serverConnection.connect(this.serverPort, this.serverHost, function() {
      log.debug('Habiproxy server reconnected for: %s', self.id());
      self.attachServer();
      self.connected = true;
      self.serverReconnecting = false;
      // Drain anything the client sent while we were reconnecting.
      var queue = self.serverWriteQueue;
      self.serverWriteQueue = [];
      for (var i in queue) {
        try {
          self.serverConnection.write(queue[i]);
        } catch (err) {
          log.error('Unable to drain queued buffer to Server: %s', err);
        }
      }
    });
    // Surface server-side connect errors instead of letting them crash
    // the process. handleServerDisconnect() will tear the whole session
    // down, which is the same fate as a hard reconnect failure today.
    this.serverConnection.once('error', function(err) {
      log.error('Server reconnect failed for %s: %s', self.id(), err);
      self.serverReconnecting = false;
      self.handleServerDisconnect();
    });
  }

  doAction(action) {
    if (!this.ready) {
      log.debug('Tried to do action %s on unready session: %s',
        JSON.stringify(action), this.id());
      return false;
    }
    log.debug('Performing ACTION on session %s: %s', this.id(), JSON.stringify(action));
    switch (action.type) {
      case ActionTypes.START_ESP:
        return this.sendServerMessage({
          "to": this.avatarObj.ref,
          "op": "SPEAK",
          "esp": 0,
          "text": "to:"+action.params.avatar,
        });
      case ActionTypes.SEND_TELEPORT_INVITE:
        return this.sendServerMessage({
          "to": this.avatarObj.ref,
          "op": "SPEAK",
          "esp": 0,
          "text": "/i "+action.params.avatar,
        });
      case ActionTypes.SEND_TELEPORT_REQUEST:
        return this.sendServerMessage({
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

  disconnectProxy() {
    log.debug('Disconnecting Habiproxy connection on: %s', this.id());

    this.detachClient();
    this.detachServer();

    var shouldFireDisconnected = false;
    if (this.connected) {
      shouldFireDisconnected = true;
    }

    if (this.clientConnection !== null) {
      this.clientConnection.end();
      this.clientConnection = null;
    }

    if (this.serverConnection !== null) {
      this.serverConnection.destroy();
      this.serverConnection = null;
    }

    this.connected = false;
    this.ready = false;

    if (shouldFireDisconnected) {
      for (var i in this.serverCallbacks.disconnected) {
        log.debug('Running callback for session disconnected on: %s', this.id());
        this.serverCallbacks.disconnected[i](this);
      }
    }
  }

  ensureServerConnected() {
    if (!this.connected || this.serverConnection === null) {
      // Opens a connection to Server and begins listening for events.
      this.serverConnectionAttached = false;
      this.serverConnection = new net.Socket();
      this.serverConnection.connect(this.serverPort, this.serverHost,
        this.handleServerConnect.bind(this));
      this.attachServer();
      this.connected = true;
    }
  }

  // Wakes up an asleep Habitat session with the contents of a freshly-ready session.
  resume(readySession) {
    readySession.detachClient();
    readySession.detachServer();
    readySession.clearCallbacks();

    this.clientConnection = readySession.clientConnection;
    this.serverConnection = readySession.serverConnection;

    this.avatarContext = readySession.avatarContext;
    this.avatarObj = readySession.avatarObj;
    this.avatarName = readySession.avatarName;
    this.serverConnection = readySession.serverConnection;
    this.hatcheryState = readySession.hatcheryState;
    this.hatcheryAvatar = readySession.hatcheryAvatar;
    this.hatcheryUser = readySession.hatcheryUser;
    this.hatcherySession = readySession.hatcherySession;
    this.region = readySession.region;
    this.regionContents = readySession.regionContents;

    this.clientConnectionAttached = false;
    this.serverConnectionAttached = false;
    this.connected = true;
    this.ready = true;

    this.updatedAt = Math.round((new Date()).getTime() / 1000);

    this.ensureServerConnected();
    this.attachClient();
    this.attachServer();
    this.fireEnteredRegion();

    return this;
  }

  fireEnteredRegion() {
    for (var i in this.serverCallbacks.enteredRegion) {
      log.debug('Running callbacks for enteredRegion %s on: %s',
        this.avatarRegion, this.id());
      this.serverCallbacks.enteredRegion[i](this, this.avatarRegion);
    }
  }

  fireClientCallbacks(eventType, message) {
    if (eventType in this.clientCallbacks) {
      log.debug('Running Client callbacks for %s on: %s', eventType, this.id());
      for (var i in this.clientCallbacks[eventType]) {
        this.clientCallbacks[eventType][i](this, message);
      }
    }
  }

  isHabiproxyControlMessage(message) {
    return message.to === 'habiproxy' && message.op === 'HATCHERY_STATE';
  }

  processHabiproxyControlMessage(message) {
    if (message.state !== 'started' && message.state !== 'completed') {
      log.warn('Ignoring unknown hatchery state from bridge on %s: %s',
        this.id(), JSON.stringify(message));
      return;
    }

    this.hatcheryState = message.state;
    this.hatcheryAvatar = message.avatar || null;
    this.hatcheryUser = message.user || null;
    this.hatcherySession = message.session || null;
    this.fireClientCallbacks('hatcheryState', message);
  }

  // Proxies any data from the client to this session's Server connection.
  handleClientData(buffer) {
    log.silly('%s -> %s', this.id(), buffer);
    this.clientBuffer += buffer.toString('utf8');
    var messages = this.clientBuffer.split('\n');
    this.clientBuffer = messages.pop();

    for (var i in messages) {
      var message = messages[i];
      if (message.length == 0) {
        continue;
      }
      var shouldForward = true;
      try {
        var parsedMessage = JSON.parse(message);
      } catch (err) {
        log.error('Client JSON failed to parse, forwarding unprocessed: "%s" %s', message, err);
        parsedMessage = null;
      }
      if (parsedMessage !== null && this.isHabiproxyControlMessage(parsedMessage)) {
        shouldForward = false;
        this.processHabiproxyControlMessage(parsedMessage);
      }
      if (shouldForward) {
        var msgBuf = Buffer.from(message + '\n\n');
        if (this.serverConnection === null || this.serverConnection.destroyed) {
          this.serverWriteQueue.push(msgBuf);
          this.reconnectServer();
        } else if (this.serverReconnecting) {
          this.serverWriteQueue.push(msgBuf);
        } else {
          try {
            this.serverConnection.write(msgBuf);
          } catch (err) {
            log.error('Unable to write to Server connection: %s', err)
          }
        }
      }
      if (parsedMessage !== null && shouldForward) {
        this.processClientMessage(parsedMessage);
      }
    }
  }

  handleClientDisconnect() {
    log.debug('Client disconnected for Client %s, moving session to ASLEEP', this.id());
    this.disconnectProxy();
  }

  handleServerConnect() {
    log.debug('Server connection established on: %s', this.id());
    this.connected = true;
    for (var i in this.serverCallbacks.connected) {
      log.debug('Running Server callback for session connected on: %s', this.id());
      this.serverCallbacks.connected[i](this);
    }
  }

  // Proxies data between the session's Server connection to the client, then processes
  // the JSON message sent from Server to both set session state and trigger any assigned
  // callbacks.
  handleServerData(buffer) {
    // Sends the Server message to this session's client.
    log.silly('%s -> %s', buffer, this.id());
    try {
      this.clientConnection.write(buffer);
    } catch (err) {
      log.error('Unable to write to client: %s', err)
    }
    // Parses Server message; if we receive bad data from the server, ignores it.
    var messages = buffer.toString('utf8').split('\n');
    for (var i in messages) {
      var message = messages[i];
      if (message.length == 0) {
        continue;
      }
      try {
        var parsedMessage = JSON.parse(message);
      } catch (err) {
        log.error('Server JSON failed to parse, ignoring: "%s" %s', message, err);
        continue;
      }
      this.processServerMessage(parsedMessage);
    }
  }

  handleServerDisconnect() {
    log.debug('Server disconnected for Client %s, moving session to ASLEEP', this.id());
    this.disconnectProxy();
  }

  id() {
    if (this.clientConnection !== null) {
      return stringifyID(this.clientConnection) + ' (' + this.avatarName + ')';
    } else {
      return 'DISCONNECTED (' + this.avatarName + ')';
    }
  }

  onClient(eventType, callback) {
    if (eventType in this.clientCallbacks) {
      this.clientCallbacks[eventType].push(callback);
    } else {
      this.clientCallbacks[eventType] = [callback];
    }
  }

  onServer(eventType, callback) {
    if (eventType in this.serverCallbacks) {
      this.serverCallbacks[eventType].push(callback);
    } else {
      this.serverCallbacks[eventType] = [callback];
    }
  }

  processClientMessage(message) {
    log.debug('Processing Client message for Client %s: %s',
      this.id(), JSON.stringify(message));

    // Fires any message-specific callbacks.
    if (message.op in this.clientCallbacks) {
      log.debug('Running Client callbacks for %s on: %s', message.op, this.id());
      for (var i in this.clientCallbacks[message.op]) {
        this.clientCallbacks[message.op][i](this, message);
      }
    }

    // Fires any generic message callbacks.
    for (var i in this.clientCallbacks.msg) {
      log.debug('Running Client callbacks for msg on: %s', message.op, this.id());
      this.clientCallbacks.msg[i](this, message)
    }
  }

  processServerMessage(message) {
    log.debug('Processing Server message for Client %s: %s',
      this.id(), JSON.stringify(message));

    // Populates the region's contents for the current Habitat session.
    if (message.op === 'make') {
      // If this is a new context, tracks it within this session for ease of rendering.
      if (message.obj.type === 'context') {
        this.avatarContext = message.obj;
      }
      this.regionContents[message.obj.ref] = message.obj;
    }

    // If the Server message indicates that it is directed to the client of this proxy
    // session, it will BOTH contain the Avatar's object and indicate that the Avatar has
    // entered a new Habitat region.
    if (message.you) {
      this.avatarObj = message.obj;
      if (!this.ready) {
        this.ready = true;
        this.avatarName = this.avatarObj.name;
        for (var i in this.serverCallbacks.sessionReady) {
          log.debug('Running server callbacks for sessionReady on: %s', this.id());
          this.serverCallbacks.sessionReady[i](this, message);
        }
      }
      log.debug('YOU for Client %s: %s', this.id(), JSON.stringify(message));
      this.fireEnteredRegion();
    }

    // Fires any message-specific callbacks.
    if (message.op in this.serverCallbacks) {
      log.debug('Running server callbacks for %s on: %s', message.op, this.id());
      for (var i in this.serverCallbacks[message.op]) {
        this.serverCallbacks[message.op][i](this, message);
      }
    }

    // Fires any generic message callbacks.
    for (var i in this.serverCallbacks.msg) {
      this.serverCallbacks.msg[i](this, message)
    }

    // changeContext: elko's session model demands a fresh TCP per
    // context, but the bridge's socket can persist across region
    // transitions. Cycle only the elko-side connection — the bridge↔
    // habiproxy and bot↔bridge sockets stay alive, eliminating the
    // per-region "Disconnecting Habiproxy connection" / "Habiproxy
    // client connected" pair from the logs and from the bridge's
    // session bookkeeping. handleClientData lazily reopens the server
    // side when the bridge's entercontext for the new region arrives.
    if (message.type === 'changeContext') {
      log.debug('Client %s received changeContext, cycling elko-side only',
        this.id());
      this.cycleServerSide();
    }
  }

  sendClientMessage(message) {
    if (!this.ready) {
      log.error('Tried to send Client message %s on unready session: %s',
        JSON.stringify(message), this.id());
      return false;
    }
    var jsonMessage = JSON.stringify(message);
    log.debug('Sending Habiproxy-injected Client message for Client %s: %s',
      this.id(), jsonMessage);
    this.clientConnection.write(jsonMessage+'\n\n');
    return true;
  }

  sendServerMessage(message) {
    if (!this.ready) {
      log.error('Tried to send Server message %s on unready session: %s',
        JSON.stringify(message), this.id());
      return false;
    }
    var jsonMessage = JSON.stringify(message);
    log.debug('Sending Habiproxy-injected Server message for Client %s: %s',
      this.id(), jsonMessage);
    this.serverConnection.write(jsonMessage+'\n\n');
    return true;
  }
}


module.exports = HabitatSession;
