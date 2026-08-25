"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Trophy, Swords, CalendarHeart, NotebookPen, Sparkles, Trash2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

const KINDS = [
  ["music-daily-song", "Song of the day"], ["music-blind-rating", "Blind rating"], ["music-battle", "Music battle"],
  ["music-bracket", "Tournament / bracket"], ["music-month-soundtrack", "Monthly soundtrack"], ["music-day-journal", "Song that defined today"],
  ["music-memory", "Music memory"], ["music-first-listen", "First-listen reaction"], ["music-album-checklist", "Album checklist"],
] as const

async function api(method: "GET" | "POST", body?: any) {
  const res = await fetch("/api/features/music-social", { method, credentials: "include", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || "Music social request failed")
  return json
}

export function MusicSocialPanel() {
  const [state, setState] = useState<any>({ records: [], topArtists: [] })
  const [kind, setKind] = useState<string>("music-daily-song")
  const [title, setTitle] = useState("")
  const [detail, setDetail] = useState("")
  const [visibility, setVisibility] = useState("private")
  const [friendId, setFriendId] = useState("")
  const [dare, setDare] = useState("")
  const refresh = useCallback(async () => { try { setState(await api("GET")) } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load music social") } }, [])
  useEffect(() => { void refresh() }, [refresh])
  const grouped = useMemo(() => KINDS.map(([id, label]) => ({ id, label, records: state.records?.filter((r: any) => r.kind === id) || [] })).filter((g) => g.records.length), [state.records])

  const save = async () => {
    if (!title.trim()) return toast.error("Add a title")
    await api("POST", { action: "save", kind, title, visibility, data: { note: detail, createdFor: kind } })
    setTitle(""); setDetail(""); await refresh(); toast.success("Music memory saved")
  }
  const sendDare = async () => {
    if (!friendId.trim() || !dare.trim()) return toast.error("Friend id and dare are required")
    await api("POST", { action: "friend-dare", friendId, challenge: dare })
    setDare(""); toast.success("Listening dare sent")
  }

  return <div className="mx-auto max-w-6xl space-y-5 p-5 pb-32">
    <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-2xl border border-white/10 bg-[#070707] p-5">
        <div className="flex items-center gap-2"><Trophy className="h-5 w-5" /><h2 className="text-lg font-semibold">Music Social Lab</h2></div>
        <p className="mt-1 text-xs text-white/40">Battles, brackets, monthly soundtracks, first-listen reactions, memories and journals. These are Synnical records, not fabricated streaming-service stats.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-white/10 bg-black px-3 py-2 text-sm">{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="rounded-lg border border-white/10 bg-black px-3 py-2 text-sm"><option value="private">Private</option><option value="friends">Friends</option><option value="public">Public</option></select>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Track, album, bracket or memory title" className="sm:col-span-2" />
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Reaction, rating notes, bracket entries, memory, checklist…" className="sm:col-span-2" rows={3} />
        </div>
        <Button className="mt-3" onClick={() => void save()}>Save entry</Button>
      </section>
      <section className="rounded-2xl border border-white/10 bg-[#070707] p-5">
        <div className="flex items-center gap-2"><Swords className="h-5 w-5" /><h2 className="font-semibold">Friend listening dare</h2></div>
        <p className="mt-1 text-xs text-white/40">Send a private listening challenge to an accepted friend.</p>
        <Input className="mt-4" value={friendId} onChange={(e) => setFriendId(e.target.value)} placeholder="Friend account id" />
        <Textarea className="mt-2" value={dare} onChange={(e) => setDare(e.target.value)} placeholder="Listen to this album without skipping a track…" rows={3} />
        <Button className="mt-3" variant="outline" onClick={() => void sendDare()}>Send dare</Button>
        {state.topArtists?.length ? <div className="mt-5"><p className="text-[10px] font-bold uppercase tracking-wider text-white/35">Your saved-playlist artists</p><div className="mt-2 flex flex-wrap gap-1">{state.topArtists.slice(0, 8).map((a: any) => <span key={a.artist} className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/55">{a.artist} · {a.count}</span>)}</div></div> : null}
      </section>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      {grouped.map((group) => <section key={group.id} className="rounded-xl border border-white/10 bg-[#050505] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarHeart className="h-4 w-4" />{group.label}</h3><div className="mt-3 space-y-2">{group.records.slice(0, 12).map((record: any) => <div key={record.id} className="rounded-lg border border-white/8 bg-black/50 p-3"><div className="flex gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{record.title}</p><p className="mt-1 whitespace-pre-wrap text-xs text-white/45">{record.data?.note || "Saved entry"}</p><p className="mt-2 text-[10px] text-white/25">{new Date(record.updatedAt).toLocaleString()} · {record.visibility}</p></div><button onClick={async () => { await api("POST", { action: "delete", id: record.id }); await refresh() }} className="h-8 rounded p-2 text-white/30 hover:bg-white/8 hover:text-red-300" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button></div></div>)}</div></section>)}
    </div>

    {(state.records || []).filter((r: any) => r.kind === "music-friend-dare").length ? <section className="rounded-xl border border-white/10 bg-[#050505] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4" />Listening dares for you</h3><div className="mt-3 space-y-2">{state.records.filter((r: any) => r.kind === "music-friend-dare").map((record: any) => <div key={record.id} className="flex gap-3 rounded-lg border border-white/8 p-3"><NotebookPen className="h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{record.title}</p><p className="text-xs text-white/45">{record.data?.challenge}</p></div>{record.data?.completed ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <Button size="sm" variant="outline" onClick={async () => { await api("POST", { action: "complete-dare", id: record.id }); await refresh() }}>Done</Button>}</div>)}</div></section> : null}
  </div>
}
