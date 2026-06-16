// synth.js — a hand-rolled SID-style voice synthesizer (no WebAudio deps).
//
// It owns the ported sfx.m interpreter (SfxPlayer) and turns the SID register
// shadow into audio samples. render() fills a Float32Array; the same class is
// used by the AudioWorklet (live) and by offline tools/tests (render to WAV).
//
// The synthesis is a faithful approximation of the 6581, not a cycle-exact
// emulation: tri/saw/pulse/noise oscillators, classic ADSR timing, ring mod,
// hard sync, and a state-variable multimode filter.

import { SfxPlayer } from './interpreter.js';
import {
  SID_CLOCK_NTSC, FRAME_RATE,
  GATE, SYNC, RING, TEST, TRIANGLE, SAWTOOTH, PULSE, NOISE,
  FILT_VOICE1, FILT_VOICE2, FILT_VOICE3,
  LOW_PASS, BAND_PASS, HIGH_PASS,
  VOICE_BASE, sidFreqToHz, sidPulseToDuty,
  ATTACK_MS, DECAY_RELEASE_MS,
} from './sid.js';

const ENV_ATTACK = 0, ENV_DECAY = 1, ENV_SUSTAIN = 2, ENV_RELEASE = 3, ENV_OFF = 4;
const FILT_MASK = [FILT_VOICE1, FILT_VOICE2, FILT_VOICE3];

class OscState {
  constructor() {
    this.phase = 0;
    this.lfsr = 0x7ffff8;  // 23-bit noise shift register (non-zero seed)
    this.noiseAccum = 0;   // fractional LFSR-clock accumulator (sample & hold)
    this.noiseSample = 0;
    this.env = 0;
    this.stage = ENV_OFF;
    this.lastGate = 0;
  }
}

export class SidSynth {
  constructor(sampleRate) {
    this.fs = sampleRate;
    this.player = new SfxPlayer();
    this.osc = [new OscState(), new OscState(), new OscState()];
    this.samplesPerFrame = this.fs / FRAME_RATE;
    this.frameAccum = 0;
    this.flpf = 0;
    this.fbpf = 0;
  }

  play(voices, pw = null) { this.player.play(voices, pw); }
  stop() { this.player.reset(); for (const o of this.osc) Object.assign(o, new OscState()); }
  isBusy() { return this.player.isBusy(); }

  // Clock the 23-bit noise LFSR once (bit22 ^ bit17 feedback) and latch a new
  // held output sample. The 6581 noise output is assembled from a spread of
  // LFSR bits (same bits reSID uses), giving 0..255 -> -1..1.
  _clockNoiseOnce(o) {
    let r = o.lfsr;
    const fb = ((r >> 22) ^ (r >> 17)) & 1;
    r = ((r << 1) | fb) & 0x7fffff;
    o.lfsr = r;
    const out =
      (((r >> 22) & 1) << 7) | (((r >> 20) & 1) << 6) |
      (((r >> 16) & 1) << 5) | (((r >> 13) & 1) << 4) |
      (((r >> 11) & 1) << 3) | (((r >> 7) & 1) << 2) |
      (((r >> 4) & 1) << 1) | ((r >> 2) & 1);
    o.noiseSample = out / 127.5 - 1;
  }

  // Advance noise for one output sample. The LFSR is clocked at a rate set by
  // the frequency register (~ freq * clock / 2^20 Hz), and the output is HELD
  // between clocks — that sample-and-hold is what makes low frequencies a low
  // rumble instead of full-bandwidth static.
  _advanceNoise(o, freqReg) {
    o.noiseAccum += (freqReg * SID_CLOCK_NTSC) / 1048576 / this.fs; // 2^20
    let guard = 0;
    while (o.noiseAccum >= 1 && guard < 64) {
      this._clockNoiseOnce(o);
      o.noiseAccum -= 1;
      guard++;
    }
    if (o.noiseAccum >= 1) o.noiseAccum = 0; // clamp pathological rates
  }

