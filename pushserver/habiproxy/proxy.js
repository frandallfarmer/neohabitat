const net = require('net');

const log = require('winston');

const Session = require('./session');


function stringifyID(socket) {
  return '' + socket.remoteAddress + ':' + socket.remotePort;
}


class HabiproxyServer {
  constructor(listenHost, listenPort, elkoHost, elkoPort) {
    this.listenHost = listenHost;
    this.listenPort = listenPort;
    this.elkoHost = elkoHost;
    this.elkoPort = elkoPort;

    this.proxyServer = null;

    this.sessions = {};

    this.callbacks = {
      sessionReady: [],
      sessionTerminated: [],
    };
  }

  handleClientConnect(client) {
    log.debug('Habiproxy client connected at: %s', stringifyID(client))
    
    var clientSession = new Session(this.elkoHost, this.elkoPort, client);
    clientSession.on('sessionReady', this.handleSessionReady.bind(this));
    clientSession.on('disconnected', this.handleSessionTerminate.bind(this));

    try {
      clientSession.start();
    } catch (err) {
      log.error("Couldn't start Habiproxy session for client %s; terminating: %s",
          stringifyID(client), err);
      client.end();
      return;
    }
  }

  handleSessionReady(session) {
    if (session == null) {
      return;
    }
    this.sessions[session.avatarName] = session;
    for (var i in this.callbacks.sessionReady) {
      log.debug('Handling callback for sessionReady on: %s', session.id())
      this.callbacks.sessionReady[i](session);
    }
  }

  handleSessionTerminate(session) {
    if (session == null) {
      return;
    }
    if (session.avatarName in this.sessions) {
      log.debug('Removing Habiproxy session: %s', session.id())
      delete this.sessions[session.avatarName];
    }
    for (var i in this.callbacks.sessionTerminated) {
      log.debug('Handling callback for sessionTerminated on: %s', session.id())
      this.callbacks.sessionTerminated[i](session);
    }
  }

  start() {
    try {
      this.proxyServer = net.createServer(this.handleClientConnect.bind(this));
      this.proxyServer.listen(this.listenPort, this.listenHost);
      log.info('Habiproxy listening on %s:%s', this.listenHost, this.listenPort);
    } catch (err) {
      log.error('Failed to start Habiproxy server; disabling: %s', err);
    }
  }

  on(eventType, callback) {
    if (eventType in this.callbacks) {
      this.callbacks[eventType].push(callback);
    } else {
      this.callbacks[eventType] = [callback];
    }
  }
}


module.exports = HabiproxyServer;
