const express = require('express');


class IndexRoutes {
  constructor(habiproxy, config) {
    this.habiproxy = habiproxy;
    this.config = config;
    this.router = express.Router();
    this.setRoutes();
  }

  setRoutes() {
    var self = this;

    this.router.get('/', function(req, res, next) {
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
