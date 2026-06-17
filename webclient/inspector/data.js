import { signal, effect } from "@preact/signals"
import { parse } from "./mudparse.js"
import { parseHabitatObject, parseHabitatRegion } from "./neohabitat.js"
import { decodeCharset } from "./codec.js"
import { getFile } from "./shim.js"

export const errorBucket = signal([])
export const logError = (e, filename) => {
    console.error(e)
    const err = { e, filename, msg: e.toString(), stacktrace: e.stack ? e.stack.toString() : "(no stacktrace)" }
    // do NOT access errorBucket.value inside of an erroring component, as it will retrigger in an infinite loop
    requestAnimationFrame(() => {
        errorBucket.value = [...errorBucket.value, err]
    })
}

export const promiseToSignal = (promise, defaultValue) => {
    const sig = signal(() => defaultValue)
    promise.catch(e => { sig.value = () => { throw e } })
           .then((x) => { sig.value = () => x })
    return sig
}

export const effectToPromise = (callback) => {
    // Behaves like `new Promise()` but with the promise callback run inside an `effect()`.
    // This means that `callback` will run every time a referenced signal changes, but the
    // promise will only resolve when the callback decides to call its resolver function.
    // Contortions are required here because effect() runs its callback immediately, but we don't
    // get access to the effect disposal function until after it returns.
    const disposer = {}
    const complete = (callback) => {
        if (disposer.complete) { return }
        if (!disposer.dispose) {
            disposer.deferredDisposal = callback
        } else {
            disposer.complete = true
            disposer.dispose()
            callback()
        }
    }
    const promise = new Promise((resolve, reject) => {
        disposer.dispose = effect(() => { 
            try {
                callback((v) => complete(() => resolve(v))) 
            } catch (e) {
                complete(() => reject(e))
            }
        })
    })
    if (disposer.deferredDisposal) {
        complete(disposer.deferredDisposal)
    }
    return promise
}

export const until = (getValue, predicate = v => v) => {
    return effectToPromise(complete => {
        const value = getValue()
        if (predicate(value)) {
            complete(value)
        }
    })
}

export const lazySignal = (defaultValue, promiseGetter) => {
    const cache = {}
    return () => {
        if (!cache.value) {
            cache.value = promiseToSignal(promiseGetter(), defaultValue)
        }
        return cache.value.value()
    }
}

const fetchCache = {}
export const fetchAndCache = (url, handler, defaultValue) => {
    if (!url) {
        throw new Error("Invalid empty URL")
    }
    if (!fetchCache[url]) {
        const doFetch = async () => {
            const response = await getFile(url, { cache: "no-cache" })
            if (!response.ok) {
                console.error(response)
                throw new Error(`Failed to download ${url}: ${response.status}`)
            }
            return await handler(response)
        }
        const sig = promiseToSignal(doFetch(), defaultValue)
        fetchCache[url] = sig
    }
    return fetchCache[url].value()
}

export const useBinary = (url, decoder, defaultValue) => {
    return fetchAndCache(
        url, 
        async (response) => decoder(new DataView(await response.arrayBuffer())), 
        defaultValue)
}

export const useJson = (url, defaultValue) => {
    return fetchAndCache(url, (response) => response.json(), defaultValue)
}

export const useHabitatJson = (url) => {
    return fetchAndCache(url, async (response) => parseHabitatRegion(await response.text()), [])
}

export const useHabitatText = (url) => {
    return fetchAndCache(url, async (response) => parseHabitatObject(await response.text()), {})
}

export const betaMud = lazySignal(null, async () =>
    parse(await (await getFile("beta.mud")).text())
)

export const contextMap = lazySignal({}, async () =>
    await (await getFile("db/contextmap.json", { cache: "no-cache" })).json()
)

export const charset = lazySignal(null, async () =>
    decodeCharset(await (await getFile("charset.m")).text())
)
