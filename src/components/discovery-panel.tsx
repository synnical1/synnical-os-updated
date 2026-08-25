"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Search, User, MessageSquare, Gamepad2, Clapperboard, Music, Bot, Settings,
  ShoppingCart, Activity, RefreshCw, Database, HardDrive, Wifi, Cpu, AlertTriangle,
  ExternalLink, ShieldCheck, Server, Download, Users,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { useViewProfile } from "@/components/user-profile-modal"
import type { Panel } from "@/components/app-shell"
import { cn } from "@/lib/utils"

type SearchResult = {
  type: "user" | "message" | "game" | "movie" | "music" | "command" | "setting" | "shop"
  id: string
  title: string
  subtitle: string
  data?: Record<string, any>
}

type HealthPayload = {
  now: string
  process: { pid: number; uptimeSeconds: number; node: string; memory: Record<string, number> }
  runtime: { socketClients?: number; providers?: Record<string, any> }
  database: { kind: string; path: string | null; bytes: number | null; users: number; messages: number; channels: number }
  uploads: { bytes: number; files: number; truncated?: boolean }
  workload: { activeGameSessions: number; activeDownloads: number }
  ai: { order: string; providers: any; observed: Record<string, any> }
  moderation: { textMode: string; provider: string; transcriptionModel: string }
  proxy: Record<string, string | null>
  recentEvents: Array<{ id?: string; type?: string; severity?: string; message?: string; createdAt?: string; data?: string }>
}

const TYPE_META: Record<SearchResult["type"], { label: string; icon: typeof Search }> = {
  user: { label: "People", icon: User },
  message: { label: "Messages", icon: MessageSquare },
  game: { label: "Games", icon: Gamepad2 },
  movie: { label: "SynnFlix", icon: Clapperboard },
  music: { label: "Music", icon: Music },
  command: { label: "Synn Bot", icon: Bot },
  setting: { label: "Settings", icon: Settings },
  shop: { label: "Shop", icon: ShoppingCart },
}

function formatBytes(value: number | null | undefined) {
  if (!value || value < 1) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ")
}

