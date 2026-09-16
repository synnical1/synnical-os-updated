"use client"
let pendingQuery: string | null = null
export function queueGlobalSearch(query: string) {
  pendingQuery = query.trim().slice(0, 500)
  window.dispatchEvent(new CustomEvent("synnical-global-search", { detail: { query: pendingQuery } }))
}
export function consumeGlobalSearch() { const query = pendingQuery; pendingQuery = null; return query }
