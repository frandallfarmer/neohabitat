const express = require('express');
const log = require('winston');


class IndexRoutes {
  constructor(habiproxy) {
    this.habiproxy = habiproxy;
    this.router = express.Router();
    this.setRoutes();
  }

  setRoutes() {
    var self = this;
    this.router.get('/', function(req, res, next) {
      res.render('index', {
        title: 'Welcome to Neohabitat!',
        habiproxy: self.habiproxy,
      });
    });
    this.router.get('/region/', function(req, res, next) {
      res.render('index', {
        title: 'Welcome to Neohabitat!',
        habiproxy: self.habiproxy,
      });
    });
  }
}


module.exports = IndexRoutes;
