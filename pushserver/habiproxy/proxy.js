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
    };
  }

  awakeSessions() {
    var awakeSessions = {};
    var sessionAvatars = Object.keys(this.sessions);
    for (var i in sessionAvatars) {
      var avatarName = sessionAvatars[i];
      var avatarSession = this.sessions[avatarName];
      if (avatarSession.ready) {
        awakeSessions[avatarName] = avatarSession;
      }
    }
    return awakeSessions;
  }

  handleClientConnect(client) {
    log.debug('Habiproxy client connected at: %s', stringifyID(client))
    
    var clientSession = new Session(this.elkoHost, this.elkoPort, client);
    clientSession.onServer('sessionReady', this.handleSessionReady.bind(this));

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
    var readySession = session;
    if (session.avatarName in this.sessions) {
      readySession = this.sessions[session.avatarName].resume(readySession);
      log.debug('Moved Habiproxy session to AWAKE: %s', readySession.id());
      this.sessions[readySession.avatarName] = readySession;
    } else {
      readySession = session;
      log.debug('NEW Habiproxy session: %s', readySession.id())
      this.sessions[readySession.avatarName] = readySession;
    }
    for (var i in this.callbacks.sessionReady) {
      log.debug('Handling callback for sessionReady on: %s', session.id())
      this.callbacks.sessionReady[i](readySession);
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
