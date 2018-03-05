const express = require('express');


function sendEvent(res, type, msg) {
  res.write('data: ' + JSON.stringify(event) + '\n\n');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
}


class EventRoutes {
  constructor(habiproxy, externalPages) {
    var self = this;
    self.habiproxy = habiproxy;
    self.externalPages = externalPages;
    self.router = express.Router();
    self.setRoutes();
  }

  getRegionDocsURL(regionName) {
    if (regionName in this.externalPages) {
      return this.externalPages[regionName];
    }
    return '/docs/region/' + regionName;
  }

  setRoutes() {
    var self = this;
    self.router.get('/:avatarName', function(req, res, next) {
      if (!(req.params.avatarName in self.habiproxy.sessions)) {
        var err = new Error('Avatar is not currently logged in.');
        err.status = 404;
        next(err);
        return;
      }

      var session = self.habiproxy.sessions[req.params.avatarName];

      res.render('events', {
        avatarName: req.params.avatarName,
        habiproxy: self.habiproxy,
        regionDescription: session.avatarContext.name,
        regionDocsURL: self.getRegionDocsURL(session.avatarRegion()),
        regionName: session.avatarRegion(),
        session: session,
        title: 'Neohabitat - ' + req.params.avatarName,
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
        sendEvent(res, {
          type: 'REGION_CHANGE',
          msg: {
            regionDescription: session.avatarContext.name,
            regionDocsURL: self.getRegionDocsURL(session.avatarRegion()),
            regionName: session.avatarRegion(),
          }
        });
      });

      session.on('disconnect', function() {
        sendEvent(res, {
          type: 'DISCONNECT'
        });
      });
    });
  }
}


module.exports = EventRoutes;
