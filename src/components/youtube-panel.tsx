"use client"

import { useMemo, useState, type FormEvent } from "react"
import { ExternalLink, Play, Search } from "lucide-react"
import { YouTubeIcon } from "@/components/brand-app-icons"

function videoIdFromInput(input: string): string | null {
  const value = input.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    const host = url.hostname.replace(/^www\./, "").toLowerCase()
    if (host === "youtu.be") return /^[A-Za-z0-9_-]{11}$/.test(url.pathname.slice(1).split("/")[0] || "") ? url.pathname.slice(1).split("/")[0] : null
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const fromQuery = url.searchParams.get("v")
      if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)
      if (match) return match[1]
    }
  } catch {}
  return null
}

export function YouTubePanel() {
  const [input, setInput] = useState("")
  const [videoId, setVideoId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const embed = useMemo(() => videoId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0` : "", [videoId])

  const open = (event: FormEvent) => {
    event.preventDefault()
    const id = videoIdFromInput(input)
    if (!id) { setError("Paste a valid YouTube video link or 11-character video ID"); return }
    setError("")
    setVideoId(id)
  }

  return <div className="flex h-full min-h-0 flex-col bg-[#0a0a0a] text-white">
    <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
      <YouTubeIcon className="h-6 w-6" />
      <div className="min-w-0"><p className="text-sm font-semibold">YouTube</p><p className="text-[10px] text-white/35">Embedded player</p></div>
      <form onSubmit={open} className="ml-auto flex min-w-0 max-w-2xl flex-1 items-center gap-2 pl-4">
        <div className="flex min-w-0 flex-1 items-center rounded-full border border-white/15 bg-black px-3"><Search className="h-3.5 w-3.5 text-white/35" /><input value={input} onChange={(e)=>setInput(e.target.value)} placeholder="Paste a YouTube video URL or ID" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xs outline-none" /></div>
        <button className="grid h-8 w-9 place-items-center rounded-full bg-red-600 hover:bg-red-500" aria-label="Play video"><Play className="h-4 w-4 fill-current" /></button>
      </form>
    </div>
    {error ? <div className="shrink-0 border-b border-red-400/20 bg-red-500/10 px-4 py-2 text-xs text-red-200">{error}</div> : null}
    <div className="relative min-h-0 flex-1 bg-black">
      {embed ? <iframe key={embed} src={embed} title="YouTube video player" className="absolute inset-0 h-full w-full border-0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> : <div className="grid h-full place-items-center p-8 text-center"><div className="max-w-md"><YouTubeIcon className="mx-auto h-16 w-16" /><h2 className="mt-5 text-xl font-semibold">YouTube inside Synnical OS</h2><p className="mt-2 text-sm leading-6 text-white/45">Paste a YouTube video link above. Videos that allow embedding play directly in this window.</p><button onClick={() => window.dispatchEvent(new CustomEvent("synnical-open-browser", { detail: { value: "https://www.youtube.com/" } }))} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs hover:bg-white/[0.09]"><ExternalLink className="h-3.5 w-3.5" />Open YouTube in Synnical Browser</button></div></div>}
    </div>
  </div>
}
