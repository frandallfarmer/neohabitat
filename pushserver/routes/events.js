const express = require('express');
const log = require('winston');


function sendEvent(res, type, msg) {
  var event = {
    type: type,
    msg: {},
  };
  if (msg !== undefined) {
    event['msg'] = msg;
  }
  log.debug('Sending push event: %s', JSON.stringify(event));
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

      var session = self.habiproxy.sessions[avatarName];

      res.render('events', {
        avatarName: avatarName,
        config: self.config,
        habiproxy: self.habiproxy,
        regionDescription: session.avatarContext.name,
        regionDocsURL: self.getRegionDocsURL(session.avatarRegion()),
        regionName: session.avatarRegion(),
        session: session,
        title: 'Neohabitat - ' + avatarName,
      });
    });

    self.router.get('/:avatarName/eventStream', function(req, res, next) {
      if (!(req.params.avatarName in self.habiproxy.sessions)) {
        var err = new Error('Avatar unknown.');
        err.status = 404;
        next(err);
        return;
      }

      var session = self.habiproxy.sessions[req.params.avatarName];

      req.socket.setTimeout(Number.MAX_SAFE_INTEGER);

      // Establishes the response as an EventStream readable by an EventSource.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Sends the CONNECTED event upon first connection.
      sendEvent(res, 'CONNECTED');

      // Sends a REGION_CHANGE event when the Avatar changes regions.
      session.on('enteredRegion', function() {
        sendEvent(res, 'REGION_CHANGE', {
          description: session.avatarContext.name,
          docsURL: self.getRegionDocsURL(session.avatarRegion()),
          name: session.avatarRegion(),
        });
      });
    });
  }
}


module.exports = EventRoutes;
