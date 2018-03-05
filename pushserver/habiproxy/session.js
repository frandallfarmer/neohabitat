const net = require('net');

const log = require('winston');


function stringifyID(socket) {
  return '' + socket.remoteAddress + ':' + socket.remotePort;
}


class HabitatSession {
  constructor(elkoHost, elkoPort, client) {
    this.elkoHost = elkoHost;
    this.elkoPort = elkoPort;
    this.client = client;

    this.avatarObj = null;
    this.avatarName = 'unknown';
    this.elkoConnection = null;
    this.region = 'unknown';

    this.clientAttached = false;
    this.connected = false;
    this.ready = false;

    this.callbacks = {
      connected: [],
      delete: [],
      disconnected: [],
      enteredRegion: [],
      msg: [],
      sessionReady: [],
    };
  }

  start() {
    if (!this.clientAttached) {
      // Begins listening for client events.
      this.client.on('data', this.handleClientData.bind(this));
      this.client.on('end', this.handleClientDisconnect.bind(this));
      this.clientAttached = true;
    }
    if (!this.connected) {
      // Opens a connection to Elko and begins listening for events.
      this.elkoConnection = new net.Socket();
      this.elkoConnection.connect(this.elkoPort, this.elkoHost,
        this.handleElkoConnect.bind(this));
      this.elkoConnection.on('data', this.handleElkoData.bind(this));
      this.elkoConnection.on('end', this.handleElkoDisconnect.bind(this));
    }
  }

  // Proxies any data from the client to this session's Elko connection.
  handleClientData(buffer) {
    log.info('%s -> %s', stringifyID(this.client), buffer);    
    this.elkoConnection.write(buffer);
  }

  handleClientDisconnect() {
    log.debug('Habiproxy session disconnected on: %s', stringifyID(this.client));
    this.handleElkoDisconnect();
  }

  // Proxies data between the session's Elko connection to the client, then processes
  // the JSON message sent from Elko to both set session state and trigger any assigned
  // callbacks.
  handleElkoData(buffer) {
    // Sends the Elko message to this session's client.
    log.info('%s -> %s', buffer, stringifyID(this.client));
    this.client.write(buffer);

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
        log.error('JSON failed to parse, ignoring: %s %s', message, err);
        continue;
      }
      this.processMessage(parsedMessage)
    }
  }

  handleElkoDisconnect() {
    log.debug('Disconnecting Elko connection on: %s', stringifyID(this.client));
    this.connected = false;
    this.ready = false;
    this.client.end();
    this.elkoConnection.destroy();
    for (var i in this.callbacks.disconnected) {
      log.debug('Running callback for disconnected on: %s', stringifyID(this.client));
      this.callbacks.disconnected[i](this);
    }
  }

  handleElkoConnect() {
    log.debug('Elko connection established on: %s', stringifyID(this.client));
    this.connected = true;
    for (var i in this.callbacks.connected) {
      log.debug('Running callback for connected on: %s', stringifyID(this.client));
      this.callbacks.connected[i](this);
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
    // If the Elko message indicates that it is directed to the client of this proxy
    // session, it will BOTH contain the Avatar's object and indicate that the Avatar has
    // entered a new Habitat region.
    if (message.you) {
      this.avatarObj = message.obj;
      this.avatarName = this.avatarObj.name;
      if (!this.ready) {
        this.ready = true;
        for (var i in this.callbacks.sessionReady) {
          log.debug('Running callbacks for sessionReady on: %s', stringifyID(this.client));
          this.callbacks.sessionReady[i](this, message);
        }
      }
      for (var i in this.callbacks.enteredRegion) {
        log.debug('Running callbacks for enteredRegion on: %s', stringifyID(this.client));
        this.callbacks.enteredRegion[i](this, message);
      }
    }

    // Fires any message-specific callbacks.
    if (message.op in this.callbacks) {
      log.debug('Running callbacks for %s on: %s', o.op, stringifyID(this.client));
      for (var i in this.callbacks[message.op]) {
        this.callbacks[message.op][i](this, message);
      }
    }

    // Fires any generic message callbacks.
    for (var i in this.callbacks.msg) {
      this.callbacks.msg[i](this, message)
    }
  }
}


module.exports = HabitatSession;
