const assert = require('assert');

const websocketProxy = require('./websocketProxy');

function testExtractsNameOnlyPreamble() {
  assert.strictEqual(
    websocketProxy.extractLoginName(Buffer.from('{"name":"Stu"}\r{"ready":true}\r')),
    'Stu');
}

function testExtractsLoginPreamble() {
  assert.strictEqual(
    websocketProxy.extractLoginName(Buffer.from('{"to":"bridge","op":"LOGIN","name":"Alice"}\n')),
    'Alice');
}

function testExtractsArrayBufferPreamble() {
  const bytes = new TextEncoder().encode('{"name":"Bob"}\r');
  assert.strictEqual(
    websocketProxy.extractLoginName(bytes.buffer),
    'Bob');
}

function testDetectsFragmentedPreamble() {
  const detector = new websocketProxy.LoginNameDetector();
  assert.strictEqual(detector.push(Buffer.from('{"na')), null);
  assert.strictEqual(detector.push(Buffer.from('me":"Stu')), null);
  assert.strictEqual(detector.push(Buffer.from('"}\r{"ready":true}\r')), 'Stu');
  assert.strictEqual(detector.push(Buffer.from('{"name":"Other"}\r')), null);
}

function testDetectsFragmentedArrayPreamble() {
  const detector = new websocketProxy.LoginNameDetector();
  assert.strictEqual(detector.push([Buffer.from('{"name"'), Buffer.from(':"ArrayStu"')]), 'ArrayStu');
  assert.strictEqual(detector.push(Buffer.from('}\r')), null);
}

function testIgnoresNonLoginFrame() {
  assert.strictEqual(
    websocketProxy.extractLoginName(Buffer.from([0x5a, 0x81, 0x42, 0x31, 0x4e, 0x0d])),
    null);
}

function testMessageBufferConversionPreservesBytes() {
  const bytes = Uint8Array.from([0x5a, 0x81, 0x42, 0x0d]);
  assert.deepStrictEqual(
    Array.from(websocketProxy.websocketMessageToBuffer(bytes)),
    Array.from(bytes));
}

function fakeReq(remoteAddress, xff, remotePort) {
  return {
    socket: {remoteAddress: remoteAddress, remotePort: remotePort || 4242},
    headers: xff ? {'x-forwarded-for': xff} : {},
  };
}

function testRealClientAddressTrustsForwardedFromPrivatePeer() {
  assert.strictEqual(
    websocketProxy.realClientAddress(fakeReq('::ffff:172.18.0.2', '60.234.208.18')),
    '60.234.208.18');
  assert.strictEqual(
    websocketProxy.realClientAddress(fakeReq('127.0.0.1', '60.234.208.18, 10.0.0.1')),
    '60.234.208.18');
}

function testRealClientAddressIgnoresForwardedFromPublicPeer() {
  assert.strictEqual(
    websocketProxy.realClientAddress(fakeReq('::ffff:8.8.8.8', '1.2.3.4')),
    '8.8.8.8');
}

function testRealClientAddressFallsBackToPeer() {
  assert.strictEqual(
    websocketProxy.realClientAddress(fakeReq('::ffff:172.18.0.2', null)),
    '172.18.0.2');
}

function testProxyProtocolLine() {
  assert.strictEqual(
    websocketProxy.proxyProtocolLine('60.234.208.18', 51234, 2026),
    'PROXY TCP4 60.234.208.18 127.0.0.1 51234 2026\r\n');
  assert.strictEqual(
    websocketProxy.proxyProtocolLine('2001:db8::7', 51234, 2026),
    'PROXY TCP6 2001:db8::7 ::1 51234 2026\r\n');
  assert.strictEqual(
    websocketProxy.proxyProtocolLine('60.234.208.18', undefined, 2026),
    'PROXY TCP4 60.234.208.18 127.0.0.1 0 2026\r\n');
}

testExtractsNameOnlyPreamble();
testExtractsLoginPreamble();
testExtractsArrayBufferPreamble();
testDetectsFragmentedPreamble();
testDetectsFragmentedArrayPreamble();
testIgnoresNonLoginFrame();
testMessageBufferConversionPreservesBytes();
testRealClientAddressTrustsForwardedFromPrivatePeer();
testRealClientAddressIgnoresForwardedFromPublicPeer();
testRealClientAddressFallsBackToPeer();
testProxyProtocolLine();
