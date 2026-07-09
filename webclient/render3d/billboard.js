// billboard.js — a Habitat sprite (a decoded cel frame's RGBA canvas) as a textured quad.
//
// The decoders (habirender/render.js) already composite every prop/avatar frame into an RGBA
// <canvas> whose transparent pixels (C64 palette index 0) have alpha 0 — so it drops straight in
// as a billboard texture with an alpha test. Canvas px == stage px == world units (project.js), so
// a frame's canvas.width × canvas.height is the quad's size in world units, 1:1.
//
// Because the diorama camera is FIXED and front-facing, a billboard is simply a vertical quad in a
// plane of constant Z (foreground quads stand on the floor, background quads hang on the wall) —
// no per-frame "face the camera" rotation is needed. `faceCamera()` is provided for a future
// parallax/sway camera but is a no-op by default.
//
// Three is passed in (not imported) so this module stays decoupled and unit-testable with a stub.
// Pixel-art fidelity: NearestFilter, no mipmaps, alphaTest so the depth buffer orders sprites.

export class Billboard {
  constructor(THREE) {
    this.THREE = THREE
    this.frames = []
    this.textures = []
    this.index = 0
    this.w = 1
    this.h = 1
    // A unit plane; we scale it per-frame so a single geometry serves every size.
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      alphaTest: 0.5, // transparent cel pixels (alpha 0) are discarded → real depth ordering
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material)
    this.mesh.frustumCulled = false
    // A PlaneGeometry's textured front face points +Z; the camera sits in front (+Z) looking toward
    // −Z (project.js axis convention), so it sees the front face un-mirrored. No rotation needed —
    // and adding one would flip the art (and the whole scene) left-for-right.
  }

  // Build one CanvasTexture per animation frame (cached); size to the current frame.
  setFrames(frames) {
    this._disposeTextures()
    this.frames = frames || []
    const THREE = this.THREE
    this.textures = this.frames.map((f) => {
      const tex = new THREE.CanvasTexture(f.canvas)
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace
      tex.needsUpdate = true
      return tex
    })
    this.index = 0
    this._applyFrame()
    return this
  }

  setFrameIndex(i) {
    if (this.frames.length === 0) return
    const next = ((i % this.frames.length) + this.frames.length) % this.frames.length
    if (next === this.index) return
    this.index = next
    this._applyFrame()
  }

  _applyFrame() {
    const f = this.frames[this.index]
    if (!f) return
    this.material.map = this.textures[this.index]
    this.material.needsUpdate = true
    const w = f.canvas.width
    const h = f.canvas.height
    if (w !== this.w || h !== this.h) {
      this.w = w
      this.h = h
      this.mesh.scale.set(w, h, 1)
    }
  }

  // Place the quad by its LEFT / BASE corner in world coords, at depth wz. The plane is centered
  // on its own origin, so offset by half-size to put (wx, wy) at the bottom-left of the sprite.
  setWorldRect(wx, wy, wz) {
    this.mesh.position.set(wx + this.w / 2, wy + this.h / 2, wz)
  }

  // No-op for the fixed camera; hook for a future sway/parallax camera.
  faceCamera(_camera) {}

  dispose() {
    this._disposeTextures()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }

  _disposeTextures() {
    for (const t of this.textures) t.dispose?.()
    this.textures = []
  }
}
