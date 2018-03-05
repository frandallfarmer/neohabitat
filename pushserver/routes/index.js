const express = require('express');


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
  }
}


module.exports = IndexRoutes;
