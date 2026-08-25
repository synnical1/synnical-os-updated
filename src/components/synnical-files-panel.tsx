"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronDown, ChevronRight, Clock3, Download, File, Folder, Grid2X2, Home,
  Image as ImageIcon, LayoutList, MoreHorizontal, RefreshCcw, Search, Trash2,
  ExternalLink, Copy, Info, X, ArrowUp, Scissors, Clipboard, Share2, Pencil,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"

type DownloadRow = {
  id: string
  url: string
  filename: string
  status: string
  bytesReceived: number
  bytesTotal: number | null
  startedAt: string
  finishedAt?: string | null
}

type ScreenshotRow = {
  id: string
  gameId: string
  fileUrl: string
  createdAt: string
}

type FileView = "home" | "downloads" | "screenshots" | "recent" | "recycle"
type SortMode = "name" | "date" | "size" | "type"

type FileItem = {
  key: string
  kind: "download" | "screenshot"
  name: string
  subtitle: string
  date: number
  size: number | null
  url: string
  image?: string
  status?: string
  rawId: string
}

function prettyBytes(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—"
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

function copyText(value: string) {
  navigator.clipboard?.writeText(value).then(() => {
    window.dispatchEvent(new CustomEvent("synnical-clipboard-add", { detail: { text: value } }))
  }).catch(() => {})
}

export function SynnicalFilesPanel() {
  const { user } = useAuth()
  const [view, setView] = useState<FileView>("home")
  const [downloads, setDownloads] = useState<DownloadRow[]>([])
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortMode>("date")
  const [grid, setGrid] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [preview, setPreview] = useState<FileItem | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; item: FileItem } | null>(null)
  const [tabs, setTabs] = useState<{ id: string; view: FileView }[]>([{ id: "home", view: "home" }])
  const [tabId, setTabId] = useState("home")

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [browserRes, gamesRes] = await Promise.all([
        fetch("/api/features/browser", { credentials: "include", cache: "no-store" }),
        fetch("/api/features/games", { credentials: "include", cache: "no-store" }),
      ])
      const browser = browserRes.ok ? await browserRes.json() : {}
      const games = gamesRes.ok ? await gamesRes.json() : {}
      setDownloads(Array.isArray(browser?.downloads) ? browser.downloads : [])
      setScreenshots(Array.isArray(games?.screenshots) ? games.screenshots : [])
    } catch {
      setDownloads([]); setScreenshots([])
    } finally { setLoading(false) }
  }, [user])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const open = (event: Event) => {
      const value = (event as CustomEvent<{ view?: unknown }>).detail?.view
      if (["home", "downloads", "screenshots", "recent", "recycle"].includes(String(value))) setView(value as FileView)
    }
    window.addEventListener("synnical-files-open", open)
    return () => window.removeEventListener("synnical-files-open", open)
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "t") return
      event.preventDefault()
      const id = crypto.randomUUID?.() || `${Date.now()}`
      setTabs((rows) => [...rows, { id, view }])
      setTabId(id)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [view])

  const items = useMemo<FileItem[]>(() => {
    const d = downloads.map((row): FileItem => ({
      key: `download:${row.id}`, kind: "download", rawId: row.id, name: row.filename || "download",
      subtitle: row.status === "complete" ? "Downloaded" : row.status || "Download",
      date: new Date(row.finishedAt || row.startedAt || 0).getTime(), size: row.bytesTotal ?? row.bytesReceived ?? null, url: row.url, status: row.status,
    }))
    const s = screenshots.map((row): FileItem => ({
      key: `shot:${row.id}`, kind: "screenshot", rawId: row.id, name: `Screenshot · ${row.gameId}`,
      subtitle: "Game screenshot", date: new Date(row.createdAt || 0).getTime(), size: null, url: row.fileUrl, image: row.fileUrl,
    }))
    let rows = view === "downloads" ? d : view === "screenshots" ? s : view === "recycle" ? [] : [...s, ...d]
    if (view === "recent") rows = rows.sort((a, b) => b.date - a.date).slice(0, 50)
    const needle = query.trim().toLowerCase()
    if (needle) rows = rows.filter((row) => `${row.name} ${row.subtitle}`.toLowerCase().includes(needle))
    return rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name)
      if (sort === "size") return (b.size || 0) - (a.size || 0)
      if (sort === "type") return a.kind.localeCompare(b.kind) || b.date - a.date
      return b.date - a.date
    })
  }, [downloads, screenshots, view, query, sort])

  const selectedItem = items.find((row) => row.key === selected) || null
  const openItem = (item: FileItem) => {
    if (item.kind === "screenshot") setPreview(item)
    else window.dispatchEvent(new CustomEvent("synnical-open-browser", { detail: { value: item.url } }))
  }
  const removeScreenshot = async (item: FileItem) => {
    if (item.kind !== "screenshot") return
    const res = await fetch(`/api/features/games/screenshot/${encodeURIComponent(item.rawId)}`, { method: "DELETE", credentials: "include" })
    if (res.ok) {
      setScreenshots((rows) => rows.filter((row) => row.id !== item.rawId))
      setSelected(null); setPreview(null); setMenu(null)
    }
  }

  if (!user) return <div className="grid h-full place-items-center bg-[#0b0b0b] p-8 text-center"><div><Folder className="mx-auto h-10 w-10 text-white/40" /><h2 className="mt-4 text-lg font-semibold">Synnical Files</h2><p className="mt-2 max-w-md text-sm text-white/45">Sign in to see account downloads and private Synnical screenshots.</p></div></div>

  const side: { id: FileView; label: string; icon: typeof Home }[] = [
    { id: "home", label: "Home", icon: Home }, { id: "recent", label: "Recent", icon: Clock3 },
    { id: "downloads", label: "Downloads", icon: Download }, { id: "screenshots", label: "Screenshots", icon: ImageIcon },
    { id: "recycle", label: "Recycle Bin", icon: Trash2 },
  ]
  const iconSize = grid ? "h-10 w-10" : "h-5 w-5"

  return <div className="synnical-files-app flex h-full min-h-0 flex-col bg-[#0c0c0d] text-white">
    <div className="flex h-10 shrink-0 items-end gap-1 border-b border-white/10 bg-white/[0.025] px-2 pt-1">
      {tabs.map((tab) => <button key={tab.id} onClick={() => { setTabId(tab.id); setView(tab.view) }} className={cn("group flex h-8 min-w-32 max-w-52 items-center gap-2 rounded-t-lg px-3 text-xs", tabId === tab.id ? "bg-white/[0.09]" : "hover:bg-white/[0.05]")}><Folder className="h-3.5 w-3.5" /><span className="flex-1 truncate text-left">{side.find((x) => x.id === tab.view)?.label || "Files"}</span>{tabs.length > 1 ? <span onClick={(e) => { e.stopPropagation(); setTabs((rows) => rows.filter((x) => x.id !== tab.id)); if (tabId === tab.id) setTabId(tabs.find((x) => x.id !== tab.id)?.id || "home") }} className="opacity-0 group-hover:opacity-100"><X className="h-3 w-3" /></span> : null}</button>)}
      <button onClick={() => { const id = crypto.randomUUID?.() || `${Date.now()}`; setTabs((rows) => [...rows, { id, view: "home" }]); setTabId(id); setView("home") }} className="mb-1 grid h-6 w-7 place-items-center rounded hover:bg-white/10" title="New tab (Ctrl+T)">+</button>
    </div>
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3">
      <button onClick={() => setView("home")} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><ArrowUp className="h-4 w-4" /></button>
      <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-white/10 bg-black/30 px-3 text-xs text-white/65"><Home className="mr-2 h-3.5 w-3.5" /><ChevronRight className="mr-2 h-3 w-3" /><span>Synnical</span><ChevronRight className="mx-2 h-3 w-3" /><span className="truncate text-white/90">{side.find((x) => x.id === view)?.label}</span></div>
      <div className="flex h-8 w-56 max-w-[32vw] items-center rounded-md border border-white/10 bg-black/30 px-2"><Search className="h-3.5 w-3.5 text-white/40" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${side.find((x) => x.id === view)?.label || "Files"}`} className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none" /></div>
    </div>
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/10 px-3 text-xs">
      <button className="flex items-center gap-1.5 rounded px-2 py-1.5 hover:bg-white/10"><span className="text-lg leading-none">+</span> New</button><span className="mx-1 h-5 w-px bg-white/10" />
      {[{ icon: Scissors, label: "Cut" }, { icon: Copy, label: "Copy" }, { icon: Clipboard, label: "Paste" }, { icon: Pencil, label: "Rename" }, { icon: Share2, label: "Share" }].map(({icon:Icon,label}) => <button key={label} disabled className="grid h-8 w-8 place-items-center rounded text-white/25 disabled:cursor-not-allowed" title={`${label} is unavailable for this account-backed view`}><Icon className="h-4 w-4" /></button>)}
      <button disabled={!selectedItem || selectedItem.kind !== "screenshot"} onClick={() => selectedItem && removeScreenshot(selectedItem)} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10 disabled:text-white/25"><Trash2 className="h-4 w-4" /></button>
      <span className="mx-1 h-5 w-px bg-white/10" />
      <label className="flex items-center gap-1 rounded px-2 py-1.5 hover:bg-white/10">Sort <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="bg-transparent text-xs outline-none"><option className="bg-[#111]" value="date">Date modified</option><option className="bg-[#111]" value="name">Name</option><option className="bg-[#111]" value="type">Item type</option><option className="bg-[#111]" value="size">Size</option></select></label>
      <button onClick={() => setGrid((v) => !v)} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10" title={grid ? "Details view" : "Grid view"}>{grid ? <LayoutList className="h-4 w-4" /> : <Grid2X2 className="h-4 w-4" />}</button>
      <button onClick={() => setDetailsOpen((v) => !v)} className={cn("grid h-8 w-8 place-items-center rounded hover:bg-white/10", detailsOpen && "bg-white/10")} title="Details pane"><Info className="h-4 w-4" /></button>
      <button onClick={load} className="ml-auto grid h-8 w-8 place-items-center rounded hover:bg-white/10" title="Refresh"><RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} /></button>
      <MoreHorizontal className="h-4 w-4 text-white/50" />
    </div>
    <div className="flex min-h-0 flex-1">
      <aside className="w-48 shrink-0 overflow-y-auto border-r border-white/10 p-2">
        {side.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setView(id); setTabs((rows) => rows.map((tab) => tab.id === tabId ? { ...tab, view: id } : tab)) }} className={cn("mb-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs", view === id ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white")}><Icon className="h-4 w-4" />{label}</button>)}
        <div className="mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/25">Account locations</div>
        <button onClick={() => setView("downloads")} className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-white/50 hover:bg-white/[0.06]"><ChevronDown className="h-3.5 w-3.5" /> This Synnical</button>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-3 custom-scroll">
        {view === "recycle" ? <div className="grid h-full min-h-52 place-items-center text-center"><div><Trash2 className="mx-auto h-10 w-10 text-white/20" /><p className="mt-3 text-sm font-medium">Recycle Bin is empty</p><p className="mt-1 max-w-md text-xs text-white/35">Private screenshots are currently deleted immediately by the server, so Synnical does not pretend they can be restored.</p></div></div> : items.length === 0 && !loading ? <div className="grid h-full min-h-52 place-items-center text-center text-sm text-white/35"><div><Folder className="mx-auto mb-3 h-10 w-10 text-white/20" />No items here.</div></div> : grid ? <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">{items.map((item) => <button key={item.key} onDoubleClick={() => openItem(item)} onClick={() => setSelected(item.key)} onContextMenu={(e) => { e.preventDefault(); setSelected(item.key); setMenu({ x: e.clientX, y: e.clientY, item }) }} className={cn("flex min-h-28 flex-col items-center justify-center rounded-lg border p-2 text-center", selected === item.key ? "border-sky-400/60 bg-sky-400/10" : "border-transparent hover:bg-white/[0.06]")}>{item.image ? <img src={item.image} alt="" className="h-16 w-20 rounded object-cover" /> : <File className={cn(iconSize, "text-sky-300")} />}<span className="mt-2 line-clamp-2 text-[11px]">{item.name}</span></button>)}</div> : <div className="min-w-[620px]"><div className="grid grid-cols-[minmax(220px,1.5fr)_160px_140px_100px] border-b border-white/10 px-2 py-2 text-[10px] text-white/35"><span>Name</span><span>Date modified</span><span>Type</span><span>Size</span></div>{items.map((item) => <button key={item.key} onDoubleClick={() => openItem(item)} onClick={() => setSelected(item.key)} onContextMenu={(e) => { e.preventDefault(); setSelected(item.key); setMenu({ x: e.clientX, y: e.clientY, item }) }} className={cn("grid w-full grid-cols-[minmax(220px,1.5fr)_160px_140px_100px] items-center rounded px-2 py-1.5 text-left text-xs", selected === item.key ? "bg-sky-400/15 outline outline-1 outline-sky-400/30" : "hover:bg-white/[0.05]")}><span className="flex min-w-0 items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center">{item.image ? <img src={item.image} alt="" className="h-7 w-7 rounded object-cover" /> : <File className="h-4 w-4 text-sky-300" />}</span><span className="truncate">{item.name}</span></span><span className="text-white/50">{new Date(item.date || 0).toLocaleString()}</span><span className="text-white/50">{item.kind === "screenshot" ? "Image" : item.status || "Download"}</span><span className="text-white/50">{prettyBytes(item.size)}</span></button>)}</div>}
      </main>
      {detailsOpen ? <aside className="w-64 shrink-0 overflow-y-auto border-l border-white/10 bg-white/[0.015] p-4">{selectedItem ? <div><div className="grid h-40 place-items-center overflow-hidden rounded-xl bg-black/30">{selectedItem.image ? <img src={selectedItem.image} alt="" className="h-full w-full object-contain" /> : <File className="h-14 w-14 text-sky-300" />}</div><h3 className="mt-4 break-words text-sm font-semibold">{selectedItem.name}</h3><dl className="mt-4 space-y-3 text-xs"><div><dt className="text-white/35">Type</dt><dd className="mt-1">{selectedItem.kind}</dd></div><div><dt className="text-white/35">Date modified</dt><dd className="mt-1">{new Date(selectedItem.date).toLocaleString()}</dd></div><div><dt className="text-white/35">Size</dt><dd className="mt-1">{prettyBytes(selectedItem.size)}</dd></div></dl></div> : <div className="text-xs text-white/35">Select an item to see details.</div>}</aside> : null}
    </div>
    {preview ? <div className="absolute inset-0 z-50 grid place-items-center bg-black/80 p-8" onClick={() => setPreview(null)}><div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}><img src={preview.image} alt={preview.name} className="max-h-[76vh] max-w-[82vw] rounded-xl object-contain shadow-2xl" /><button onClick={() => setPreview(null)} className="absolute -right-3 -top-3 grid h-8 w-8 place-items-center rounded-full bg-white text-black"><X className="h-4 w-4" /></button></div></div> : null}
    {menu ? <div className="fixed z-[20000] min-w-48 rounded-xl border border-white/15 bg-[#171719]/95 p-1.5 text-xs shadow-2xl backdrop-blur-xl" style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 220) }} onMouseLeave={() => setMenu(null)}><button onClick={() => { openItem(menu.item); setMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><ExternalLink className="h-3.5 w-3.5" />Open</button><button onClick={() => { copyText(menu.item.url); setMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Copy className="h-3.5 w-3.5" />Copy link</button>{menu.item.kind === "screenshot" ? <><div className="my-1 h-px bg-white/10" /><button onClick={() => removeScreenshot(menu.item)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />Delete</button></> : null}</div> : null}
  </div>
}
