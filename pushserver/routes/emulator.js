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
      var jd1 = parseInt(req.query.jd1);
      if (jd1 == NaN) {
        jd1 = 2;
      }
      res.render('vice_ini', {
        config: self.config,
        joyDevice1: jd1,
      });
    });
  }

}


module.exports = EmulatorRoutes;
