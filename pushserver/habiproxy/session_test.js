const assert = require('assert');
const EventEmitter = require('events');

const HabitatSession = require('./session');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.remoteAddress = '127.0.0.1';
    this.remotePort = 1;
    this.writes = [];
  }

  write(buffer) {
    this.writes.push(buffer.toString());
  }

  end() {}

  destroy() {}
}

function newSession() {
  const client = new FakeSocket();
  const server = new FakeSocket();
  const session = new HabitatSession('elko', 9000, client);
  session.serverConnection = server;
  return {session, client, server};
}

function testSuppressesHatcheryControlMessages() {
  const {session, server} = newSession();
  const events = [];
  session.onClient('hatcheryState', function(s, message) {
    events.push(message);
  });

  session.handleClientData(Buffer.from(
    '{"to":"habiproxy","op":"HATCHERY_STATE","state":"started","avatar":"Alice","user":"user-alice","session":"session-42"}\n\n'
  ));

  assert.deepStrictEqual(server.writes, []);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].state, 'started');
  assert.strictEqual(session.hatcheryState, 'started');
  assert.strictEqual(session.hatcheryAvatar, 'Alice');
  assert.strictEqual(session.hatcheryUser, 'user-alice');
  assert.strictEqual(session.hatcherySession, 'session-42');
}

function testForwardsNormalMessages() {
  const {session, server} = newSession();
  session.handleClientData(Buffer.from(
    '{"to":"avatar","op":"HELP"}\n\n'
  ));

  assert.deepStrictEqual(server.writes, ['{"to":"avatar","op":"HELP"}\n\n']);
}

function testBuffersPartialMessagesBeforeForwarding() {
  const {session, server} = newSession();
  session.handleClientData(Buffer.from('{"to":"avatar"'));
  assert.deepStrictEqual(server.writes, []);

  session.handleClientData(Buffer.from(',"op":"HELP"}\n\n'));
  assert.deepStrictEqual(server.writes, ['{"to":"avatar","op":"HELP"}\n\n']);
}

testSuppressesHatcheryControlMessages();
testForwardsNormalMessages();
testBuffersPartialMessagesBeforeForwarding();
