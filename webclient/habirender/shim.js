export let makeCanvas
export let getFile

if (typeof document === "undefined") {
    const canvas = await import("canvas")
    makeCanvas = (w, h) => canvas.createCanvas(w, h)

    const fs = await import('node:fs/promises')
    getFile = async (filename, _) => {
        try {
            const file = await fs.open(filename)
            
            const text = () => file.readFile({ encoding: "utf-8" }).finally(() => file.close())
            const json = async () => JSON.parse(await text())
            const arrayBuffer = async () => {
                try {
                    const buffer = await file.readFile()
                    return buffer.buffer
                } finally {
                    file.close()
                }
            }
            return { text, json, arrayBuffer, ok: true, status: 200 }
        } catch (e) {
            return { ok: false, status: 404, e }
        }
    }
} else {
    // Bare-relative URLs (charset.m, bodies/*.bin, beta.mud, db/…) resolve against this
    // module's directory so habirender data loads regardless of which page imports us.
    // Call globalThis.fetch at request time — do not alias fetch at module load, or a
    // host page patch installed later (live.js) is bypassed.
    const HABIRENDER_BASE = new URL("./", import.meta.url).href
    const BARE_RELATIVE = /^(?![a-z][a-z0-9+.-]*:)(?![./])/

    getFile = (input, init) => {
        let url = input
        if (typeof url === "string" && BARE_RELATIVE.test(url)) {
            url = new URL(url, HABIRENDER_BASE).href
        }
        return globalThis.fetch(url, init)
    }

    makeCanvas = (w, h) => {
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        canvas.style.imageRendering = "pixelated"
        canvas.style.width = `${w * 3}px`
        canvas.style.height = `${h * 3}px`
        return canvas    
    }
}