export function DiscoveryPanel({ onPanel }: { onPanel: (panel: Panel) => void }) {
  const { user } = useAuth()
  const openProfile = useViewProfile()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [healthError, setHealthError] = useState("")
  const [healthBusy, setHealthBusy] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearchError("")
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/features/search?q=${encodeURIComponent(q)}`, { credentials: "include", signal: controller.signal })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || "Search failed")
        setResults(Array.isArray(body?.results) ? body.results : [])
        setSearchError("")
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") setSearchError(error instanceof Error ? error.message : "Search failed")
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 240)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query])

  const refreshHealth = useCallback(async () => {
    if (user?.role !== "OWNER") return
    setHealthBusy(true)
    try {
      const res = await fetch("/api/features/health", { credentials: "include", cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Health check failed")
      setHealth(body as HealthPayload)
      setHealthError("")
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : "Health check failed")
    } finally {
      setHealthBusy(false)
    }
  }, [user?.role])

  useEffect(() => {
    if (user?.role === "OWNER") void refreshHealth()
  }, [user?.role, refreshHealth])

  const grouped = useMemo(() => {
    const groups = new Map<SearchResult["type"], SearchResult[]>()
    for (const result of results) {
      const list = groups.get(result.type) || []
      list.push(result)
      groups.set(result.type, list)
    }
    return [...groups.entries()]
  }, [results])

  const activate = (result: SearchResult) => {
    switch (result.type) {
      case "user":
        openProfile(result.id)
        return
      case "message":
        onPanel("chat")
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-chat-open-message", { detail: { channelId: result.data?.channelId, messageId: result.id } })))
        return
      case "game":
        onPanel("games")
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-game-open", { detail: { gameKey: result.data?.game_key || result.id } })))
        return
      case "movie":
        onPanel("movies")
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-synnflix-open", { detail: result.data || {} })))
        return
      case "music":
        onPanel("music")
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-music-open-track", { detail: result.data || {} })))
        return
      case "command":
        onPanel("chat")
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-chat-compose", { detail: { text: `/${String(result.data?.name || result.id).replace(/^\//, "")}` } })))
        return
      case "setting":
        onPanel("settings")
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-settings-open", { detail: { section: result.id } })))
        return
      case "shop":
        onPanel("shop")
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-shop-focus", { detail: { itemId: result.data?.id || result.id } })))
        return
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-black px-4 py-4 text-white sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">Global Search</h1>
              <p className="mt-1 text-xs text-[#888]">People, messages you can access, games, SynnFlix, music, Synn Bot, settings and shop.</p>
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666]" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all of Synnical…" className="h-11 border-[#242424] bg-[#0b0b0b] pl-10" autoComplete="off" />
            {searching && <RefreshCw className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#666]" />}
          </div>
          {searchError && <p className="mt-2 text-xs text-red-400">{searchError}</p>}

          <div className="mt-4 space-y-5">
            {query.trim().length >= 2 && !searching && !searchError && results.length === 0 && <p className="rounded-xl border border-[#202020] bg-[#080808] p-6 text-center text-sm text-[#777]">No matching Synnical results.</p>}
            {grouped.map(([type, items]) => {
              const meta = TYPE_META[type]
              const Icon = meta.icon
              return (
                <div key={type}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-[#777]"><Icon className="h-3.5 w-3.5" />{meta.label}<span className="font-normal tracking-normal text-[#555]">{items.length}</span></div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {items.map((result) => (
                      <button key={`${result.type}:${result.id}`} onClick={() => activate(result)} className="group flex min-w-0 items-center gap-3 rounded-xl border border-[#202020] bg-[#090909] p-3 text-left transition-colors hover:border-[#363636] hover:bg-[#101010]">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#151515]"><Icon className="h-4 w-4 text-[#bcbcbc]" /></div>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{result.title}</p><p className="mt-0.5 truncate text-xs text-[#777]">{result.subtitle}</p></div>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#4a4a4a] group-hover:text-[#aaa]" />
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {user?.role === "OWNER" && (
          <section className="border-t border-[#1d1d1d] pt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Activity className="h-5 w-5" />System Health</h2><p className="mt-1 text-xs text-[#777]">Live facts from this Synnical process, database and runtime.</p></div>
              <Button variant="outline" size="sm" onClick={() => void refreshHealth()} disabled={healthBusy}><RefreshCw className={cn("mr-2 h-3.5 w-3.5", healthBusy && "animate-spin")} />Refresh</Button>
            </div>
            {healthError && <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300"><AlertTriangle className="mr-2 inline h-4 w-4" />{healthError}</div>}
            {health && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <HealthCard icon={Server} label="Process uptime" value={formatDuration(health.process.uptimeSeconds)} detail={`${health.process.node} · PID ${health.process.pid}`} />
                  <HealthCard icon={Wifi} label="Socket clients" value={String(health.runtime?.socketClients || 0)} detail="Live Socket.IO connections" />
                  <HealthCard icon={Database} label="Database" value={formatBytes(health.database.bytes)} detail={`${health.database.users} users · ${health.database.messages} messages`} />
                  <HealthCard icon={HardDrive} label="Uploads" value={formatBytes(health.uploads.bytes)} detail={`${health.uploads.files.toLocaleString()} files${health.uploads.truncated ? "+" : ""}`} />
                  <HealthCard icon={Gamepad2} label="Game sessions" value={String(health.workload.activeGameSessions)} detail="Active provider sessions" />
                  <HealthCard icon={Download} label="Downloads" value={String(health.workload.activeDownloads)} detail="Active browser downloads" />
                  <HealthCard icon={Cpu} label="Memory RSS" value={formatBytes(health.process.memory?.rss)} detail={`Heap ${formatBytes(health.process.memory?.heapUsed)}`} />
                  <HealthCard icon={Users} label="Channels" value={String(health.database.channels)} detail={`${health.database.kind}${health.database.path ? ` · ${health.database.path}` : ""}`} />
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-[#202020] bg-[#090909] p-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4" />AI & moderation</h3><KeyValue label="Completion order" value={health.ai.order} /><KeyValue label="Text moderation" value={`${health.moderation.provider} · ${health.moderation.textMode}`} /><KeyValue label="Transcription" value={health.moderation.transcriptionModel} /><div className="mt-3 space-y-1">{Object.entries(health.ai.observed || {}).map(([name, value]) => <KeyValue key={name} label={name} value={typeof value === "string" ? value : JSON.stringify(value)} />)}</div></div>
                  <div className="rounded-xl border border-[#202020] bg-[#090909] p-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" />Proxy runtime</h3>{Object.entries(health.proxy || {}).map(([name, value]) => <KeyValue key={name} label={name} value={value || "not declared"} />)}</div>
                </div>
                <div className="mt-3 rounded-xl border border-[#202020] bg-[#090909] p-4"><h3 className="mb-3 text-sm font-semibold">Recent runtime events</h3><div className="max-h-64 space-y-2 overflow-y-auto">{health.recentEvents?.length ? health.recentEvents.map((event, index) => <div key={event.id || index} className="rounded-lg border border-[#181818] bg-black px-3 py-2"><div className="flex gap-2 text-xs"><span className="font-medium text-[#bbb]">{event.type || "event"}</span>{event.severity && <span className="text-[#666]">{event.severity}</span>}<span className="ml-auto text-[#555]">{event.createdAt ? new Date(event.createdAt).toLocaleString() : ""}</span></div>{event.message && <p className="mt-1 break-words text-xs text-[#858585]">{event.message}</p>}</div>) : <p className="text-xs text-[#666]">No recent recorded runtime events.</p>}</div></div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function HealthCard({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-[#202020] bg-[#090909] p-4"><div className="flex items-center gap-2 text-xs text-[#777]"><Icon className="h-3.5 w-3.5" />{label}</div><p className="mt-2 text-xl font-semibold">{value}</p><p className="mt-1 truncate text-[11px] text-[#5f5f5f]">{detail}</p></div>
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3 border-b border-[#171717] py-1.5 last:border-0"><span className="text-xs text-[#676767]">{label}</span><span className="max-w-[65%] break-words text-right text-xs text-[#aaa]">{value}</span></div>
}
