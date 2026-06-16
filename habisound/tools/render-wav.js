#!/usr/bin/env node
// render-wav.js — render a sound from the bank to a .wav file (offline), using
// the same SidSynth the browser worklet uses. Handy for auditioning sounds
// without a browser and for regression-checking that a sound isn't silent.
//
// Usage:
//   node tools/render-wav.js switch_click            -> switch_click.wav
//   node tools/render-wav.js teleport_arrival out.wav 3   (3 seconds max)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidSynth } from '../lib/synth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'sounds.json'), 'utf8'));

const name = process.argv[2];
const outFile = process.argv[3] || `${name}.wav`;
const maxSeconds = Number(process.argv[4] || 4);
const FS = 44100;

if (!name || !bank[name]) {
  console.error(`usage: render-wav.js <sound> [out.wav] [seconds]\nunknown sound: ${name}`);
  process.exit(1);
}

const synth = new SidSynth(FS);
synth.play(Uint8Array.from(bank[name].voices), bank[name].pw ? Uint8Array.from(bank[name].pw) : null);

// render in blocks until the sound finishes (or hits the cap, for loops)
const block = 1024;
const chunks = [];
const buf = new Float32Array(block);
let total = 0;
const cap = Math.floor(maxSeconds * FS);
// run one block first so the queued sound starts
do {
  synth.render(buf);
  chunks.push(Float32Array.from(buf));
  total += block;
} while (synth.isBusy() && total < cap);
// small tail so releases ring out
for (let t = 0; t < 4; t++) { synth.render(buf); chunks.push(Float32Array.from(buf)); total += block; }

// flatten + measure
const samples = new Float32Array(total);
let off = 0, peak = 0, sumSq = 0;
for (const c of chunks) { samples.set(c, off); off += c.length; }
for (const s of samples) { peak = Math.max(peak, Math.abs(s)); sumSq += s * s; }
const rms = Math.sqrt(sumSq / samples.length);

// write a 16-bit PCM mono WAV
const dataBytes = samples.length * 2;
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + dataBytes, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);     // PCM
header.writeUInt16LE(1, 22);     // mono
header.writeUInt32LE(FS, 24);
header.writeUInt32LE(FS * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(dataBytes, 40);

const pcm = Buffer.alloc(dataBytes);
for (let i = 0; i < samples.length; i++) {
  let s = Math.max(-1, Math.min(1, samples[i]));
  pcm.writeInt16LE((s * 32767) | 0, i * 2);
}
fs.writeFileSync(outFile, Buffer.concat([header, pcm]));

console.log(`Wrote ${outFile}  (${(samples.length / FS).toFixed(2)}s, peak ${peak.toFixed(3)}, rms ${rms.toFixed(4)})`);
if (peak < 0.001) { console.error('WARNING: output is silent!'); process.exit(2); }
