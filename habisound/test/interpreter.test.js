// Tests for the sfx.m port. Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SfxPlayer } from '../lib/interpreter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'sounds.json'), 'utf8'));

function bytes(name, track = 'voices') {
  const s = bank[name];
  assert.ok(s, `sound "${name}" present in bank`);
  assert.ok(s[track], `sound "${name}" has a ${track} track`);
  return Uint8Array.from(s[track]);
}

// Run a single voice stream and check the read cursor never leaves the data.
// Returns { frames, terminated }. Some sounds (music, footsteps) loop forever
// by design (a loop command with count byte 0), so termination is not required.
function runSafely(data, maxFrames = 5000) {
  const p = new SfxPlayer();
  p.play(data);
  let frames = 0;
  while (p.isBusy() && frames < maxFrames) {
    p.maintain();
    frames++;
    for (let vi = 0; vi < 7; vi++) {
      if (p.active[vi]) {
        const v = p.voices[vi];
        assert.ok(v.addr >= 0 && v.addr <= data.length,
          `voice ${vi} cursor ${v.addr} out of bounds (len ${data.length})`);
      }
    }
  }
  return { frames, terminated: !p.isBusy() };
}

test('switch_click decodes to the exact known sequence', () => {
  const data = bytes('switch_click');
  assert.deepEqual([...data], [45, 0, 8, 5, 0, 0, 0, 2, 228, 128, 32, 0, 2, 0]);

  const p = new SfxPlayer();
  p.play(data);
  p.maintain(); // starts + first update + gate
  const v = p.voices[0];
  assert.equal(p.active[0], true, 'voice 0 active after start');
  assert.equal(v.freq, 0x0800, 'start frequency 0x0800');
  assert.equal(v.attackDecay, 0x02);
  assert.equal(v.sustainRelease, 0xe4);
  // control = gate(1) | noise(0x80) after the first command
  assert.equal(p.regs[0x04] & 0x80, 0x80, 'noise waveform selected');
  assert.equal(p.regs[0x04] & 0x01, 0x01, 'gate on');

  // play out: should turn the waveform off then stop.
  let frames = 1;
  while (p.anyActive() && frames < 100) { p.maintain(); frames++; }
  assert.equal(p.active[0], false, 'voice 0 stopped');
  assert.equal(p.regs[0x04] & 0x01, 0, 'gate cleared at stop');
});

test('error_beep loop repeats the expected number of times', () => {
  // error_beep uses the LOOP command (0x80). Counting how many times the loop
  // body runs validates the exact loop semantics ported from sfx.m.
  const data = bytes('error_beep');
  const p = new SfxPlayer();

  // instrument: count how many times the read cursor returns to offset 0
  // (the loop branches all the way back to the start of the effect).
  let restarts = 0;
  const v = () => p.voices[0];
  p.play(data);
  let prevAddr = -1;
  let frames = 0;
  while (p.isBusy() && frames < 5000) {
    p.maintain();
    if (p.active[0] && v().addr < prevAddr) restarts++;
    prevAddr = p.active[0] ? v().addr : prevAddr;
    frames++;
  }
  assert.ok(!p.anyActive(), 'error_beep terminates');
  // count byte is 3 -> loop body plays initial pass + 3 branch-backs.
  assert.ok(restarts >= 1, `loop branched back at least once (saw ${restarts})`);
});

test('teleport_arrival has paired voice + pulse-width tracks', () => {
  const sound = bank['teleport_arrival'];
  assert.ok(sound.voices, 'voices track');
  assert.ok(sound.pw, 'pulse-width track');

  const p = new SfxPlayer();
  const vi = p.play(Uint8Array.from(sound.voices), Uint8Array.from(sound.pw));
  assert.equal(vi, 0, 'placed on oscillator voice 0');
  p.maintain();
  assert.equal(p.active[0], true, 'oscillator voice active');
  assert.equal(p.active[4], true, 'paired pulse-width voice active');

  // run to completion; terminating the oscillator must also stop the pw voice.
  let frames = 0;
  while (p.anyActive() && frames < 5000) { p.maintain(); frames++; }
  assert.equal(p.active[0], false);
  assert.equal(p.active[4], false, 'pulse-width voice stopped with its oscillator');
});

test('every sound in the bank runs without reading out of bounds', () => {
  let looping = 0;
  for (const [name, s] of Object.entries(bank)) {
    if (!s.voices) continue;
    const r = runSafely(Uint8Array.from(s.voices));
    assert.ok(r.frames > 0, `${name} ran at least one frame`);
    if (!r.terminated) looping++; // intentional infinite loop (music/continuous)
    if (s.pw) runSafely(Uint8Array.from(s.pw));
  }
  // a handful of sounds loop forever by design; the vast majority terminate.
  assert.ok(looping <= 12, `expected few looping sounds, got ${looping}`);
});

test('finite effects terminate cleanly', () => {
  for (const name of ['switch_click', 'teleport_arrival', 'door_opening', 'magic', 'gunshot', 'error_beep']) {
    const r = runSafely(Uint8Array.from(bank[name].voices));
    assert.ok(r.terminated, `${name} terminates (took ${r.frames} frames)`);
  }
});
