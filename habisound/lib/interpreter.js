// interpreter.js — a faithful JavaScript port of Habitat's C64 sound driver,
// Main/sfx.m (Randy Farmer, 1986). It runs the original bytecode and writes a
// model of the SID's registers; the synth turns those registers into audio.
//
// The bytecode is a stream of commands. The command byte's bits select which
// data blocks follow (this mirrors sfx.m's `lsr new_command` bit walk):
//
//   0x01 GATE      set/clear the gate bit (oscillator voices only)
//   0x02 STOP      end this effect; +1 link byte (always 0 in Habitat = no chain)
//   0x04 FREQ      new frequency; if the NOW bit (0x40) is clear it is a ramp:
//                    +2 freq lo/hi, +2 duration lo/hi, +2 increment lo/hi
//                  if NOW is set it is immediate: just +2 freq lo/hi
//   0x08 ADSR      +2 attack/decay, sustain/release (oscillator voices only)
//   0x10 EXTEND    +1 sub-command byte, then per sub-bit:
//                    0x01 set pulse width  (+2, osc voices) -> SID PW register
//                    0x02 set filter       (+2 res/vol, +2 cutoff lo/hi)
//                    0x04 set duration     (+2 duration lo/hi, kills any ramp)
//   0x20 WAVEFORM  +1 waveform byte (OR'd into the control register low nibble)
//   0x40 NOW       modifies FREQ to be immediate (no own data bytes)
//   0x80 LOOP      +2 reverse-branch offset, repeat count
//
// There are 7 logical voices: 0..2 = SID oscillators, 3 = filter,
// 4..6 = pulse-width ramp tracks paired to oscillators 0..2 (the `_pw` data).
//
// maintain() is the per-frame tick (call it 60x/sec). Ordering matches
// maintain_sounds: start queued sounds, ramp active voices, then gate them.

import { NUM_REGS } from './sid.js';

const FILTER_VOICE = 3;
const NUM_VOICES = 7;

// voice_offset table from sfx.m: where each logical voice writes in the SID.
// osc 0..2 -> voice bases; filter -> $15; pw 4..6 -> osc 0..2 pulse-width regs.
const VOICE_OFFSET = [0x00, 0x07, 0x0e, 0x15, 0x02, 0x09, 0x10];

function makeVoice() {
  return {
    data: null,       // Uint8Array of bytecode for the sound on this voice
    addr: 0,          // sfx_address: read cursor into data
    command: 0,       // voice_command: last command byte
    control: 0,       // voice_control: SID control register shadow
    freq: 0,          // 16-bit current frequency (freq_hi:freq_lo)
    duration: 0,      // 16-bit frames remaining for the current command
    increment: 0,     // 16-bit per-frame frequency ramp delta
    attackDecay: 0,
    sustainRelease: 0,
    loopCount: 0,
  };
}

export class SfxPlayer {
  constructor() {
    this.regs = new Uint8Array(NUM_REGS);
    this.voices = Array.from({ length: NUM_VOICES }, makeVoice);
    this.active = new Array(NUM_VOICES).fill(false);
    this.queue = new Array(NUM_VOICES).fill(null); // pending start (sound_effect_number)
    // OR-accumulators that sfx.m keeps for the filter setup.
    this.resonanceAndFlags = 0;
    this.volumeAndFilter = 0;
    this.reset();
  }

  reset() {
    this.regs.fill(0);
    // The C64 set $D418 to 0x0F at startup (init.m: "Set volume to max, turn off
    // filter"); the sound effects rely on it and never set it themselves.
    this.regs[0x18] = 0x0f;
    this.volumeAndFilter = 0x0f;
    for (const v of this.voices) Object.assign(v, makeVoice());
    this.active.fill(false);
    this.queue.fill(null);
    this.resonanceAndFlags = 0;
  }

  // Is logical voice vi one of the real SID oscillators (0..2)? Mirrors the
  // `cpx #filter_voice` / voice_flag test used throughout sfx.m.
  isOsc(vi) {
    return vi < FILTER_VOICE;
  }

  // ---- public play API ---------------------------------------------------

  // Queue a sound. voiceData is the .sob bytecode; pwData (optional) is the
  // matching .spb pulse-width bytecode. Returns the oscillator voice used, or
  // -1 if everything is busy and we couldn't place it.
  play(voiceData, pwData = null) {
    let vi = this.active.findIndex((a, i) => i < FILTER_VOICE && !a && !this.queue[i]);
    if (vi === -1) vi = 0; // all busy: steal voice 0 (oldest-ish), like the C64 did
    this.queue[vi] = voiceData;
    if (pwData) this.queue[vi + 4] = pwData; // paired pw voice
    return vi;
  }

