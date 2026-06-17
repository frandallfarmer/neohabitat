export let makeCanvas
export let getFile = fetch

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
