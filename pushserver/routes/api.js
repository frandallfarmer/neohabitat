const fs = require('fs');

const express = require('express');
const log = require('winston');
const showdown = require('showdown');


class APIRoutes {
  constructor(habiproxy, config, mongoDb) {
    this.habiproxy = habiproxy;
    this.config = config;
    this.mongoDb = mongoDb;

    this.contextMap = {};

    this.router = express.Router();
    this.setRoutes();
  }

  setRoutes() {
    var self = this;

    self.router.get('/avatar/:avatarName', function(req, res, next) {
      if (req.params.avatarName in self.habiproxy.sessions) {
        var session = self.habiproxy.sessions[req.params.avatarName];
        res.json({
          avatar: session.avatarObj,
          health: session.avatarHealth(),
          context: session.avatarContext,
          neighbors: self.habiproxy.resolveNeighbors(session.avatarContext),
        });
      } else {
        var err = new Error('Avatar unknown.');
        err.status = 404;
        next(err);
        return;
      }
    });

    self.router.post('/avatar/:avatarName/action', function(req, res, next) {
      if (req.params.avatarName in self.habiproxy.sessions) {
        var session = self.habiproxy.sessions[req.params.avatarName];
        var action = req.body;
        if ('type' in action && 'params' in action) {
          var success = session.doAction(action);
          if (success) {
            res.json({success: success});
          } else {
            var err = new Error('Action was unsuccessful.');
            err.status = 400;
            next(err);
            return;
          }
        } else {
          var err = new Error('Action objects require "type" and "params" keys.');
          err.status = 400;
          next(err);
          return;
        }
      } else {
        var err = new Error('Avatar unknown.');
        err.status = 404;
        next(err);
        return;
      }
    });

    self.router.get('/avatar/:avatarName/region', function(req, res, next) {
      if (req.params.avatarName in self.habiproxy.sessions) {
        res.json(self.habiproxy.sessions[req.params.avatarName].regionContents);
      } else {
        var err = new Error('Avatar unknown.');
        err.status = 404;
        next(err);
        return;
      }
    });

    self.router.get('/worldview/avatars', function(req, res, next) {
      var awakeSessions = self.habiproxy.awakeSessions();
      var avatarNames = Object.keys(awakeSessions).sort();
      var avatarWorldview = {
        totalAvatars: avatarNames.length,
        avatars: [],
      };
      for (var i in avatarNames) {
        var avatarName = avatarNames[i];
        var avatarLocation = awakeSessions[avatarName].avatarContext.name;
        avatarWorldview.avatars.push({avatar: avatarName, location: avatarLocation});
      }
      res.json(avatarWorldview);
    });
  }
}

module.exports = APIRoutes;
