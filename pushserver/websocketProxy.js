const http = require('http');
const net = require('net');

const WebSocketServer = require('ws').Server;
const log = require('winston');

const docentTracker = require('./docentTracker');

const MAX_LOGIN_PREAMBLE_BYTES = 4096;

function parseHostPort(value) {
  var idx = value.lastIndexOf(':');
  if (idx < 0) {
    throw new Error('Expected host:port, got ' + value);
  }
  return {
    host: value.slice(0, idx),
    port: parseInt(value.slice(idx + 1), 10),
  };
}

function parseCookies(header) {
  var cookies = {};
  if (!header) {
    return cookies;
  }
  header.split(';').forEach(function(part) {
    var idx = part.indexOf('=');
    if (idx < 0) {
      return;
    }
    var name = part.slice(0, idx).trim();
    var value = part.slice(idx + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch (err) {
      // Keep the raw cookie value if it is not URI-encoded.
    }
    cookies[name] = value;
  });
  return cookies;
}

function websocketMessageToBuffer(message) {
  if (Buffer.isBuffer(message)) {
    return message;
  }
  if (Array.isArray(message)) {
    return Buffer.concat(message.map(websocketMessageToBuffer));
  }
  if (message instanceof ArrayBuffer) {
    return Buffer.from(message);
  }
  if (ArrayBuffer.isView(message)) {
    return Buffer.from(message.buffer, message.byteOffset, message.byteLength);
  }
  return Buffer.from(String(message), 'utf8');
}

function extractLoginName(message) {
  var text = websocketMessageToBuffer(message).toString('utf8');
  if (text.indexOf('{') === -1) {
    return null;
  }
  // C64 / binary Habilink preamble carries the avatar name as "name":"Alice".
  if (text.indexOf('"name"') !== -1) {
    var match = text.match(/"name"\s*:\s*"([^"]*)"/);
    if (match) {
      return match[1];
    }
  }
  // The all-JS web client's entercontext carries it as "user":"user-alice" (no "name" field),
  // so the docent (/neohabitat) can follow a web-client avatar the same way it follows the C64.
  var userMatch = text.match(/"user"\s*:\s*"user-([^"]*)"/);
  if (userMatch) {
    return userMatch[1];
  }
  return null;
}

class LoginNameDetector {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.complete = false;
  }

  push(message) {
    if (this.complete) {
      return null;
    }
    var chunk = websocketMessageToBuffer(message);
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_LOGIN_PREAMBLE_BYTES) {
      this.complete = true;
      return null;
    }
    var avatarName = extractLoginName(this.buffer);
    if (avatarName) {
      this.complete = true;
      return avatarName;
    }
    return null;
  }
}

function startWebsocketProxy(config) {
  var source = parseHostPort(config.source);
  var target = parseHostPort(config.target);
  var server = http.createServer(function(req, res) {
    res.writeHead(403, {'Content-Type': 'text/plain'});
    res.end('403 Permission Denied\n');
  });
  var wsServer = new WebSocketServer({server: server});

  wsServer.on('connection', function(client, req) {
    var clientAddr = client._socket.remoteAddress;
    var cookies = parseCookies(req.headers.cookie);
    var docentSessionId = cookies.docentSessionId;
    // Prefer an explicit ?docent=<id> on the WS URL over the cookie: the /neohabitat docent page is
    // served over HTTP :80 while this game socket is HTTPS :443 (behind Caddy), and schemeful
    // SameSite drops the docentSessionId cookie across that http->https hop, so it arrives 'unknown'.
    // The webclient forwards the id as a query param (as the SSE already does), which is scheme-safe.
    try {
      var docentQuery = new URL(req.url, 'http://localhost').searchParams.get('docent');
      if (docentQuery) {
        docentSessionId = docentQuery;
      }
    } catch (err) {
      // Malformed URL — fall back to the cookie value.
    }
    var loginNameDetector = new LoginNameDetector();

    log.info('WebSocket connection from %s', clientAddr);

    var targetSocket = net.createConnection(target.port, target.host, function() {
      log.debug('WebSocket proxy connected %s to %s:%s',
        clientAddr, target.host, target.port);
    });

    targetSocket.on('data', function(data) {
      try {
        client.send(data);
      } catch (err) {
        log.debug('WebSocket client closed, ending target connection: %s', err);
        targetSocket.end();
      }
    });

    targetSocket.on('end', function() {
      client.close();
    });

    targetSocket.on('error', function(err) {
      log.error('WebSocket proxy target connection error: %s', err);
      targetSocket.end();
      client.close();
    });

    client.on('message', function(message) {
      var targetMessage = websocketMessageToBuffer(message);
      var avatarName = loginNameDetector.push(targetMessage);
      if (avatarName) {
        docentTracker.registerLogin(docentSessionId, avatarName);
        log.info('Mapped websocket docent session %s to avatar %s',
          docentSessionId || 'unknown', avatarName);
      }
      targetSocket.write(targetMessage);
    });

    client.on('close', function(code, reason) {
      log.info('WebSocket client disconnected: %s [%s]', code, reason);
      targetSocket.end();
    });

    client.on('error', function(err) {
      log.error('WebSocket client error: %s', err);
      targetSocket.end();
    });
  });

  server.listen(source.port, source.host, function() {
    log.info('WebSocket proxy listening on %s:%s and forwarding to %s:%s',
      source.host, source.port, target.host, target.port);
  });
}

module.exports = startWebsocketProxy;
module.exports.extractLoginName = extractLoginName;
module.exports.LoginNameDetector = LoginNameDetector;
module.exports.websocketMessageToBuffer = websocketMessageToBuffer;
