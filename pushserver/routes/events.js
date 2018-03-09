const express = require('express');
const log = require('winston');

const ClassTable = require('../constants/ClassTable');


function sendEvent(res, avatarName, type, msg) {
  var event = {
    type: type,
    msg: {},
  };
  if (msg !== undefined) {
    event['msg'] = msg;
  }
  log.debug('Sending push event for %s: %s', avatarName, JSON.stringify(event));
  res.write('data: ' + JSON.stringify(event) + '\n\n');
}


class EventRoutes {
  constructor(habiproxy, config) {
    var self = this;
    self.habiproxy = habiproxy;
    self.config = config;
    self.router = express.Router();
    self.setRoutes();
  }

  getRegionDocsURL(regionName) {
    if (regionName in this.config.externalPages) {
      return this.config.externalPages[regionName];
    }
    return '/docs/region/' + regionName;
  }

  getHelpDocsURL(session, objectRef) {
    var object = session.regionContents[objectRef];
    if (object === undefined) {
      log.error('No reference found for objectRef "%s" on session %s, returning Help #0',
        objectRef, session.id());
      return '/docs/help/0';
    }
    var classNum = ClassTable[object.mods[0].type];
    return '/docs/help/'+classNum;
  }

  setRoutes() {
    var self = this;
    self.router.get('/', function(req, res, next) {
      var avatarName = req.query.avatar;
      if (!(avatarName in self.habiproxy.sessions)) {
        var err = new Error('Avatar unknown.');
        err.status = 404;
        next(err);
        return;
      }
      req.session.avatarName = req.query.avatar;

      var session = self.habiproxy.sessions[avatarName];

      res.render('events', {
        avatarName: avatarName,
        avatarObj: session.avatarObj,
        config: self.config,
        habiproxy: self.habiproxy,
        health: session.avatarHealth(),
        orientation: session.avatarOrientation(),
        regionDescription: session.avatarContext.name,
        regionDocsURL: self.getRegionDocsURL(session.avatarRegion()),
        regionName: session.avatarRegion(),
        session: session,
        title: 'Neohabitat - ' + avatarName,
      });
    });

    self.router.get('/:avatarName/eventStream', function(req, res, next) {
      var avatarName = req.params.avatarName;

      if (!(avatarName in self.habiproxy.sessions)) {
        var err = new Error('Avatar unknown.');
        err.status = 404;
        next(err);
        return;
      }

      var session = self.habiproxy.sessions[avatarName];

      req.socket.setTimeout(Number.MAX_SAFE_INTEGER);

      // Establishes the response as an EventStream readable by an EventSource.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('\n');

      // Sends the CONNECTED event upon first connection.
      sendEvent(res, avatarName, 'CONNECTED');
      sendEvent(res, avatarName, 'REGION_CHANGE', {
        description: session.avatarContext.name,
        docsURL: self.getRegionDocsURL(session.avatarRegion()),
        name: session.avatarRegion(),
        orientation: session.avatarOrientation(),
      });

      // Sends a REGION_CHANGE event when the Avatar changes regions.
      session.onServer('enteredRegion', function() {
        sendEvent(res, avatarName, 'REGION_CHANGE', {
          description: session.avatarContext.name,
          docsURL: self.getRegionDocsURL(session.avatarRegion()),
          name: session.avatarRegion(),
          orientation: session.avatarOrientation(),
        });
      });

      // Sends a SHOW_HELP event when the user requests help on an object.
      session.onClient('HELP', function(session, message) {
        sendEvent(res, avatarName, 'SHOW_HELP', {
          docsURL: self.getHelpDocsURL(session, message.to),
        });
      });
    });
  }
}


module.exports = EventRoutes;
