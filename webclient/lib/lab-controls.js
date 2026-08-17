// lab-controls.js — the little DOM control kit the render labs share.
//
// Extracted verbatim from lib/avatar3d.js when figure3d.js turned up needing the same sliders,
// selects, checkboxes and (especially) the spray-can pattern popdown. The popdown in particular is
// not generic UI: it renders its swatches through the SAME canvasFromBitmap the avatar's limbs go
// through, so a pattern in the picker is the pattern you get. Two hand-kept copies of that would
// drift, and the drift would look like a rendering bug.
//
// The one behavioural knot worth naming: every widget both (a) writes through `set` and calls
// `onChange`, and (b) registers a *syncer* so an external caller (window.__avatarvox.setState, and
// the headless checks that drive it) can change state and leave the panel telling the truth.
// Without the syncers the automated check and the on-screen widgets silently disagree.

import { canvasFromBitmap, celPatterns } from "../habirender/render.js"
import { emptyBitmap } from "../habirender/codec.js"

export const el = (tag, props = {}, kids = []) => {
    const n = Object.assign(document.createElement(tag), props)
    for (const k of kids) n.appendChild(k)
    return n
}

export const addRow = (parent, label, control, valueNode) => {
    const row = el("div", { className: "row" })
    row.appendChild(el("label", { textContent: label }))
    row.appendChild(control)
    if (valueNode) row.appendChild(valueNode)
    parent.appendChild(row)
    return row
}

const show = (v) => (typeof v === "number" && !Number.isInteger(v)) ? v.toFixed(2) : String(v)

// The four avatar "colours" are not colours: they are PATTERN indices into celPatterns
// (render.js, from paint.m:447), each a 4×4 dither whose 2-bit cells choose between blue,
// the wildcard, black and skin. Pattern 4 versus pattern 9 is meaningless as a number, so the
// picker shows the real thing.
//
// The four slots are exactly what the spray can addresses. habiworld's class_spray_can sends
// `{op:'SPRAY', limb}` and the can answers with SPRAY_CUSTOMIZE_0/1 — the two `custom` bytes
// unpacked here as LEG / TORSO / ARM / FACE (equates.m), which is also what custom.m's F5–F8 set.
export const SPRAY_SLOTS = [
    { key: "legs", label: "legs", limb: 0, hint: "custom[0] hi · F6" },
    { key: "torso", label: "torso", limb: 1, hint: "custom[0] lo · F7" },
    { key: "arms", label: "arms", limb: 2, hint: "custom[1] hi · F8" },
    { key: "hair", label: "hair", limb: 3, hint: "head orientation · F5" },
]

// A swatch of one pattern, at native C64 proportions (a multicolor pixel is twice as wide as tall).
// `emptyBitmap(w,h,1)` fills with nibble 1 = "wild", which is the value the dither actually acts on.
export const patternSwatch = (pattern, wBytes = 3, h = 12) => {
    const canvas = canvasFromBitmap(emptyBitmap(wBytes, h, 1), { pattern })
    canvas.style.width = `${canvas.width}px`
    canvas.style.height = `${canvas.height}px`
    return canvas
}

/**
 * Build a control kit bound to one lab's rebuild function.
 *
 * `onChange` is called after every widget writes its value. Labs pass their `rebuild`.
 * The returned `sync()` re-reads every registered getter and repaints the widgets.
 */
export const createControlKit = ({ onChange = () => {} } = {}) => {
    const syncers = []

    const slider = (min, max, step, get, set) => {
        const val = el("span", { className: "val", textContent: show(get()) })
        const input = el("input", { type: "range", min, max, step, value: get() })
        input.addEventListener("input", () => {
            set(parseFloat(input.value))
            val.textContent = show(get())
            onChange()
        })
        syncers.push(() => { input.value = String(get()); val.textContent = show(get()) })
        return [input, val]
    }

    const select = (options, get, set) => {
        const s = el("select")
        for (const [value, label] of options) s.appendChild(el("option", { value, textContent: label }))
        s.value = get()
        s.addEventListener("change", async () => { await set(s.value); onChange() })
        syncers.push(() => { s.value = get() })
        return s
    }

    const checkbox = (get, set) => {
        const c = el("input", { type: "checkbox", checked: get() })
        c.addEventListener("change", () => { set(c.checked); onChange() })
        syncers.push(() => { c.checked = get() })
        return c
    }

    const sprayPopdown = (get, set) => {
        const wrap = el("div", { className: "pop" })
        const button = el("button", { type: "button" })
        const menu = el("div", { className: "popmenu" })
        const label = el("span", { textContent: "" })
        const caret = el("span", { className: "caret", textContent: "▾" })

        const paintButton = () => {
            button.textContent = ""
            button.appendChild(patternSwatch(get(), 6, 14))
            label.textContent = String(get())
            button.appendChild(label)
            button.appendChild(caret)
        }
        const close = () => menu.classList.remove("open")
        button.addEventListener("click", (e) => {
            e.stopPropagation()
            const wasOpen = menu.classList.contains("open")
            for (const m of document.querySelectorAll(".popmenu.open")) m.classList.remove("open")
            if (!wasOpen) menu.classList.add("open")
        })
        document.addEventListener("click", close)

        for (let p = 0; p < celPatterns.length; p++) {
            const b = el("button", { type: "button", title: `pattern ${p}` })
            b.appendChild(patternSwatch(p, 5, 14))
            b.appendChild(el("span", { textContent: String(p) }))
            b.addEventListener("click", (e) => {
                e.stopPropagation(); set(p); close(); paintButton(); syncSwatches(); onChange()
            })
            menu.appendChild(b)
        }
        const syncSwatches = () => {
            ;[...menu.children].forEach((b, p) => b.classList.toggle("sel", p === get()))
        }

        paintButton(); syncSwatches()
        syncers.push(() => { paintButton(); syncSwatches() })
        wrap.appendChild(button)
        wrap.appendChild(menu)
        return wrap
    }

    return {
        el, addRow, patternSwatch, SPRAY_SLOTS,
        slider, select, checkbox, sprayPopdown,
        sync: () => { for (const s of syncers) s() },
    }
}
