const express = require('express');
const http = require('http');

class StatusRoutes {
  constructor(config) {
    this.config = config;
    this.router = express.Router();
    this.setRoutes();
  }

  fetchBridgeLogs(level, callback) {
    const adminAddr = this.config.bridgeAdminAddr;
    if (!adminAddr) {
      return callback(null, []);
    }
    const [host, port] = adminAddr.split(':');
    const options = {
      hostname: host,
      port: parseInt(port, 10),
      path: '/logs' + (level ? '?level=' + encodeURIComponent(level) : ''),
      method: 'GET',
      timeout: 3000,
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          callback(null, JSON.parse(body));
        } catch (e) {
          callback(e, []);
        }
      });
    });
    req.on('error', (e) => callback(e, []));
    req.on('timeout', () => { req.destroy(); callback(new Error('timeout'), []); });
    req.end();
  }

  setRoutes() {
    const self = this;
    this.router.get('/', function(req, res) {
      const level = 'level' in req.query ? req.query.level : 'error';
      self.fetchBridgeLogs(level, function(err, entries) {
        res.render('status', {
          title: 'Server Status',
          level: level,
          entries: entries,
          bridgeUnavailable: !!err,
        });
      });
    });
  }
}

module.exports = StatusRoutes;
