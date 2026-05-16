const express = require('express');
const crypto = require('crypto');

function newDocentSessionId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}


class IndexRoutes {
  constructor(habiproxy, config, mongoDb) {
    this.habiproxy = habiproxy;
    this.config = config;
    this.mongoDb = mongoDb;
    this.router = express.Router();
    this.setRoutes();
  }

  setRoutes() {
    var self = this;

    this.router.get('/', function(req, res, next) {
      var docentSessionId = newDocentSessionId();
      res.cookie('docentSessionId', docentSessionId, {
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      });
      res.render('emulator', {
        title: 'Login to Neohabitat',
        config: self.config,
        docentSessionId: docentSessionId,
      });
    });

    this.router.get('/c64', function(req, res, next) {
      var awakeSessions = self.habiproxy.awakeSessions();
      if ('avatarName' in req.session && req.session.avatarName in awakeSessions) {
        res.redirect('/events?avatar='+req.session.avatarName);
        return;
      }
      res.render('index', {
        title: 'Welcome to Neohabitat!',
        awakeSessions: awakeSessions,
        config: self.config,
      });
    });

    this.router.get('/logout', function(req, res, next) {
      delete req.session['avatarName'];
      res.redirect('/');
    });
  }
}


module.exports = IndexRoutes;
