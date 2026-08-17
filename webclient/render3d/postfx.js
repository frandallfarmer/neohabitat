// postfx.js — the retro dial: render small, snap to the C64 palette, ink the silhouette.
//
// habimat.js already emits nothing but palette colours, so this pass is not what makes the figure
// look like Habitat — it is what makes the *image* look like a C64. Three separable knobs, each
// exposed in the lab because the right setting is a thing you decide by looking:
//
//   pixel size   render into a target 1/N the size and blow it back up with no filtering
//   quantize     snap every pixel to the nearest of the 16 colodore colours
//   outline      ink depth discontinuities black, the way a cel has a black keyline
//
// WHY DEPTH EDGES AND NOT AN INVERTED HULL. The usual toon outline draws the mesh a second time,
// inside out and slightly fattened. That needs a second skinning-aware material, it scales the
// outline with the model rather than with the pixel grid, and it cannot ink the seam where an arm
// crosses the torso. Reading the depth buffer costs one extra sampler, inks interior seams for
// free, and — the point — measures the outline in FINAL pixels, so a 1px keyline stays 1px at every
// pixel size. Habitat's keylines were 1 pixel.
//
// EXACTNESS IS A FEATURE. `texelFetch` with integer coordinates, NearestFilter everywhere, no tone
// mapping and no colour management on the way out. That is what makes "with quantize on, every
// pixel in the framebuffer is one of the 16 colours" a property the headless check can assert
// rather than a thing that is roughly true.

import { c64Colors } from "../habirender/palette.js"

const COMPOSITE_VERTEX = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const COMPOSITE_FRAGMENT = /* glsl */`
precision highp float;

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec3  uPalette[16];
uniform float uPixelSize;
uniform float uQuantize;   // 0 or 1
uniform float uOutline;    // 0 = off, otherwise the depth step that counts as an edge
uniform vec2  uTargetSize;

vec3 snapToPalette(vec3 c) {
    vec3 best = uPalette[0];
    float bestD = 1e9;
    for (int i = 0; i < 16; i++) {
        vec3 d = c - uPalette[i];
        float dd = dot(d, d);
        if (dd < bestD) { bestD = dd; best = uPalette[i]; }
    }
    return best;
}

float depthAt(ivec2 p) {
    ivec2 q = clamp(p, ivec2(0), ivec2(uTargetSize) - ivec2(1));
    return texelFetch(tDepth, q, 0).r;
}

void main() {
    // Integer addressing, so one source texel maps onto an exact uPixelSize × uPixelSize block of
    // output pixels. Anything uv-based would land half a texel off at some sizes and soften the
    // grid, which is the one thing a pixel-art pass must not do.
    ivec2 p = ivec2(floor(gl_FragCoord.xy / uPixelSize));
    p = clamp(p, ivec2(0), ivec2(uTargetSize) - ivec2(1));

    vec3 col = texelFetch(tDiffuse, p, 0).rgb;

    if (uOutline > 0.0) {
        float d = depthAt(p);
        float m = 0.0;
        m = max(m, abs(d - depthAt(p + ivec2(1, 0))));
        m = max(m, abs(d - depthAt(p + ivec2(-1, 0))));
        m = max(m, abs(d - depthAt(p + ivec2(0, 1))));
        m = max(m, abs(d - depthAt(p + ivec2(0, -1))));
        // Only ink the near side of a step, or every silhouette gets a double-thick line — one on
        // the figure and one on the background behind it.
        if (m > uOutline && d < 0.9999) col = vec3(0.0);
    }

    if (uQuantize > 0.5) col = snapToPalette(col);

    gl_FragColor = vec4(col, 1.0);
}
`

/**
 * Build the post chain for one renderer.
 *
 * `render(scene, camera)` replaces `renderer.render` — it draws the scene into the low-resolution
 * target and then composites. At pixelSize 1 with quantize and outline off it is a pass-through in
 * everything but name, which is deliberate: the lab should be able to show the unmodified render
 * for comparison without taking a different code path to do it.
 */
export const createPostFX = (THREE, renderer, options = {}) => {
    const state = {
        pixelSize: options.pixelSize ?? 3,
        quantize: options.quantize ?? true,
        outline: options.outline ?? 0.0015,
        width: 1,
        height: 1,
    }

    const depthTexture = new THREE.DepthTexture(1, 1)
    depthTexture.minFilter = THREE.NearestFilter
    depthTexture.magFilter = THREE.NearestFilter

    const target = new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
        depthTexture,
    })
    // Set after construction rather than in the options bag so it cannot be quietly ignored: if
    // Three treats this target as sRGB it re-encodes on the way in, the composite decodes it
    // differently on the way out, and the palette stops being the palette.
    target.texture.colorSpace = THREE.NoColorSpace

    const palette = c64Colors.map((c) =>
        new THREE.Vector3(((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255))

    const material = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: target.texture },
            tDepth: { value: depthTexture },
            uPalette: { value: palette },
            uPixelSize: { value: state.pixelSize },
            uQuantize: { value: state.quantize ? 1 : 0 },
            uOutline: { value: state.outline },
            uTargetSize: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader: COMPOSITE_VERTEX,
        fragmentShader: COMPOSITE_FRAGMENT,
        depthTest: false,
        depthWrite: false,
    })

    // A single triangle covering clip space. Cheaper than a quad and, more usefully, it has no
    // diagonal seam down the middle for a nearest-sampled shader to catch on.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position",
        new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    const quad = new THREE.Mesh(geometry, material)
    quad.frustumCulled = false
    const compositeScene = new THREE.Scene().add(quad)
    const compositeCamera = new THREE.Camera()

    const resize = () => {
        const w = Math.max(1, Math.ceil(state.width / state.pixelSize))
        const h = Math.max(1, Math.ceil(state.height / state.pixelSize))
        target.setSize(w, h)
        material.uniforms.uTargetSize.value.set(w, h)
        material.uniforms.uPixelSize.value = state.pixelSize
    }

    return {
        get state() { return { ...state } },

        setSize(width, height) {
            state.width = width
            state.height = height
            resize()
        },

        setPixelSize(n) {
            state.pixelSize = Math.max(1, Math.round(n))
            resize()
        },

        setQuantize(on) {
            state.quantize = !!on
            material.uniforms.uQuantize.value = on ? 1 : 0
        },

        /** Depth step that counts as an edge; 0 turns the outline off entirely. */
        setOutline(threshold) {
            state.outline = Math.max(0, threshold)
            material.uniforms.uOutline.value = state.outline
        },

        render(scene, camera) {
            renderer.setRenderTarget(target)
            renderer.clear()
            renderer.render(scene, camera)
            renderer.setRenderTarget(null)
            renderer.render(compositeScene, compositeCamera)
        },

        dispose() {
            target.dispose()
            geometry.dispose()
            material.dispose()
        },
    }
}
