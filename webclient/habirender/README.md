# habirender — the webclient's render pipeline + Habitat art database

`habirender` is the webclient's **fork** of the C64 render pipeline from
`neohabitat-doc/inspector`, bundled with the prop-art database it decodes. It started as a
trimmed copy of the inspector's renderer (Phase 1); from Phase 3 on it **diverges** — the
webclient patches it (e.g. to render avatars in-region, which the inspector never did). The
client is self-contained: no `neohabitat-doc` dependency at runtime.

## What's here

- **Renderer modules** (the closed import graph of `region.js`):
  `region.js`, `render.js`, `codec.js`, `view.js`, `data.js`, `neohabitat.js`,
  `mudparse.js`, `shim.js`.
- **Art database** (original Habitat prop imagery, decoded client-side — there are no
  pre-rendered backgrounds): `props/`, `heads/`, `bodies/`, `misc/`, `beta/`, their `*.json`
  indices, `charset.m`, `beta.mud`, and the top-level trapezoid texture templates
  `super_trap.bin` / `trap0.bin` / `trap1.bin` (without these, `class_super_trapezoid` /
  `class_trapezoid` walls and ground render solid black).
- **Test regions** (offline render fixtures only — the live client gets regions from the
  server's make-storm): `db/contextmap.json`, `db/new_Downtown/`.

## Local divergences from upstream `neohabitat-doc/inspector`

Track changes here so upstream merges stay intentional:

- **`region.js` — avatar/body rendering** (Phase 3). New `bodyFileForClass`,
  `limbPatternsFromMod`, `bodyFramesFromMod`; `propFromMod` returns a decoded body
  (`decodeBody`) for `class_avatar`, and `propFramesFromMod` emits `framesFromAction` frames
  for it (detected via `prop.limbs`). Imports `decodeBody`/`framesFromAction`. Step 1 = a
  default "stand" pose with limb colors from the avatar's `custom` bytes (grounded in C64
  `animate.m`); orientation→facing/flip, action→pose, and head-on-neck composition are
  follow-ups.

The webclient redirects the renderer's document-relative `fetch`es into this dir from
`lib/region-view.js` / `lib/live.js`, so `shim.js` itself needs no patch.

## Relationship to upstream

`habirender` is a fork, not a vendor snapshot, so pulling upstream improvements is a
**manual merge** (re-apply the local divergences above), not a blind copy. The renderer
modules and art DB originate from `neohabitat-doc/inspector`; the ~26 MB of other region
definitions and the inspector's editor/UI files were intentionally left out.
