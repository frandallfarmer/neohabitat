// import "https://unpkg.com/preact/devtools/dist/devtools.mjs"
import htm from "htm"
import { h } from "preact"
import { useState, useId, useMemo, useErrorBoundary } from "preact/hooks"
import { useSignalEffect } from "@preact/signals"
import { errorBucket, logError } from "./data.js"

export const html = htm.bind(h)

const search = (query, items) => {
    const term = query.toLowerCase().trim()
    return items
            .filter(({ label }) => label.toLowerCase().includes(term))
            .toSorted((l, r) => {
                const lindex = l.label.toLowerCase().indexOf(term)
                const rindex = r.label.toLowerCase().indexOf(term)
                if (lindex != rindex) { return lindex - rindex }
                return l.label.toLowerCase().localeCompare(r.label.toLowerCase())
            })
}

export const searchBox = ({ label, onSelected, items }) => {
    const id = useId()
    const [query, setQuery] = useState("")
    const [focussed, setFocussed] = useState(false)
    const selectItem = item => {
        setQuery("")
        onSelected(item)
    }
    const shouldQuery = query.trim() != ""
    const results = useMemo(() => shouldQuery ? search(query, items) : [], [query, items])
    const visibleItems = results.map(
        item => html`<li key=${item}><a href="javascript:;" onMouseDown=${() => selectItem(item) }>${item.label}</a></li>`
    )
    return html`
        <form onSubmit=${e => { 
            if (results.length > 0) {
                selectItem(results[0])
            }
            e.preventDefault()
        }}>
            <label for=${id} style="width: 200px; display: inline-block">${label}</label>
                <span style="position: relative; display: inline-block;">
                    <input type="search"
                        id=${id}
                        placeholder="Search..."
                        onFocus=${() => setFocussed(true)}
                        onBlur=${() => setFocussed(false)}
                        onInput=${e => { setQuery(e.target.value) }}
                        value="${query}" />
                    <ul style="display: ${!focussed || results.length == 0 ? "none" : "block"}; z-index: 1000; background: white; border: 1px solid black; position:absolute; width: 600px; height: 400px; overflow: scroll; top: 20px">
                        ${visibleItems}
                    </ul>
                </span>
            
        </div>`
}

export const errors = (_) => {
    if (errorBucket.value.length > 0) {
        return html`
            <h2>Errors</h2>
            <details>
                <summary>${errorBucket.value.length}</summary>
                <button onClick=${() => errorBucket.value = []}>Clear errors and retry</button>
                ${errorBucket.value.map((err) => html`
                    <div key=${err}>
                        <h5>${err.filename}</h5>
                        <p>${err.msg}</p>
                        <pre>${err.stacktrace}</pre>
                    </div>`)}
            </details>`
    }
    return null    
}

export const catcher = ({ filename, children }) => {
    const [error, reset] = useErrorBoundary(e => logError(e, filename))
    useSignalEffect(() => { if (errorBucket.value.length === 0) { reset(); } })
    return error ? null : children;
}

export const direction = ({ compass, orientation }) => {
    const arrows = ["⇧", "⇨", "⇩", "⇦"]
    const directions = {w: 4, n: 5, e: 6, s: 7}
    const compassDirection = directions[compass[0].toLowerCase()]
    const arrow = arrows[(compassDirection - (orientation & 0x03)) & 0x03]
    return html`<span>${compass} (${arrow})</span>`
}

export const collapsable = ({ summary, children }) => {
    const [open, setOpen] = useState(true)
    const label = html`
        <a href="javascript:;" style="padding: 5px;" onclick=${() => { setOpen(!open) } }>
            ${open ? "▾" : "▸"} ${summary}
        </a>`
    return open ? html`
        <fieldset>
            <legend>${label}</legend>
            ${children}
        </fieldset>` : html`<span>${label}</span>`
}