  _stepEnv(o, regs, base) {
    const ad = regs[base + 5];
    const sr = regs[base + 6];
    const gate = regs[base + 4] & GATE;

    const attackRate = ATTACK_MS[(ad >> 4) & 0xf];
    const decayRate = DECAY_RELEASE_MS[ad & 0xf];
    const sustainLevel = ((sr >> 4) & 0xf) / 15;
    const releaseRate = DECAY_RELEASE_MS[sr & 0xf];

    if (gate && !o.lastGate) o.stage = ENV_ATTACK;
    else if (!gate && o.lastGate) o.stage = ENV_RELEASE;
    o.lastGate = gate;

    const dt = 1000 / this.fs; // ms per sample
    switch (o.stage) {
      case ENV_ATTACK:
        o.env += dt / Math.max(attackRate, 0.1);
        if (o.env >= 1) { o.env = 1; o.stage = ENV_DECAY; }
        break;
      case ENV_DECAY:
        o.env -= (dt / Math.max(decayRate, 0.1)) * (o.env - sustainLevel + 0.001);
        if (o.env <= sustainLevel + 0.001) { o.env = sustainLevel; o.stage = ENV_SUSTAIN; }
        break;
      case ENV_SUSTAIN:
        o.env = sustainLevel;
        break;
      case ENV_RELEASE:
        o.env -= (dt / Math.max(releaseRate, 0.1)) * (o.env + 0.001);
        if (o.env <= 0.0005) { o.env = 0; o.stage = ENV_OFF; }
        break;
      default:
        o.env = 0;
    }
    return o.env;
  }

  _oscSample(v, regs) {
    const base = VOICE_BASE[v];
    const control = regs[base + 4];
    const waveBits = control & 0xf0;
    const o = this.osc[v];

    if (waveBits === 0) { this._stepEnv(o, regs, base); return 0; }

    const freqReg = regs[base] | (regs[base + 1] << 8);
    const hz = sidFreqToHz(freqReg, SID_CLOCK_NTSC);
    const duty = sidPulseToDuty(regs[base + 2] | (regs[base + 3] << 8));

    if (control & TEST) {
      o.phase = 0;
    } else {
      o.phase += hz / this.fs;
      if (o.phase >= 1) {
        o.phase -= Math.floor(o.phase);
        const next = (v + 1) % 3;
        if (regs[VOICE_BASE[next] + 4] & SYNC) this.osc[next].phase = 0; // hard sync
      }
      if (waveBits & NOISE) this._advanceNoise(o, freqReg);
    }

    // ring mod XORs the triangle with the previous voice's phase MSB
    const ringFrom = (control & RING) ? this.osc[(v + 2) % 3].phase : null;
    let sample = 0, parts = 0;
    if (waveBits & TRIANGLE) {
      let p = o.phase;
      if (ringFrom != null && ringFrom >= 0.5) p = (p + 0.5) % 1;
      sample += p < 0.5 ? (4 * p - 1) : (3 - 4 * p);
      parts++;
    }
    if (waveBits & SAWTOOTH) { sample += 2 * o.phase - 1; parts++; }
    if (waveBits & PULSE) { sample += o.phase < duty ? 1 : -1; parts++; }
    if (waveBits & NOISE) { sample += o.noiseSample; parts++; }
    if (parts > 1) sample /= parts; // combined waveforms AND on hardware; averaging is a usable stand-in

    return sample * this._stepEnv(o, regs, base);
  }

  // Fill `buf` (Float32Array, mono) with `length` samples.
  render(buf, length = buf.length) {
    const regs = this.player.regs;
    for (let i = 0; i < length; i++) {
      if (this.frameAccum <= 0) {
        if (this.player.isBusy()) this.player.maintain();
        this.frameAccum += this.samplesPerFrame;
      }
      this.frameAccum -= 1;

      let dry = 0, wet = 0;
      const routing = regs[0x17];
      for (let v = 0; v < 3; v++) {
        const out = this._oscSample(v, regs);
        if (routing & FILT_MASK[v]) wet += out; else dry += out;
      }

      // state-variable filter over the routed (wet) voices
      const modeReg = regs[0x18];
      let filtered = wet;
      if (wet !== 0 || this.flpf !== 0 || this.fbpf !== 0) {
        const cutoffReg = (regs[0x15] & 0x07) | (regs[0x16] << 3); // 11-bit
        const fc = 30 + (cutoffReg / 2047) * 11970;
        const f = 2 * Math.sin(Math.PI * Math.min(fc, this.fs / 2.2) / this.fs);
        const resReg = (regs[0x17] >> 4) & 0xf;
        const q = 1.2 - (resReg / 15) * 1.1;
        const hpf = wet - this.flpf - q * this.fbpf;
        this.fbpf += f * hpf;
        this.flpf += f * this.fbpf;
        let band = 0;
        if (modeReg & LOW_PASS) band += this.flpf;
        if (modeReg & BAND_PASS) band += this.fbpf;
        if (modeReg & HIGH_PASS) band += hpf;
        filtered = band;
      }

      const volume = (regs[0x18] & 0x0f) / 15;
      let s = (dry + filtered) * volume * 0.28; // headroom for 3 voices
      if (s > 1) s = 1; else if (s < -1) s = -1;
      buf[i] = s;
    }
    return buf;
  }
}
