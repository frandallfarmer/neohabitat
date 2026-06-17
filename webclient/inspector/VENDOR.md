# Vendored renderer + Habitat art database

This directory is a **vendored copy** of a subset of the `neohabitat-doc/inspector`
project — the C64 render pipeline plus the prop-art database it decodes. The webclient is
deliberately self-contained: it does not depend on the `neohabitat-doc` repo at runtime.
(Decision: vendor a copy. The longer-term option is to extract the renderer into a shared
`habirender` library that both the inspector and this client consume — see `../DESIGN.md`.)

## What's here

- **Renderer modules** (the closed import graph of `region.js`):
  `region.js`, `render.js`, `codec.js`, `view.js`, `data.js`, `neohabitat.js`,
  `mudparse.js`, `shim.js`.
- **Art database** (the original Habitat prop imagery, decoded client-side — there are no
  pre-rendered backgrounds): `props/`, `heads/`, `bodies/`, `misc/`, `beta/`, their
  `*.json` indices, `charset.m`, and `beta.mud`. Plus the top-level trapezoid texture
  templates `super_trap.bin`, `trap0.bin`, `trap1.bin` — required to render
  `class_super_trapezoid` / `class_trapezoid` walls and ground (without them those render
  solid black).
- **Test regions** (offline render fixtures only — the live client gets regions from the
  server's make-storm, not from here): `db/contextmap.json`, `db/new_Downtown/`.

## What was intentionally left out

The other ~26 MB of `db/` region definitions, and the inspector's UI/editor files
(`edit.js`, `navigate.js`, `index.js`, `*.html`, etc.). The webclient consumes only the
render pipeline.

## Re-syncing from upstream

These files are byte-identical to upstream (no local patches) so a refresh is a plain copy.
The webclient redirects the renderer's document-relative `fetch`es into this dir from
`lib/region-view.js`, so `shim.js` is left untouched. To update:

```sh
SRC=~/neohabitat-doc/inspector ; DST=~/neohabitat/webclient/inspector
cp "$SRC"/{region,render,codec,view,data,neohabitat,mudparse,shim}.js "$DST"/
cp "$SRC"/{charset.m,beta.mud,props,heads,bodies,misc,beta}.json "$DST"/ 2>/dev/null
cp "$SRC"/{charset.m,beta.mud,default_mod_values.json} "$DST"/
cp "$SRC"/*.bin "$DST"/                       # trapezoid texture templates
cp -r "$SRC"/{props,heads,bodies,misc,beta} "$DST"/
cp "$SRC"/db/contextmap.json "$DST"/db/ ; cp -r "$SRC"/db/new_Downtown "$DST"/db/
```
