// sid.js — the MOS 6581 "SID" register model + chip constants.
//
// This is just state + constants; no audio happens here. The interpreter
// (interpreter.js) writes these registers exactly as the C64 sfx.m driver
// wrote $D400..$D418, and the synth (synth-worklet.js) reads them to make sound.
//
// Register map (offsets from $D400), three voices at stride 7:
//   voice base v*7:  +0 freq lo   +1 freq hi
//                    +2 PW lo     +3 PW hi      (12-bit pulse width)
//                    +4 control   (gate/sync/ring/test + waveform select)
//                    +5 attack/decay   +6 sustain/release
//   $15 filter cutoff lo (3 bits)   $16 filter cutoff hi
//   $17 resonance (hi nibble) + filter routing (voice enable bits)
//   $18 volume (lo nibble) + filter mode (hi bits)

export const NUM_REGS = 0x19; // we write $00..$18

// SID system clock (Hz). Habitat shipped on NTSC machines.
export const SID_CLOCK_NTSC = 1022727;
export const SID_CLOCK_PAL = 985248;

// maintain_sounds() ran once per video frame (vblank.m). NTSC vertical refresh.
export const FRAME_RATE = 60;

// control register ($D404 etc.) bits — must match sfx.m's equates.
export const GATE = 0x01;
export const SYNC = 0x02;
export const RING = 0x04;
export const TEST = 0x08;
export const TRIANGLE = 0x10;
export const SAWTOOTH = 0x20;
export const PULSE = 0x40;
export const NOISE = 0x80;

// $D417 resonance/routing: low bits route a voice through the filter.
export const FILT_VOICE1 = 0x01;
export const FILT_VOICE2 = 0x02;
export const FILT_VOICE3 = 0x04;

// $D418 volume/mode: high bits pick the filter mode.
export const LOW_PASS = 0x10;
export const BAND_PASS = 0x20;
export const HIGH_PASS = 0x40;
export const VOICE3_OFF = 0x80;

// Voice oscillator base offsets (voices 0..2).
export const VOICE_BASE = [0x00, 0x07, 0x0e];

// SID register-value -> output frequency in Hz.
export function sidFreqToHz(reg, clock = SID_CLOCK_NTSC) {
  return (reg * clock) / 16777216; // reg * clock / 2^24
}

// 12-bit pulse-width register -> duty cycle 0..1 (0xfff ~= 100%).
export function sidPulseToDuty(pw12) {
  return (pw12 & 0xfff) / 4096;
}

// Classic 6581 ADSR durations. Index 0..15 from the attack/decay &
// sustain/release nibbles. Attack is the time 0->peak; decay/release are the
// time peak->0 (they are 3x the attack times on the real chip). Values in ms.
export const ATTACK_MS = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000];
export const DECAY_RELEASE_MS = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000];
