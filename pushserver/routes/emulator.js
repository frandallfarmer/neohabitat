const express = require('express');
const log = require('winston');
const fs = require('fs');


class EmulatorRoutes {

  constructor(habiproxy, config, mongoDb) {
    this.habiproxy = habiproxy;
    this.config = config;
    this.mongoDb = mongoDb;
    this.router = express.Router();
    this.setRoutes();
  }

  setRoutes() {
    var self = this;

    self.router.get('/vice.ini', function(req, res, next) {
      res.render('vice_ini', {
        config: self.config,
      });
    });
  }

}


module.exports = EmulatorRoutes;
