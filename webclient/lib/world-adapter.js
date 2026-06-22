// Adapt a habiworld world model into the object-table shape the render pipeline wants.
//
// habiworld owns all state (make-storm + deltas → records); this is a pure read-only
// projection of that state into the inspector's region-object shape. No state is derived
// or stored here.
//
//   habiworld record: { noid, ref, name, type:<class>, mod:{x,y,orientation,...}, containerRef }
//   habiworld region: world.region = { ref, name, orientation, neighbors, lighting, ... }
//
//   renderer object:  { ref, type:"item"|"context", name, in:<containerRef>, mods:[ mod ] }
//
// `mod` (including the raw y with its FOREGROUND high bit) passes through untouched — the
// renderer interprets y%128 for screen position and the high bit for z-order.
//
// Pure and dependency-free so it runs identically in the browser and under node (tests).

export function worldToObjects(world) {
  const out = []

  const r = world.region
  if (r && r.ref) {
    out.push({
      ref: r.ref,
      type: "context",
      name: r.name || r.ref,
      mods: [{
        type: "Region",
        orientation: r.orientation || 0,
        neighbors: r.neighbors || ["", "", "", ""],
        lighting: r.lighting || 0,
        realm: r.realm || "",
        depth: r.depth || 0,
      }],
    })
  }

  for (const rec of world.objects.values()) {
    // The singleton Ghost (noid 255) renders as the floating EYE icon (class_ghost image
    // ghost_image = Images/eye0.bin) — it represents all observers and IS shown (to ghosts and
    // avatars alike) whenever ghosts are present. It is NOT filtered. See GHOST_MODE.md.
    out.push({
      ref: rec.ref,
      type: "item",          // elko top-level type; class lives in mods[0].type
      name: rec.name,
      in: rec.containerRef,  // region items → region ref; avatar parts → avatar ref
      mods: [rec.mod],
    })
  }

  return out
}
