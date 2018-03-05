const express = require('express');


function sendEvent(res, type, msg) {
  var event = {
    type: type,
    msg: {},
  };
  if (msg !== undefined) {
    event['msg'] = msg;
  }
  res.write('data: ' + JSON.stringify(event) + '\n\n');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
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
      var avatarName = req.query.avatar_name;

      if (!(avatarName in self.habiproxy.sessions)) {
        var err = new Error('Avatar is not currently logged in.');
        err.status = 404;
        next(err);
        return;
      }

      var session = self.habiproxy.sessions[avatarName];

      res.render('events', {
        avatarName: avatarName,
        config: this.config,
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
        var err = new Error('Avatar is not currently logged in.');
        err.status = 404;
        next(err);
        return;
      }

      var session = self.habiproxy.sessions[req.params.avatarName];

      req.socket.setTimeout(Infinity);

      session.on('enteredRegion', function() {
        sendEvent(res, 'REGION_CHANGE', {
          regionDescription: session.avatarContext.name,
          regionDocsURL: self.getRegionDocsURL(session.avatarRegion()),
          regionName: session.avatarRegion(),
        });
      });

      session.on('disconnect', function() {
        sendEvent(res, 'DISCONNECT');
      });
    });
  }
}


module.exports = EventRoutes;
