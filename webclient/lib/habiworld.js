// Load habiworld (a CommonJS package) in the browser with NO build step and NO changes to
// habiworld itself. habiworld is pure JS; across its ~27 runtime modules the only
// non-relative require is `events`. We fetch each module's source over http, then run it
// through a Node-like synchronous require() over the prefetched cache, shimming `events`
// with a minimal EventEmitter.
//
// This is the "additive browser-ESM form" of habiworld: the CommonJS API is untouched
// (habibots/sagebot keep using it verbatim); we just provide a browser host for it.
//
// habiworld is a sibling package under the dev server root, resolved relative to THIS
// module's URL (…/webclient/lib/habiworld.js → …/habiworld/).

const HABIWORLD_ENTRY = new URL("../../habiworld/index.js", import.meta.url).href

// ── minimal Node EventEmitter (only what habiworld's world.js uses) ──
class EventEmitter {
  constructor() { this._listeners = new Map() }
  on(type, fn) {
    let arr = this._listeners.get(type)
    if (!arr) { arr = []; this._listeners.set(type, arr) }
    arr.push(fn)
    return this
  }
  addListener(type, fn) { return this.on(type, fn) }
  once(type, fn) {
    const wrap = (...a) => { this.off(type, wrap); fn(...a) }
    wrap.listener = fn
    return this.on(type, wrap)
  }
  off(type, fn) {
    const arr = this._listeners.get(type)
    if (!arr) return this
    const i = arr.findIndex((l) => l === fn || l.listener === fn)
    if (i >= 0) arr.splice(i, 1)
    return this
  }
  removeListener(type, fn) { return this.off(type, fn) }
  removeAllListeners(type) { type ? this._listeners.delete(type) : this._listeners.clear(); return this }
  emit(type, ...args) {
    const arr = this._listeners.get(type)
    if (!arr || arr.length === 0) return false
    for (const fn of [...arr]) fn(...args)
    return true
  }
  listenerCount(type) { return (this._listeners.get(type) || []).length }
}
EventEmitter.EventEmitter = EventEmitter
const BUILTINS = { events: EventEmitter }

// ── fetch + resolve over the prefetched cache ──
const fetchCache = new Map() // url -> source text | null(404)

async function get(url) {
  if (fetchCache.has(url)) return fetchCache.get(url)
  let text = null
  try {
    const r = await fetch(url, { cache: "no-store" })
    if (r.ok) text = await r.text()
  } catch (e) { /* miss */ }
  fetchCache.set(url, text)
  return text
}

// Node-like resolution: <id>.js then <id>/index.js (same order as Node require).
// Directory packages (e.g. ./behaviors) may 404 once on behaviors.js before index.js — expected.
function candidates(id, fromUrl) {
  const base = new URL(id, fromUrl).href
  return base.endsWith(".js") ? [base] : [base + ".js", base.replace(/\/$/, "") + "/index.js"]
}
async function resolveAsync(id, fromUrl) {
  for (const c of candidates(id, fromUrl)) if ((await get(c)) != null) return c
  return null
}
function resolveSync(id, fromUrl) {
  for (const c of candidates(id, fromUrl)) if (fetchCache.get(c) != null) return c
  throw new Error(`habiworld: cannot resolve '${id}' from ${fromUrl}`)
}

const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g

const crawled = new Set()
async function crawl(url) {
  if (crawled.has(url)) return
  crawled.add(url)
  const src = await get(url)
  if (src == null) throw new Error(`habiworld: fetch failed ${url}`)
  for (const m of src.matchAll(REQUIRE_RE)) {
    const id = m[1]
    if (id in BUILTINS) continue
    const child = await resolveAsync(id, url)
    if (child) await crawl(child)
    // a require that resolves to nothing is almost certainly a false positive inside a
    // comment/string; the sync require below will throw for real if a true dep is missing.
  }
}

// ── synchronous CommonJS instantiation over the cache ──
const moduleCache = new Map() // url -> module.exports
function requireUrl(url) {
  if (moduleCache.has(url)) return moduleCache.get(url)
  const src = fetchCache.get(url)
  const module = { exports: {} }
  moduleCache.set(url, module.exports) // seed early so require cycles resolve
  const localRequire = (id) => (id in BUILTINS ? BUILTINS[id] : requireUrl(resolveSync(id, url)))
  const dir = url.replace(/\/[^/]*$/, "/")
  const fn = new Function("module", "exports", "require", "__filename", "__dirname", src)
  fn(module, module.exports, localRequire, url, dir)
  moduleCache.set(url, module.exports)
  return module.exports
}

// Load habiworld and return its public exports ({ HabitatWorld, constants, ... }).
let _loaded = null
export async function loadHabiworld() {
  if (!_loaded) {
    await crawl(HABIWORLD_ENTRY)
    _loaded = requireUrl(HABIWORLD_ENTRY)
  }
  return _loaded
}
