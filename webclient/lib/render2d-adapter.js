// render2d-adapter.js — the 2D renderer adapter for the shared app-shell (lib/app-shell.js).
//
// Supplies the renderer + coordinate-bound hooks the shell routes through: the DOM region view, the
// modal cursor, the pixel picker, the walk-off-edge chevron geometry, the fit-to-viewport scale, and
// the trap-cache reset. All of this is the pre-refactor 2D behavior, moved verbatim — the 2D client
// must be byte-identical. (speakerScreenX is intentionally omitted so balloons fall back to their 2D
// placement, speakerXposFromMod.)

import { RegionCursor } from "./cursor-view.js"
import { pickRegionTarget } from "./verb-dispatch.js"
import { REGION_CANVAS_W, REGION_CANVAS_H } from "../habirender/pick.mjs"

const SCALE = 3

export async function make2DAdapter() {
  // region.js is the heavy 2D renderer (cel decoders + region view); load it lazily so the title
  // curtain shows while it loads — the same deferral the old boot() had via main()'s dynamic import.
  const { regionView, clearTrapCache } = await import("../habirender/region.js")
  return {
    RegionView: regionView,
    Cursor: RegionCursor,
    pickRegionTarget,
    onRegionReset: clearTrapCache,     // clear_cache: drop decoded region art on a region change
    installFit: installFitToViewport,

    // Side chevrons span only the walkable band (region bottom up by `depth`), bottom-aligned above
    // the text-input line. `region` here is the shell's region item (worldToObjects → mods[0].depth).
    sideChevronStyle: (region) => {
      const depth = region?.mods?.[0]?.depth ?? 0
      return `height:${depth * 3}px; align-self:end; margin-bottom:${8 * 3}px;`
    },

    // Walk-off-edge → the in-region GO coordinate, clamped to the in-game edge from the chevron's
    // geometry. `region` here is world.region (has .depth directly). Mirrors the old onEdgeClick.
    edgeCoord: (edge, e, region) => {
      const rect = e.currentTarget.getBoundingClientRect()
      let cx, cy // region-canvas coords, clamped to the in-game edge
      if (edge === "left" || edge === "right") {
        cx = edge === "left" ? 0 : REGION_CANVAS_W - 1
        // The side chevron spans only the walkable band, so a click maps into habitat y ∈ [0, depth]
        // — the ground edge, never the sky. canvasY is inverted habitat y, so it's the bottom band.
        const depth = region?.depth ?? 0
        const bandTop = (REGION_CANVAS_H - 1) - depth
        const frac = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
        cy = Math.round(bandTop + frac * depth)
      } else { // bottom
        cy = REGION_CANVAS_H - 1
        cx = Math.round(((e.clientX - rect.left) / rect.width) * (REGION_CANVAS_W - 1))
      }
      return { cx, cy, scale: SCALE }
    },
  }
}

// Scale-to-fit. The 2D client renders at a fixed integer scale (320×3 = 960px region). When live.html
// is the WHOLE page (the docent "Full Screen" navigates here), a roomy desktop window leaves it tiny
// and centered — so scale #app UP to fill the viewport. min(w,h) ratio keeps the whole client on
// screen. scrollWidth/Height are LAYOUT sizes (a CSS transform is paint-only), so the ResizeObserver
// re-fits when content actually changes (title→app, region load, keyboard toggle). Pointer→canvas
// mapping MUST be rect-ratio based under this transform (cursor-view localFromEvent, text-view
// cellFromEvent). ONLY when top-level: the /neohabitat docent EMBEDS us in a sized iframe that can be
// wider than our natural width — fitting there would overflow; embedded, the iframe sizes us.
function installFitToViewport(root) {
  if (!root || window.top !== window.self) return
  const fit = () => {
    const w = root.scrollWidth, h = root.scrollHeight
    if (!w || !h) { root.style.transform = ""; return }
    const s = Math.min(window.innerWidth / w, window.innerHeight / h)
    root.style.transformOrigin = "top center"
    root.style.transform = s > 1.01 ? `scale(${s})` : ""
  }
  window.addEventListener("resize", fit)
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(fit).observe(root)
  fit()
}
