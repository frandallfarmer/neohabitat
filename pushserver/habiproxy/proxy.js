const net = require('net');

const log = require('winston');

const Session = require('./session');


function stringifyID(socket) {
  return '' + socket.remoteAddress + ':' + socket.remotePort;
}


class HabiproxyServer {
  constructor(mongoDb, listenHost, listenPort, elkoHost, elkoPort) {
    this.listenHost = listenHost;
    this.listenPort = listenPort;
    this.elkoHost = elkoHost;
    this.elkoPort = elkoPort;
    this.mongoDb = mongoDb;

    this.proxyServer = null;

    this.contextMap = {};
    this.sessions = {};

    this.callbacks = {
      sessionReady: [],
    };

    this.buildContextMap();
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

  buildContextMap() {
    var self = this;
    self.mongoDb.collection('odb').find({ type: 'context' }).forEach(function(context) {
      self.contextMap[context.ref] = context;
    });
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

  resolveNeighbors(context) {
    var neighbors = context.mods[0].neighbors;
    var neighborMap = {
      North: 'None',
      South: 'None',
      East: 'None',
      West: 'None',
      NorthImagePath: "/images/Empty.png",
      SouthImagePath: "/images/Empty.png",
      EastImagePath:  "/images/Empty.png",
      WestImagePath:  "/images/Empty.png",                  
    };
    if (neighbors[0] in this.contextMap) {
      neighborMap.North          = this.contextMap[neighbors[0]].name;
      neighborMap.NorthImagePath = "/renders/" + this.contextMap[neighbors[0]].ref + ".png"
    }
    if (neighbors[1] in this.contextMap) {
      neighborMap.East           = this.contextMap[neighbors[1]].name;
      neighborMap.EastImagePath  = "/renders/" + this.contextMap[neighbors[1]].ref + ".png"
    }
    if (neighbors[2] in this.contextMap) {
      neighborMap.South          = this.contextMap[neighbors[2]].name;
      neighborMap.SouthImagePath = "/renders/" + this.contextMap[neighbors[2]].ref + ".png"
    }
    if (neighbors[3] in this.contextMap) {
      neighborMap.West           = this.contextMap[neighbors[3]].name;
      neighborMap.WestImagePath  = "/renders/" + this.contextMap[neighbors[3]].ref + ".png"
    }
    return neighborMap;
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
