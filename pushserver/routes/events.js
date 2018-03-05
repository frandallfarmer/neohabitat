const express = require('express');


class EventRoutes {
  constructor(habiproxy) {
    this.habiproxy = habiproxy;
    this.router = express.Router();
    this.setRoutes();
  }

  setRoutes() {
    this.router.get('/', function(req, res, next) {
      res.send('respond with a resource');
    });
  }
}


module.exports = EventRoutes;
