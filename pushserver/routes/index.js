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

    // The all-JS web client framed as a docent page (desktop), in place of the C64 emulator.
    // /webclient/live.html stays the bare narrow-screen mobile client.
    this.router.get('/neohabitat', function(req, res, next) {
      var docentSessionId = newDocentSessionId();
      res.cookie('docentSessionId', docentSessionId, {
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      });
      res.render('neohabitat', {
        title: 'Neohabitat — Web Client',
        config: self.config,
        docentSessionId: docentSessionId,
      });
    });

    // Same docent wrapper, but around the 3D web client (live3d.html) with the region docent text in
    // a page-width frame below it instead of the right-hand pane. Reuses the identical docent-session
    // correlation + SSE; live3d.html and the shared shell are untouched.
    this.router.get('/neohabitat3d', function(req, res, next) {
      var docentSessionId = newDocentSessionId();
      res.cookie('docentSessionId', docentSessionId, {
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      });
      res.render('neohabitat3d', {
        title: 'Neohabitat — 3D Web Client',
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
