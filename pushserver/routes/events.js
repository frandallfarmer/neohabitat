const express = require('express');


function sendEvent(res, event) {
  res.write('data: ' + JSON.stringify(event) + '\n\n');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
}


class EventRoutes {
  constructor(habiproxy, externalPages) {
    this.habiproxy = habiproxy;
    this.externalPages = externalPages;
    this.router = express.Router();
    this.setRoutes();
  }

  getRegionDocsURL(regionName) {
    if (regionName in this.externalPages) {
      return this.externalPages[regionName];
    }
    return '/region/' + regionName;
  }

  setRoutes() {
    var self = this;
    this.router.get('/:avatarName', function(req, res, next) {
      if (!(req.params.avatarName in this.habiproxy.sessions)) {
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

    this.router.get('/:avatarName/eventStream', function(req, res, next) {
      if (!(req.params.avatarName in this.habiproxy.sessions)) {
        var err = new Error('Avatar is not currently logged in.');
        err.status = 404;
        next(err);
        return;
      }

      var session = self.habiproxy.sessions[req.params.avatarName];

      req.socket.setTimeout(Infinity);

      var regionCallbackIndex = session.on('enteredRegion', function() {
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
      })

    });
  }
}


module.exports = EventRoutes;
