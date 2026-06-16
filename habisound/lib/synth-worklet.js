// synth-worklet.js — AudioWorklet wrapper around SidSynth.
//
// Loaded via audioContext.audioWorklet.addModule(); registers the 'habisound'
// processor. All the actual DSP lives in synth.js (so it can also run offline);
// this file just bridges WebAudio's render thread and message port to it.

import { SidSynth } from './synth.js';

class HabiSoundProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = new SidSynth(sampleRate); // `sampleRate` is a worklet global
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'play') {
        const voices = msg.voices ? Uint8Array.from(msg.voices) : null;
        const pw = msg.pw ? Uint8Array.from(msg.pw) : null;
        if (voices) this.synth.play(voices, pw);
      } else if (msg.type === 'stop') {
        this.synth.stop();
      }
    };
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    const out = channels[0];
    if (!out) return true;
    this.synth.render(out);
    for (let ch = 1; ch < channels.length; ch++) channels[ch].set(out);
    return true; // keep alive
  }
}

registerProcessor('habisound', HabiSoundProcessor);
