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

testExtractsNameOnlyPreamble();
testExtractsLoginPreamble();
testExtractsArrayBufferPreamble();
testDetectsFragmentedPreamble();
testDetectsFragmentedArrayPreamble();
testIgnoresNonLoginFrame();
testMessageBufferConversionPreservesBytes();
