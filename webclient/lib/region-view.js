// Phase 1 harness: render a real Habitat region inside the webclient using the habirender
// pipeline (codec/render/region — our fork of neohabitat-doc/inspector). The region is
// composited entirely from the prop-art database — walls, ground, fountain, avatars are all
// `type:"item"` objects drawn from their decoded cels. There is NO backdrop image.
//
// What this proves: importing the habirender modules, the shared single Preact instance
// (importmap), charset + prop decoding, scale, and the in-memory `objects` seam
// (`regionView({ objects })`, bypassing its built-in static fetch).
//
// The one wrinkle: habirender fetches its database (charset.m, beta.mud, db/, props.json,
// prop .bin) with *document-relative* URLs via `getFile = fetch` (habirender/shim.js).
// Served from /webclient/ those would 404, so we redirect bare-relative fetches to the
// habirender/ dir below (see habirender/README.md).

import { h, render } from "preact"
import htm from "htm"

const RENDER_BASE = "./habirender/"
const _fetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, init) => {
  // Redirect habirender's bare-relative data URLs (no scheme, not /, ./, ../) into the
  // habirender dir. Our own "./habirender/..." fetches and habisound's absolute
  // import.meta.url fetches start with a scheme or ./ and pass through untouched.
  if (typeof input === "string" && !/^([a-z][a-z0-9+.-]*:|\/|\.\/|\.\.\/)/i.test(input)) {
    input = RENDER_BASE + input
  }
  return _fetch(input, init)
}

const html = htm.bind(h)
const setStatus = (msg, kind = "") => {
  const el = document.getElementById("status")
  el.className = "statusbar " + kind
  el.innerHTML = `<span class="dot"></span>${msg}`
}

// A real Downtown region present in both the capture and habirender's image map.
const REGION = "./habirender/db/new_Downtown/Downtown_5f.json"

async function main() {
  setStatus("loading habirender pipeline…")
  // NB: dynamic import() resolves relative to THIS module (/webclient/lib/), so habirender
  // one level up needs "../habirender". (fetch(), by contrast, resolves against the document
  // at /webclient/, which is why RENDER_BASE/REGION use "./habirender".)
  const { regionView } = await import("../habirender/region.js")
  const { parseHabitatRegion } = await import("../habirender/neohabitat.js")
  const { errors } = await import("../habirender/view.js")

  setStatus("loading region object table…")
  // Parse the region with the inspector's own Habitat-MUD parser (the db files use
  // unquoted constants like UP/LEFT, so they are not plain JSON), then hold the array
  // in memory and hand it to regionView — exercising the in-memory `objects` seam.
  const objects = parseHabitatRegion(await (await fetch(REGION)).text())
  const region = objects.find((o) => o.type === "context")
  setStatus(`${region?.name ?? "region"} — ${objects.length} objects in memory; decoding prop art…`, "online")

  render(
    html`<div>
      <${regionView} objects=${objects} />
      <${errors} />
    </div>`,
    document.getElementById("stage"),
  )
}

main().catch((e) => {
  setStatus("error: " + e.message, "error")
  console.error(e)
})
