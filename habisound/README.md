# habisound

Play Habitat's original Commodore 64 sound effects in a web browser.

Habitat's audio was driven by a custom SID-chip bytecode player Randy Farmer wrote in
1986 (`sources/c64/Main/sfx.m`) plus ~120 sound data files (`sources/c64/Sounds/*.sob`
and `*.spb`). `habisound` is a dependency-free JavaScript port of that driver: it runs
the **original bytecode** through a faithful JS port of the interpreter and synthesizes
the SID output live with the Web Audio API. No samples, no recordings — the sounds are
generated the same way the C64 generated them.

It is a **client-side consumer**: habiworld already emits sound events symbolically
(`ctx.sound('TELEPORT_ARRIVAL', noid)`); habisound turns those names into sound. It does
not depend on or modify habiworld, habibot, or the Elko server.

## Usage

```js
import { HabiSound } from './habisound/lib/habisound.js';

const hs = new HabiSound();
await hs.init();            // load the bank + spin up the AudioWorklet
await hs.resume();          // call inside a click/keydown (browser autoplay policy)

hs.play('TELEPORT_ARRIVAL');        // by symbolic name (from habiworld behaviors)
hs.play('CONTAINER_OPENING', { classHint: 'class_chest' }); // generic name + class
hs.playFile('switch_click');        // by raw bank key (file stem)
hs.stop();                          // silence everything (e.g. looping music)
```

Drop-in for habiworld's client callback:

```js
client.sound = (name, noid) => hs.play(name);
```

Because it uses native ES modules, an `AudioWorklet`, and `fetch`, the demo and library
must be **served over http(s)**, not opened from `file://`. Any static server works:

```sh
cd habisound && python3 -m http.server 8000
# open http://localhost:8000/demo/
```

## Layout

```
lib/interpreter.js   faithful port of sfx.m — the 7-voice bytecode state machine
lib/sid.js           SID register map + chip constants (clock, ADSR times, bit masks)
lib/synth.js         SidSynth: turns SID registers into audio (oscillators/ADSR/filter)
lib/synth-worklet.js thin AudioWorklet wrapper around SidSynth
lib/names.js         symbolic NAME -> bank-key resolution (the deferred sound table)
lib/habisound.js     public main-thread API (HabiSound)
data/sounds.json     the generated, committed sound bank
tools/build-sounds.js parse the C64 .sob/.spb sources -> data/sounds.json
tools/render-wav.js  render any sound to a .wav offline (no browser needed)
test/                node --test suite for the interpreter
demo/index.html      a soundboard
```

## Regenerating the sound bank

`data/sounds.json` is committed so the library is self-contained. To rebuild it from the
original C64 sources (kept outside this repo):

```sh
node tools/build-sounds.js [path-to/sources/c64/Sounds]   # default: ~/habitat-orig/...
```

The `.sob`/`.spb` files are Macross assembler source — just `byte` directives with
comments — so the builder reads the byte values directly; no assembler is needed.

## The bytecode format (decoded from sfx.m)

`maintain_sounds` ran once per video frame (~60 Hz NTSC). There are 7 logical voices:
0–2 are the SID oscillators, 3 is the filter, and 4–6 are pulse-width ramp tracks paired
to oscillators 0–2 (the `_pw` companions from the `.spb` files).

Each sound is a stream of commands. The command byte's bits select which data blocks
follow:

| bit  | name     | data that follows |
|------|----------|-------------------|
| 0x01 | GATE     | (none) set/clear the gate bit — oscillator voices only |
| 0x02 | STOP     | +1 link byte (always 0 in Habitat → no chaining); ends the effect |
| 0x04 | FREQ     | +2 freq lo/hi; if NOW is clear also +2 duration, +2 increment (a ramp) |
| 0x08 | ADSR     | +2 attack/decay, sustain/release — oscillator voices only |
| 0x10 | EXTEND   | +1 sub-command, then: 0x01 set pulse width (+2), 0x02 set filter (+4), 0x04 set duration (+2) |
| 0x20 | WAVEFORM | +1 waveform byte (OR'd into the control register's low nibble) |
| 0x40 | NOW      | (none) makes FREQ immediate (no ramp) |
| 0x80 | LOOP     | +2 reverse-branch offset, repeat count (count 0 = loop forever) |

SID frequency register → Hz: `f = reg * 1022727 / 2^24` (NTSC clock). Durations and ramp
steps are counted in frames (1/60 s). Master volume (`$D418`) was set to max once at
startup and the effects rely on it; habisound defaults it to `0x0F`.

## Fidelity notes

- The synthesizer is a faithful **approximation** of the MOS 6581, not a cycle-exact
  emulation: triangle/sawtooth/pulse/noise oscillators, classic ADSR timing, ring
  modulation, hard sync, and a state-variable multimode filter. Combined waveforms are
  averaged (the real chip AND's them) — a usable stand-in.
- Music tracks (`titles_music_*`, `region_change_music_*`) play through the same engine;
  they loop forever by design (`stop` them when changing regions).

## Known gaps in the name table (`lib/names.js`)

- **`PAWN_MUNCH`** — `classes.js` references `pawn_machine_munching`, but no such `.sob`
  exists in the C64 sources, so it can't be synthesized. Flagged in `UNRESOLVED`.
- **`MUSIC`** defaults to `region_change_music_v0`; the right track may depend on context.
- **`EXPLOSION`** picks small/medium/big from a class hint, defaulting to medium.
- **`SWITCHED_ON/OFF`** map to `security_device_on/off` (ordinary switches use
  `SWITCH_CLICK`); confirm against intended behavior.