  // Play a multi-voice piece: parts[i] = { voices, pw } is assigned to
  // oscillator voice i (and its paired pulse-width voice i+4), with all parts
  // started on the same frame — exactly how the C64 queued the 3-part title and
  // region-change tunes (init.m). Each part's entry timing is in its own
  // bytecode (leading rests), so a simultaneous start reproduces the staggering.
  // The piece takes over the chip (reset first), as it did in the client.
  playPiece(parts) {
    this.reset();
    parts.forEach((part, i) => {
      if (i >= FILTER_VOICE) return; // only the 3 oscillator voices
      if (part.voices) this.queue[i] = part.voices;
      if (part.pw) this.queue[i + 4] = part.pw;
    });
  }

  anyActive() {
    return this.active.some(Boolean);
  }

  // True while there is anything to do: a queued start or a sounding voice.
  // (A queued sound is not "active" until the next maintain() starts it.)
  isBusy() {
    return this.anyActive() || this.queue.some((q) => q != null);
  }

  // ---- per-frame tick (maintain_sounds) ----------------------------------

  maintain() {
    // 1) start any queued sounds (high voice index first, as the C64 looped 6->0)
    for (let vi = NUM_VOICES - 1; vi >= 0; vi--) {
      if (this.queue[vi] != null) {
        const data = this.queue[vi];
        this.queue[vi] = null;
        this._startSound(vi, data);
      }
    }
    if (!this.anyActive()) return;

    // 2) update ramps on active voices
    for (let vi = NUM_VOICES - 1; vi >= 0; vi--) {
      if (this.active[vi]) this._updateRamps(vi);
    }

    // 3) gate (write control registers) on active voices
    for (let vi = NUM_VOICES - 1; vi >= 0; vi--) {
      if (this.active[vi]) this._setVoiceControl(vi);
    }
  }

  // ---- internals (named after their sfx.m routines) ----------------------

  // start_sound_effect + chain_sound_effect
  _startSound(vi, data) {
    const v = this.voices[vi];
    v.loopCount = 0;
    v.data = data;
    v.addr = 0; // BLOCK_data_offset is 0 for our header-less data
    this.active[vi] = true;
    this._nextRamp(vi); // process the first command
  }

  // ready_next_ramp: advance the read cursor past the bytes just consumed.
  // In the asm, y starts at the command byte (0) and `consumed` = y+1.
  _advance(v, consumed) {
    v.addr = (v.addr + consumed) & 0xffff;
  }

  // change_voice: push current freq (and ADSR for oscillators) to the SID.
  _changeVoice(vi) {
    const v = this.voices[vi];
    const off = VOICE_OFFSET[vi];
    this.regs[off] = v.freq & 0xff;
    this.regs[off + 1] = (v.freq >> 8) & 0xff;
    if (this.isOsc(vi)) {
      this.regs[off + 5] = v.attackDecay;
      this.regs[off + 6] = v.sustainRelease;
    }
  }

  // set_voice_control: write the control register (oscillator voices only).
  _setVoiceControl(vi) {
    if (!this.isOsc(vi)) return;
    this.regs[VOICE_OFFSET[vi] + 4] = this.voices[vi].control;
  }

  // terminate_voice: stop a voice; an oscillator also stops its paired pw voice.
  _terminateVoice(vi) {
    this._setVoiceControl(vi);
    this.active[vi] = false;
    if (vi < FILTER_VOICE) {
      this.active[vi + 4] = false; // paired pulse-width track
    }
  }

  // zap_duration: used by immediate ("now") and duration-only commands.
  _zapDuration(v) {
    v.duration = 0;
    v.increment = 0;
  }

  // update_ramps: count down this command's duration; while it lasts, ramp the
  // frequency; when it expires, fetch the next command.
  _updateRamps(vi) {
    const v = this.voices[vi];
    v.duration = (v.duration - 1) & 0xffff;
    if (v.duration === 0xffff) {
      // underflowed past 0 -> duration over, advance to the next command
      this._nextRamp(vi);
    } else {
      v.freq = (v.freq + v.increment) & 0xffff;
    }
    this._changeVoice(vi);
  }

