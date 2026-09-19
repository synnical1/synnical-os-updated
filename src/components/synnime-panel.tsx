"use client"

import { useEffect, useState } from "react"
import { Clapperboard, Compass, History, Play, Search, Sparkles } from "lucide-react"
import { ProviderWebView } from "@/components/provider-web-view"

const shortcuts = [
  { label: "Browse anime", detail: "Discover releases, genres, and seasonal shows", path: "/browse", icon: Compass },
  { label: "Recently released", detail: "Fresh episodes from the authorised provider", path: "/browse?status=releasing", icon: Sparkles },
  { label: "Watch featured", detail: "Start from the provider's current featured title", path: "/watch/8738/re-zero-starting-life-in-another-world-season-4-4hk9h?ep=1&lang=sub", icon: Play },
]

export function SynnimePanel() {
  const [path, setPath] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [lastPath, setLastPath] = useState<string | null>(null)

  useEffect(() => { setLastPath(window.localStorage.getItem("synnime.last-provider-path")) }, [])
  const open = (next: string) => {
    setPath(next)
    try { window.localStorage.setItem("synnime.last-provider-path", next); setLastPath(next) } catch {}
  }
  if (path) return <ProviderWebView provider="anikura" path={path} appName="Synnime" onBack={() => setPath(null)} />

  return <section className="h-full min-h-0 overflow-y-auto bg-[#080808] text-white">
    <header className="sticky top-0 z-10 border-b border-white/10 bg-black/90 px-4 py-3 backdrop-blur sm:px-6"><div className="mx-auto flex max-w-6xl items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400 text-black"><Clapperboard className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h1 className="text-lg font-semibold tracking-tight">Synnime</h1><p className="text-[11px] text-white/45">Anime, inside Synnical</p></div>{lastPath ? <button type="button" onClick={() => open(lastPath)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"><History className="mr-1 inline h-3.5 w-3.5" /> Continue</button> : null}</div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6"><section className="overflow-hidden rounded-3xl border border-violet-300/15 bg-gradient-to-br from-violet-500/20 via-[#151026] to-black p-6 shadow-2xl shadow-violet-950/30 sm:p-10"><p className="text-[11px] font-semibold uppercase tracking-[.22em] text-violet-200/65">Synnical anime</p><h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight sm:text-5xl">Find something worth binging.</h2><p className="mt-4 max-w-xl text-sm leading-6 text-white/65">Synnime keeps the app shell, recent launch, and safety controls native. Playback and catalogues come from the authorised provider.</p><form className="mt-7 flex max-w-xl gap-2" onSubmit={(event) => { event.preventDefault(); open(query.trim() ? `/browse?q=${encodeURIComponent(query.trim())}` : "/browse") }}><label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/15 bg-black/35 px-3 focus-within:border-violet-200/55"><Search className="h-4 w-4 text-white/45" /><input value={query} onChange={event => setQuery(event.target.value)} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/35" placeholder="Search anime" maxLength={100} autoComplete="off" /></label><button type="submit" className="rounded-xl bg-violet-200 px-4 text-sm font-semibold text-black hover:bg-white">Search</button></form></section>
      <section className="mt-8 grid gap-3 md:grid-cols-3">{shortcuts.map(({ label, detail, path: nextPath, icon: Icon }) => <button key={label} type="button" onClick={() => open(nextPath)} className="group rounded-2xl border border-white/10 bg-white/[.035] p-5 text-left transition hover:-translate-y-0.5 hover:border-violet-200/30 hover:bg-violet-300/[.08]"><Icon className="h-5 w-5 text-violet-200" /><h3 className="mt-6 text-sm font-semibold">{label}</h3><p className="mt-1 text-xs leading-5 text-white/45">{detail}</p></button>)}</section>
      <p className="mt-8 text-center text-xs text-white/35">Provider attribution: Anikura. The viewer blocks popups and cross-site navigation.</p></main>
  </section>
}
