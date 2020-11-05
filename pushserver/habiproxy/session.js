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
    this.region = 'unknown';
    this.regionContents = {};

    this.clientConnectionAttached = false;
    this.serverConnectionAttached = false;
    this.connected = false;
    this.ready = false;

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
      this.clientConnectionAttached = true;
    }
  }

  attachServer() {
    if (!this.serverConnectionAttached) {
      // Begins listening for Server events.
      this.serverConnection.on('data', this.handleServerData.bind(this));
      this.serverConnection.on('end', this.handleServerDisconnect.bind(this));
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
    this.clientConnection.removeAllListeners();
    this.clientConnectionAttached = false;
  }

  detachServer() {
    this.serverConnection.removeAllListeners();
    this.serverConnectionAttached = false;
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

  // Proxies any data from the client to this session's Server connection.
  handleClientData(buffer) {
    // Sends the Client message to this session's Elko server.
    log.silly('%s -> %s', this.id(), buffer);
    try {
      this.serverConnection.write(buffer);
    } catch (err) {
      log.error('Unable to write to Server connection: %s', err)
    }
    // Parses client message; if we receive bad data from the client, ignores it.
    var messages = buffer.toString('utf8').split('\n');
    for (var i in messages) {
      var message = messages[i];
      if (message.length == 0) {
        continue;
      }
      try {
        var parsedMessage = JSON.parse(message);
      } catch (err) {
        log.error('Client JSON failed to parse, ignoring: "%s" %s', message, err);
        continue;
      }
      this.processClientMessage(parsedMessage);
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

    // If this is an immediate changeContext, the client will not automatically disconnect
    // during the context change; thus, we forcibly disconnect here.
    if (message.type === 'changeContext') {
      log.debug('Client %s received changeContext, disconnecting...',
        this.id());
      this.disconnectProxy();
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
