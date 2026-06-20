// Inventory display — port of Main/pick.m display_contents_screen. Draws a
// container's contents in a grid (the C64 used 4 columns, cont_x_pos/cont_y_pos)
// and lets the user point at one to select it for GET, or cancel to abort.
// Avatars are skipped (pick.m: class_pointer == 1 not displayed).
//
// Selection is point-and-click here (the mouse analog of the C64 cursor + trigger);
// the modal cursor's drag-for-verb is a region concept and not used in this mode.

import { html } from "../habirender/view.js"
import { propFromMod, propFramesFromMod } from "../habirender/region.js"
import { animatedDiv } from "../habirender/render.js"

const INVENTORY_COLS = 4 // pick.m cont_x_pos has 4 columns

// One contents cell — reuse the region prop pipeline to draw the item icon
// reactively (propFromMod loads art via useBinary; null while loading).
const InventoryCell = ({ object, onSelect }) => {
  const mod = object.mods[0]
  const prop = propFromMod(mod, object.ref)
  const frames = prop ? propFramesFromMod(prop, mod) : null
  return html`
    <button
      class="inv-cell"
      title=${object.name ?? ""}
      onClick=${(e) => {
        e.stopPropagation() // a hit selects; clicks that miss fall through to the stage = abort
        onSelect(mod.noid)
      }}>
      <div class="inv-icon">
        ${frames && frames.length
          ? html`<${animatedDiv} frames=${frames} />`
          : html`<span class="inv-loading">…</span>`}
      </div>
      <span class="inv-name">${object.name ?? ""}</span>
    </button>`
}

export const InventoryView = ({ objects, containerNoid, onSelect, onAbort }) => {
  const container = objects.find((o) => o.mods?.[0]?.noid === containerNoid)
  // An avatar shows only its 5 pocket slots (pick.m: highest_to_display=5) — not the
  // worn HEAD (slot 6) or the held HANDS item (slot 5).
  const isAvatar = container?.mods?.[0]?.type === "Avatar"
  const contents = container
    ? objects.filter(
        (o) =>
          o.type === "item" &&
          o.in === container.ref &&
          o.mods?.[0]?.type !== "Avatar" &&
          (!isAvatar || (o.mods[0].y >= 0 && o.mods[0].y <= 4)),
      )
    : []
  return html`
    <div
      class="inventory-stage"
      style=${`--inv-cols:${INVENTORY_COLS}`}
      onClick=${onAbort}
      onContextMenu=${(e) => e.preventDefault()}>
      <div class="inventory-header">
        <span>${container?.name ?? "Contents"} — pick an item (click empty space to cancel)</span>
        <button class="inv-abort" onClick=${onAbort}>Cancel</button>
      </div>
      <div class="inventory-grid">
        ${contents.length
          ? contents.map(
              (o) =>
                html`<${InventoryCell} key=${o.ref} object=${o} onSelect=${onSelect} />`,
            )
          : html`<div class="inv-empty">(empty)</div>`}
      </div>
    </div>`
}
