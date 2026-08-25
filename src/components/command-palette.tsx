"use client"

import { useEffect, useMemo, useState } from "react"
import { Command, Search } from "lucide-react"
import { SYNNICAL_APPS } from "@/lib/app-registry"
import { useAuth } from "@/hooks/use-auth"

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const { user } = useAuth()
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen((value) => !value) }
      if (event.key === "Escape") setOpen(false)
    }
    const external = () => setOpen(true)
    window.addEventListener("keydown", key)
    window.addEventListener("synnical-command-palette", external)
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("synnical-command-palette", external) }
  }, [])
  const apps = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const visible = SYNNICAL_APPS.filter((app) => !("authOnly" in app && app.authOnly) || Boolean(user))
    return !needle ? visible : visible.filter((app) => [app.label, app.id, ...app.aliases].some((value) => value.includes(needle)))
  }, [query, user])
  if (!open) return null
  const launch = (panel: string) => { window.dispatchEvent(new CustomEvent("synnical-open-panel", { detail: { panel } })); setOpen(false); setQuery("") }
  return <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false) }}>
    <div className="mx-auto mt-[12vh] max-w-xl overflow-hidden rounded-2xl border border-[var(--synnical-border)] bg-[#080808] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[var(--synnical-border)] px-4"><Search className="h-4 w-4 text-[var(--synnical-muted)]" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Open a Synnical app…" className="h-12 flex-1 bg-transparent text-sm outline-none" /><span className="text-[10px] text-[var(--synnical-muted)]">Ctrl K</span></div>
      <div className="max-h-[55vh] overflow-y-auto p-2">{apps.length === 0 ? <p className="p-4 text-center text-sm text-[var(--synnical-muted)]">No matching Synnical app.</p> : apps.map((app) => <button key={app.id} onClick={() => launch(app.id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/10"><Command className="h-4 w-4 text-[var(--synnical-accent)]" /><div><p className="text-sm font-medium">{app.label}</p><p className="text-[11px] text-[var(--synnical-muted)]">{app.aliases.join(" · ")}</p></div></button>)}</div>
    </div>
  </div>
}