  // next_ramp: read and apply one command (the core decoder). Loops internally
  // for the LOOP command (which jmp's back to next_ramp in the asm).
  //
  // `base` mirrors the asm's sfx_sound pointer: it is captured once per command
  // and all `data[base + y]` reads use it, even while v.addr (the stored cursor
  // for next time) is moved by a reverse branch.
  _nextRamp(vi) {
    const v = this.voices[vi];
    const osc = this.isOsc(vi);

    for (;;) {
      const data = v.data;
      const base = v.addr;
      let y = 0;
      const cmd = data[base + y];
      v.command = cmd;
      let nc = cmd; // new_command: bits get shifted off one at a time

      // --- bit 0: GATE (oscillator voices only) ---
      const gateBit = nc & 1; nc >>= 1;
      if (osc) {
        if (gateBit) v.control |= 0x01; else v.control &= ~0x01;
      }

      // --- bit 1: STOP / chain ---
      const stopBit = nc & 1; nc >>= 1;
      if (stopBit) {
        this._terminateVoice(vi);
        // const link = data[base + 1]; // always 0 in Habitat => no chaining
        return;
      }

      // --- bit 2: FREQ (with optional ramp) ---
      const freqBit = nc & 1; nc >>= 1;
      const nowBit = (cmd & 0x40) !== 0; // "now" => immediate, no ramp
      if (freqBit) {
        const lo = data[base + (++y)];
        const hi = data[base + (++y)];
        v.freq = (hi << 8) | lo;
        if (!nowBit) {
          const dlo = data[base + (++y)];
          const dhi = data[base + (++y)];
          v.duration = (dhi << 8) | dlo;
          const ilo = data[base + (++y)];
          const ihi = data[base + (++y)];
          v.increment = (ihi << 8) | ilo;
        } else {
          this._zapDuration(v);
        }
      } else {
        this._zapDuration(v);
      }

      // --- bit 3: ADSR (oscillator voices only) ---
      const adsrBit = nc & 1; nc >>= 1;
      if (osc && adsrBit) {
        // sfx.m briefly clears gate to retrigger the envelope, then restores it.
        v.attackDecay = data[base + (++y)];
        v.sustainRelease = data[base + (++y)];
      }

      // --- bit 4: EXTEND ---
      const extBit = nc & 1; nc >>= 1;
      if (extBit) {
        let ec = data[base + (++y)];

        // ext bit 0: set pulse width (oscillator voices only)
        const pwBit = ec & 1; ec >>= 1;
        if (osc && pwBit) {
          const pwOff = VOICE_OFFSET[vi + 4]; // this osc's PW register pair
          this.regs[pwOff] = data[base + (++y)];
          this.regs[pwOff + 1] = data[base + (++y)];
        }

        // ext bit 1: set filter
        const filtBit = ec & 1; ec >>= 1;
        if (filtBit) {
          const res = data[base + (++y)];
          this.resonanceAndFlags |= res;
          this.regs[0x17] = this.resonanceAndFlags;
          this.volumeAndFilter = data[base + (++y)];
          this.regs[0x18] = this.volumeAndFilter;
          this.regs[0x15] = data[base + (++y)]; // filter cutoff lo
          this.regs[0x16] = data[base + (++y)]; // filter cutoff hi
        }

        // ext bit 2: set duration only (kills any ramp)
        const durBit = ec & 1; ec >>= 1;
        if (durBit) {
          this._zapDuration(v);
          const dlo = data[base + (++y)];
          const dhi = data[base + (++y)];
          v.duration = (dhi << 8) | dlo;
        }
      }

      // --- bit 5: WAVEFORM ---
      const waveBit = nc & 1; nc >>= 1;
      if (waveBit) {
        v.control = (v.control & 0x0f) | data[base + (++y)];
      }

      // --- bit 6: NOW (consumed above; no data of its own) ---
      nc >>= 1;

      // --- bit 7: LOOP ---
      const loopBit = nc & 1; nc >>= 1;
      if (loopBit) {
        if (v.loopCount === 1) {
          v.loopCount -= 1;       // loop finished
          y += 2;                 // skip the 2 loop bytes
          v.addr = (base + y + 1) & 0xffff;
          continue;               // jmp next_ramp -> process what follows
        } else {
          const back = data[base + (++y)];   // reverse-branch distance
          v.addr = (base - back) & 0xffff;   // move the stored cursor back
          const countByte = data[base + (++y)];
          if (v.loopCount === 0) {
            v.loopCount = countByte; // start the loop
          } else {
            v.loopCount -= 1;        // continue the loop
          }
          continue;                  // jmp next_ramp (reads from new v.addr)
        }
      }

      // normal end of one command: advance past the bytes we consumed.
      this._advance(v, y + 1);
      return;
    }
  }
}
