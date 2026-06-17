// Phase 1 harness: render a real Habitat region inside the webclient using the
// inspector's render pipeline (codec/render/region). The region is composited entirely
// from the prop-art database — walls, ground, fountain, avatars are all `type:"item"`
// objects drawn from their decoded cels. There is NO backdrop image; the C64 had none.
//
// What this proves: the cross-repo renderer integration works in the webclient —
// importing the inspector modules (via the ./inspector symlink), the shared single Preact
// instance (importmap), charset + prop decoding, scale, and the in-memory `objects` seam
// (`regionView({ objects })`, bypassing its built-in static fetch).
//
// The one wrinkle: the renderer fetches its database (charset.m, beta.mud, db/,
// props.json, prop .bin) with *document-relative* URLs via `getFile = fetch`
// (inspector/shim.js). Served from /webclient/ those would 404. We redirect bare-relative
// fetches to the vendored ./inspector/ dir below, leaving the vendored copy byte-identical
// to upstream (see inspector/VENDOR.md). The renderer + art DB are vendored, so the client
// is self-contained — no neohabitat-doc dependency at runtime.

import { h, render } from "preact"
import htm from "htm"

const INSPECTOR_BASE = "./inspector/"
const _fetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, init) => {
  // Redirect the inspector's bare-relative data URLs (no scheme, not /, ./, ../) into the
  // inspector dir. Our own "./inspector/..." fetches and habisound's absolute
  // import.meta.url fetches start with a scheme or ./ and pass through untouched.
  if (typeof input === "string" && !/^([a-z][a-z0-9+.-]*:|\/|\.\/|\.\.\/)/i.test(input)) {
    input = INSPECTOR_BASE + input
  }
  return _fetch(input, init)
}

const html = htm.bind(h)
const setStatus = (msg, kind = "") => {
  const el = document.getElementById("status")
  el.className = "statusbar " + kind
  el.innerHTML = `<span class="dot"></span>${msg}`
}

// A real Downtown region present in both the capture and the inspector's image map.
const REGION = "./inspector/db/new_Downtown/Downtown_5f.json"

async function main() {
  setStatus("loading inspector render pipeline…")
  // NB: dynamic import() resolves relative to THIS module (/webclient/lib/), so the
  // symlink one level up needs "../inspector". (fetch(), by contrast, resolves against
  // the document at /webclient/, which is why INSPECTOR_BASE/REGION use "./inspector".)
  const { regionView } = await import("../inspector/region.js")
  const { parseHabitatRegion } = await import("../inspector/neohabitat.js")
  const { errors } = await import("../inspector/view.js")

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
