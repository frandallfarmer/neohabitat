#!/usr/bin/env node
// build-sounds.js — parse the original C64 Habitat sound sources into a single
// self-contained JSON bank that habisound ships with.
//
// The sound data lives in Macross assembler source files:
//   *.sob  — the "sound object": the voice (oscillator) bytecode stream
//   *.spb  — the "sound pulse block": the pulse-width ramp bytecode for that sound
// Both are just sequences of `byte` directives (hex/decimal, comma-separated,
// `;` comments). We strip comments and read the byte values verbatim — the
// result is exactly the bytecode the C64 sfx.m interpreter consumed. No
// assembler required.
//
// Usage:  node build-sounds.js [path-to-c64-Sounds-dir]
// Default source dir: ~/habitat-orig/sources/c64/Sounds
// Output: ../data/sounds.json  (committed, so the lib never needs habitat-orig)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const srcDir = process.argv[2] ||
  path.join(os.homedir(), 'habitat-orig', 'sources', 'c64', 'Sounds');
const outFile = path.join(__dirname, '..', 'data', 'sounds.json');

// Pull every `byte` value out of a Macross source file, in order.
// A `byte` directive looks like:  \tbyte\t0x2d,0x0,-1   ; comment
function parseBytes(text) {
  const out = [];
  for (let line of text.split('\n')) {
    // Strip comments first so commented-out `byte` lines are ignored.
    const semi = line.indexOf(';');
    if (semi !== -1) line = line.slice(0, semi);
    const m = line.match(/^\s*byte\s+(.+)$/);
    if (!m) continue;
    for (let tok of m[1].split(',')) {
      tok = tok.trim();
      if (tok === '') continue;
      let v;
      if (/^0x[0-9a-fA-F]+$/.test(tok)) v = parseInt(tok, 16);
      else if (/^-?\d+$/.test(tok)) v = parseInt(tok, 10);
      else throw new Error(`unparseable byte token: "${tok}"`);
      out.push(v & 0xff); // C64 bytes; -1 -> 0xff, etc.
    }
  }
  return out;
}

// base name: strip extension and any leading "%%" (used by the music files).
function baseName(file) {
  return file.replace(/\.(sob|spb|sbb)$/, '').replace(/^%%/, '');
}

const files = fs.readdirSync(srcDir);
const bank = {};

function ensure(name) {
  if (!bank[name]) bank[name] = { voices: null, pw: null };
  return bank[name];
}

for (const file of files.sort()) {
  if (file.endsWith('.sob')) {
    ensure(baseName(file)).voices = parseBytes(fs.readFileSync(path.join(srcDir, file), 'utf8'));
  } else if (file.endsWith('.spb')) {
    ensure(baseName(file)).pw = parseBytes(fs.readFileSync(path.join(srcDir, file), 'utf8'));
  }
  // .sbb files are intermediate/backup build artifacts — ignored.
}

// Drop any entry that ended up with no voice stream (a stray .spb with no .sob).
for (const [name, s] of Object.entries(bank)) {
  if (!s.voices) {
    console.warn(`warning: "${name}" has a .spb but no .sob — keeping pw-only`);
  }
}

const names = Object.keys(bank).sort();
fs.writeFileSync(outFile, JSON.stringify(bank, null, 1) + '\n');

console.log(`Wrote ${names.length} sounds to ${path.relative(process.cwd(), outFile)}`);
const withPw = names.filter((n) => bank[n].pw).length;
console.log(`  ${withPw} have pulse-width (_pw) tracks`);
console.log(`  switch_click voices: [${bank.switch_click?.voices?.join(', ')}]`);
