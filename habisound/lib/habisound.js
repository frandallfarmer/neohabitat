// habisound.js — public, main-thread API for playing Habitat's SID sounds.
//
//   import { HabiSound } from 'habisound';
//   const hs = new HabiSound();
//   await hs.init();          // must run after a user gesture (autoplay policy)
//   hs.play('TELEPORT_ARRIVAL');
//   hs.playFile('switch_click');
//
// Drop-in for habiworld's client callback:
//   client.sound = (name, noid) => hs.play(name);
//
// All synthesis happens in an AudioWorklet (lib/synth-worklet.js); this class
// just loads the sound bank and forwards play/stop messages to it.

import { resolve } from './names.js';

// The two 3-part tunes, as the C64 client played them: each part is one SID
// oscillator voice, all started together (entry staggering lives in the data).
export const TUNES = {
  title: ['titles_music_v0', 'titles_music_v1', 'titles_music_v2'],
  region_change: ['region_change_music_v0', 'region_change_music_v1', 'region_change_music_v2'],
};

export class HabiSound {
  constructor(opts = {}) {
    // URLs resolve relative to this module by default, so the library works
    // when served as static files with no bundler.
    this.dataUrl = opts.dataUrl || new URL('../data/sounds.json', import.meta.url);
    this.workletUrl = opts.workletUrl || new URL('./synth-worklet.js', import.meta.url);
    this.bank = opts.bank || null; // pre-supply to skip the fetch
    this.ctx = opts.audioContext || null;
    this.node = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) return this;
    if (!this.bank) {
      const res = await fetch(this.dataUrl);
      if (!res.ok) throw new Error(`habisound: failed to load ${this.dataUrl} (${res.status})`);
      this.bank = await res.json();
    }
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.ctx = new AC();
    }
    await this.ctx.audioWorklet.addModule(this.workletUrl);
    this.node = new AudioWorkletNode(this.ctx, 'habisound', { outputChannelCount: [1] });
    this.node.connect(this.ctx.destination);
    this.ready = true;
    return this;
  }

  async resume() {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
  }

  // Play by symbolic name (TELEPORT_ARRIVAL) or by bank key (teleport_arrival).
  // opts.classHint disambiguates generic names like CONTAINER_OPENING.
  play(name, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const key = this._key(name, o);
    if (!key) {
      console.warn(`habisound: cannot resolve sound "${name}"`);
      return false;
    }
    return this.playFile(key);
  }

  // Play a specific bank entry by its file-stem key.
  playFile(key) {
    if (!this.ready) {
      console.warn('habisound: call await init() before playing');
      return false;
    }
    const s = this.bank[key];
    if (!s || !s.voices) {
      console.warn(`habisound: no sound named "${key}"`);
      return false;
    }
    this.resume();
    this.node.port.postMessage({ type: 'play', voices: s.voices, pw: s.pw || null });
    return true;
  }

  // Play a multi-voice piece: partKeys are bank keys, one per oscillator voice
  // (max 3), started together. Use for the 3-part tunes. The piece takes over
  // the chip, as it did in the client.
  playPiece(partKeys) {
    if (!this.ready) {
      console.warn('habisound: call await init() before playing');
      return false;
    }
    const parts = partKeys.slice(0, 3).map((k) => {
      const s = this.bank[k];
      if (!s || !s.voices) console.warn(`habisound: no sound named "${k}"`);
      return { voices: s ? s.voices : null, pw: s ? s.pw || null : null };
    });
    this.resume();
    this.node.port.postMessage({ type: 'playPiece', parts });
    return true;
  }

  // Play one of the named TUNES ('title', 'region_change').
  playTune(name) {
    const keys = TUNES[name];
    if (!keys) { console.warn(`habisound: unknown tune "${name}"`); return false; }
    return this.playPiece(keys);
  }

  // Silence everything (useful for the looping music/continuous effects).
  stop() {
    if (this.node) this.node.port.postMessage({ type: 'stop' });
  }

  // All bank keys, sorted.
  list() {
    return Object.keys(this.bank || {}).sort();
  }

  _key(name, opts) {
    if (this.bank && this.bank[name]) return name; // already a bank key
    return resolve(name, opts);
  }
}

export { resolve } from './names.js';
export default HabiSound;
