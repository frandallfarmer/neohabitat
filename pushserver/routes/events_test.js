const assert = require('assert');
const EventEmitter = require('events');

const EventRoutes = require('./events');
const docentTracker = require('../docentTracker');

class FakeHabiproxy extends EventEmitter {
  constructor() {
    super();
    this.sessions = {};
  }

  off(eventType, callback) {
    this.removeListener(eventType, callback);
  }
}

class FakeResponse {
  constructor() {
    this.headers = null;
    this.writes = [];
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  write(chunk) {
    this.writes.push(chunk);
  }
}

function fakeRequest(path) {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = path;
  req.query = {};
  var queryStart = path.indexOf('?');
  if (queryStart !== -1) {
    path.slice(queryStart + 1).split('&').forEach(function(part) {
      var idx = part.indexOf('=');
      if (idx === -1) {
        req.query[decodeURIComponent(part)] = '';
      } else {
        req.query[decodeURIComponent(part.slice(0, idx))] =
          decodeURIComponent(part.slice(idx + 1));
      }
    });
  }
  req.socket = {
    setTimeout: function() {},
  };
  return req;
}

function parseEvent(write) {
  const json = write.replace(/^data: /, '').trim();
  return JSON.parse(json);
}

function openHatcheryStream(habiproxy) {
  docentTracker.clear();
  docentTracker.removeAllListeners('avatarReady');
  const routes = new EventRoutes(habiproxy, {externalPages: {}}, null);
  const req = fakeRequest('/hatchery/eventStream?docent=docent-1');
  const res = new FakeResponse();
  routes.router.handle(req, res, function(err) {
    throw err || new Error('unexpected next() from hatchery event stream');
  });
  return {req, res};
}

function testSessionReadyEmitsAvatarReady() {
  const habiproxy = new FakeHabiproxy();
  const {res} = openHatcheryStream(habiproxy);

  docentTracker.registerLogin('docent-1', 'Alice');
  habiproxy.emit('sessionReady', {avatarName: 'Alice'});

  const event = parseEvent(res.writes[2]);
  assert.strictEqual(event.type, 'AVATAR_READY');
  assert.deepStrictEqual(event.msg, {avatar: 'Alice'});
}

function testSessionReadyIgnoresUnknownAvatar() {
  const habiproxy = new FakeHabiproxy();
  const {res} = openHatcheryStream(habiproxy);

  docentTracker.registerLogin('docent-1', 'Alice');
  habiproxy.emit('sessionReady', {avatarName: 'unknown'});
  habiproxy.emit('sessionReady', {});
  habiproxy.emit('sessionReady', {avatarName: 'ElizaBot'});

  assert.strictEqual(res.writes.length, 2);
}

function testSessionReadyIgnoresOtherDocentAvatar() {
  const habiproxy = new FakeHabiproxy();
  const {res} = openHatcheryStream(habiproxy);

  docentTracker.registerLogin('docent-1', 'Alice');
  docentTracker.registerLogin('docent-2', 'ElizaBot');
  habiproxy.emit('sessionReady', {avatarName: 'ElizaBot'});

  assert.strictEqual(res.writes.length, 2);
}

function testHatcheryCompletionStillEmits() {
  const habiproxy = new FakeHabiproxy();
  const {res} = openHatcheryStream(habiproxy);

  docentTracker.registerLogin('docent-1', 'Alice');
  habiproxy.emit('hatcheryCompleted', {}, {
    avatar: 'Alice',
    user: 'user-alice',
    session: 'session-42',
  });

  const event = parseEvent(res.writes[2]);
  assert.strictEqual(event.type, 'HATCHERY_COMPLETED');
  assert.deepStrictEqual(event.msg, {
    avatar: 'Alice',
    user: 'user-alice',
    session: 'session-42',
  });
}

function testHatcheryPathEmitsAvatarReadyWhenSessionIsReady() {
  const habiproxy = new FakeHabiproxy();
  const {res} = openHatcheryStream(habiproxy);

  docentTracker.registerLogin('docent-1', 'Alice');
  habiproxy.emit('hatcheryStarted', {}, {
    avatar: 'Alice',
    user: 'user-alice',
    session: 'session-42',
  });
  habiproxy.emit('sessionReady', {avatarName: 'Alice'});
  habiproxy.emit('hatcheryCompleted', {}, {
    avatar: 'Alice',
    user: 'user-alice',
    session: 'session-42',
  });

  assert.strictEqual(parseEvent(res.writes[2]).type, 'HATCHERY_STARTED');
  assert.strictEqual(parseEvent(res.writes[3]).type, 'AVATAR_READY');
  assert.strictEqual(parseEvent(res.writes[4]).type, 'HATCHERY_COMPLETED');
  assert.strictEqual(res.writes.length, 5);
}

function testCloseRemovesBootstrapListeners() {
  const habiproxy = new FakeHabiproxy();
  const {req} = openHatcheryStream(habiproxy);

  assert.strictEqual(habiproxy.listenerCount('hatcheryStarted'), 1);
  assert.strictEqual(habiproxy.listenerCount('hatcheryCompleted'), 1);
  assert.strictEqual(habiproxy.listenerCount('sessionReady'), 1);
  assert.strictEqual(docentTracker.listenerCount('avatarReady'), 1);

  req.emit('close');

  assert.strictEqual(habiproxy.listenerCount('hatcheryStarted'), 0);
  assert.strictEqual(habiproxy.listenerCount('hatcheryCompleted'), 0);
  assert.strictEqual(habiproxy.listenerCount('sessionReady'), 1);
  assert.strictEqual(docentTracker.listenerCount('avatarReady'), 0);
}

testSessionReadyEmitsAvatarReady();
testSessionReadyIgnoresUnknownAvatar();
testSessionReadyIgnoresOtherDocentAvatar();
testHatcheryCompletionStillEmits();
testHatcheryPathEmitsAvatarReadyWhenSessionIsReady();
testCloseRemovesBootstrapListeners();
