"use client"

import { useEffect, useState } from "react"
import { Archive, BadgeCheck, BrainCircuit, Check, Plus, Sparkles, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

async function api(payload?: Record<string, unknown>) {
  const res = await fetch("/api/features/identity", payload ? { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : { credentials: "include", cache: "no-store" })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || "Identity request failed")
  return body
}
const inputClass = "w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none focus:border-white/30"

export function IdentityStudio() {
  const [data, setData] = useState<any>(null)
  const [personaName, setPersonaName] = useState("")
  const [personaDisplay, setPersonaDisplay] = useState("")
  const [personaBio, setPersonaBio] = useState("")
  const [closeFriends, setCloseFriends] = useState(false)
  const [cardKind, setCardKind] = useState("profile-icebreaker")
  const [cardTitle, setCardTitle] = useState("")
  const [cardValue, setCardValue] = useState("")
  const [visibility, setVisibility] = useState("public")
  const load = async () => setData(await api().catch((e) => { toast.error(e.message); return null }))
  useEffect(() => { void load() }, [])
  const createPersona = async () => {
    try { await api({ action: "persona-save", name: personaName, displayName: personaDisplay, bio: personaBio, mood: "", accent: "", audience: { everyone: !closeFriends, closeFriends } }); setPersonaName("");setPersonaDisplay("");setPersonaBio(""); await load(); toast.success("Persona created") }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not create persona") }
  }
  const addCard = async () => {
    const dataByKind = cardKind === "profile-icebreaker" ? { answer: cardValue } : cardKind === "profile-skill" ? { level: cardValue } : cardKind === "profile-riddle" ? { answer: cardValue } : { description: cardValue }
    try { await api({ action: cardKind, title: cardTitle, data: dataByKind, visibility }); setCardTitle("");setCardValue("");await load();toast.success("Profile card added") }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not add profile card") }
  }
  if (!data) return <div className="mt-6 rounded-xl border border-white/10 bg-[#070707] p-4 text-xs text-white/35">Loading Identity Studio…</div>
  return <section className="mt-6 space-y-4 rounded-xl border border-white/10 bg-[#070707] p-4">
    <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><div><h3 className="text-sm font-semibold">Identity Studio</h3><p className="text-xs text-white/40">Personas, profile cards, time-capsule snapshots and your account DNA.</p></div></div>
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/10 bg-black p-3"><BadgeCheck className="h-4 w-4 text-white/50" /><p className="mt-2 text-xs text-white/35">Account serial</p><p className="font-mono text-sm">{data.serial}</p></div><div className="rounded-xl border border-white/10 bg-black p-3"><Archive className="h-4 w-4 text-white/50" /><p className="mt-2 text-xs text-white/35">Generation</p><p className="text-sm">{data.generation}</p></div><div className="rounded-xl border border-white/10 bg-black p-3"><BrainCircuit className="h-4 w-4 text-white/50" /><p className="mt-2 text-xs text-white/35">Synnical DNA</p><p className="text-xs">Social {data.dna?.social || 0}% · Games {data.dna?.gamer || 0}% · Movies {data.dna?.cinephile || 0}% · Music {data.dna?.music || 0}%</p></div></div>

    <div className="rounded-xl border border-white/10 bg-black p-3"><div className="mb-3 flex items-center gap-2"><Users className="h-4 w-4" /><h4 className="text-sm font-medium">Personas</h4></div><div className="grid gap-2 md:grid-cols-2">{data.personas?.map((p:any)=><div key={p.id} className={`rounded-lg border p-3 ${p.isActive?"border-white/35 bg-white/5":"border-white/10"}`}><div className="flex gap-2"><div className="min-w-0 flex-1"><p className="font-medium">{p.displayName} <span className="text-xs text-white/30">({p.name})</span></p><p className="truncate text-xs text-white/35">{p.bio || "No persona bio"}</p></div>{p.isActive?<span className="text-xs text-emerald-300"><Check className="mr-1 inline h-3 w-3" />Active</span>:<button onClick={async()=>{await api({action:"persona-switch",id:p.id});await load()}} className="text-xs text-white/60 hover:text-white">Switch</button>}<button onClick={async()=>{await api({action:"persona-delete",id:p.id});await load()}} className="text-red-300/60 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button></div><p className="mt-2 text-[11px] text-white/25">Audience: {JSON.parse(p.audienceJson || "{}").closeFriends ? "Close Friends" : "Everyone"}</p></div>)}</div><div className="mt-3 grid gap-2 md:grid-cols-[120px_160px_1fr_auto]"><input className={inputClass} value={personaName} onChange={e=>setPersonaName(e.target.value)} placeholder="Persona name" /><input className={inputClass} value={personaDisplay} onChange={e=>setPersonaDisplay(e.target.value)} placeholder="Display name" /><input className={inputClass} value={personaBio} onChange={e=>setPersonaBio(e.target.value)} placeholder="Persona bio" /><button onClick={()=>void createPersona()} className="rounded-lg bg-white px-3 py-2 text-xs text-black"><Plus className="mr-1 inline h-3 w-3" />Create</button></div><label className="mt-2 flex items-center gap-2 text-xs text-white/40"><input type="checkbox" checked={closeFriends} onChange={e=>setCloseFriends(e.target.checked)} />This persona is for Close Friends instead of everyone</label></div>

    <div className="rounded-xl border border-white/10 bg-black p-3"><h4 className="text-sm font-medium">Profile cards</h4><div className="mt-2 grid gap-2 md:grid-cols-[170px_1fr_1fr_110px_auto]"><select className={inputClass} value={cardKind} onChange={e=>setCardKind(e.target.value)}><option value="profile-icebreaker">Icebreaker</option><option value="profile-skill">Skill</option><option value="profile-shelf">Collection shelf</option><option value="profile-riddle">Riddle</option><option value="profile-hidden-section">Hidden section</option></select><input className={inputClass} value={cardTitle} onChange={e=>setCardTitle(e.target.value)} placeholder="Question / title" /><input className={inputClass} value={cardValue} onChange={e=>setCardValue(e.target.value)} placeholder="Answer / detail" /><select className={inputClass} value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="public">Public</option><option value="friends">Friends</option><option value="private">Private</option></select><button onClick={()=>void addCard()} className="rounded-lg bg-white px-3 py-2 text-xs text-black">Add</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{data.records?.map((r:any)=><div key={r.id} className="rounded-lg border border-white/10 p-3"><div className="flex gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{r.title}</p><p className="text-xs text-white/35">{r.kind.replace("profile-","").replaceAll("-"," ")} · {r.visibility}</p><p className="mt-1 text-xs text-white/50">{String(r.data?.answer || r.data?.level || r.data?.description || "")}</p></div><button onClick={async()=>{await api({action:"delete-record",id:r.id});await load()}}><Trash2 className="h-3.5 w-3.5 text-red-300/60" /></button></div></div>)}</div></div>

    <details className="rounded-xl border border-white/10 bg-black p-3"><summary className="cursor-pointer text-sm font-medium">Profile evolution timeline ({data.snapshots?.length || 0})</summary><div className="mt-3 space-y-2">{data.snapshots?.map((s:any)=><div key={s.id} className="rounded-lg border border-white/10 p-2"><p className="text-xs text-white/35">{new Date(s.createdAt).toLocaleString()}</p><p className="text-sm">{s.data?.displayName || "Profile"}</p><p className="line-clamp-2 text-xs text-white/45">{s.data?.bio || "No bio at this snapshot"}</p></div>)}</div></details>
  </section>
}
