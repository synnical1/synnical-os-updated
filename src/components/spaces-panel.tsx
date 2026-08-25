"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Clipboard, Copy, DoorOpen, Gamepad2, GraduationCap, Moon, Music, PartyPopper, Plus, RefreshCw, Save, Sparkles, Timer, Trash2, Users, Vote } from "lucide-react"
import { toast } from "sonner"

const kinds = [
  ["hangout", "Hangout", Users], ["birthday", "Birthday", PartyPopper], ["game", "Game room", Gamepad2],
  ["study", "Study", GraduationCap], ["late-night", "Late night", Moon], ["squad", "Gaming squad", Gamepad2],
  ["movie-night", "Movie night", Sparkles], ["music-room", "Music room", Music],
] as const

type Space = { id: string; ownerId: string; kind: string; name: string; description: string; background: string; inviteCode: string; temporary: boolean; expiresAt: string | null; createdAt: string }
type Member = { userId: string; role: string; ready: boolean; user?: { username: string; displayName: string; pfpUrl?: string | null } | null }
type Item = { id: string; creatorId: string; kind: string; title: string; data: any; createdAt: string; updatedAt: string }
type Detail = { space: Space; meId: string; role: string; members: Member[]; items: Item[] }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body as T
}
function post<T>(body: Record<string, unknown>) { return json<T>("/api/features/spaces", { method: "POST", body: JSON.stringify(body) }) }

function DrawingBoard({ item, spaceId, onSaved }: { item: Item; spaceId: string; onSaved: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const points = useRef<Array<{ x: number; y: number }>>([])
  const strokes = Array.isArray(item.data?.strokes) ? item.data.strokes : []

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"
    for (const stroke of strokes) {
      const pts = Array.isArray(stroke) ? stroke : []
      if (pts.length < 2) continue
      ctx.beginPath(); ctx.moveTo(Number(pts[0].x) || 0, Number(pts[0].y) || 0)
      for (const p of pts.slice(1)) ctx.lineTo(Number(p.x) || 0, Number(p.y) || 0)
      ctx.stroke()
    }
  }, [item.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { redraw() }, [redraw])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.round((event.clientX - rect.left) * (event.currentTarget.width / rect.width)), y: Math.round((event.clientY - rect.top) * (event.currentTarget.height / rect.height)) }
  }
  const finish = async () => {
    if (!drawing.current) return
    drawing.current = false
    const stroke = points.current.slice(0, 300)
    points.current = []
    if (stroke.length < 2) return
    const next = [...strokes.slice(-60), stroke]
    try { await post({ action: "update-item", spaceId, itemId: item.id, data: { ...item.data, strokes: next } }); onSaved() } catch (error) { toast.error(error instanceof Error ? error.message : "Drawing failed") }
  }
  return <div className="space-y-2">
    <canvas ref={canvasRef} width={700} height={260} className="h-52 w-full touch-none rounded-lg border border-white/10 bg-black" onPointerDown={(e) => { drawing.current = true; points.current = [point(e)]; e.currentTarget.setPointerCapture(e.pointerId) }} onPointerMove={(e) => { if (!drawing.current) return; points.current.push(point(e)); const canvas=canvasRef.current, ctx=canvas?.getContext("2d"); const pts=points.current; if (ctx && pts.length>1) { const a=pts[pts.length-2], b=pts[pts.length-1]; ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke() } }} onPointerUp={() => void finish()} onPointerCancel={() => void finish()} />
    <button className="rounded border border-white/15 px-2 py-1 text-xs" onClick={async () => { await post({ action: "update-item", spaceId, itemId: item.id, data: { ...item.data, strokes: [] } }); onSaved() }}>Clear canvas</button>
  </div>
}

function EditableTextItem({ item, spaceId, onSaved }: { item: Item; spaceId: string; onSaved: () => void }) {
  const [value, setValue] = useState(String(item.data?.text || ""))
  useEffect(() => setValue(String(item.data?.text || "")), [item.updatedAt])
  return <div className="space-y-2"><textarea value={value} onChange={(e) => setValue(e.target.value.slice(0, 12000))} rows={item.kind === "clipboard" ? 3 : 7} className="w-full rounded-lg border border-white/10 bg-black p-2 text-sm outline-none" /><button className="rounded bg-white px-2.5 py-1.5 text-xs font-semibold text-black" onClick={async () => { try { await post({ action: "update-item", spaceId, itemId: item.id, data: { ...item.data, text: value } }); onSaved(); toast.success("Shared content saved") } catch (error) { toast.error(error instanceof Error ? error.message : "Save failed") } }}><Save className="mr-1 inline h-3 w-3" />Save</button></div>
}

function ToolItem({ item, detail, refresh }: { item: Item; detail: Detail; refresh: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (item.kind !== "timer" && item.kind !== "countdown") return; const t=setInterval(()=>setNow(Date.now()),1000); return()=>clearInterval(t) }, [item.kind])
  const canDelete = item.creatorId === detail.meId || detail.space.ownerId === detail.meId
  const options = Array.isArray(item.data?.options) ? item.data.options : []
  const deleteButton = canDelete ? <button title="Remove" className="rounded p-1 text-white/35 hover:bg-white/10 hover:text-white" onClick={async()=>{await post({action:"delete-item",spaceId:detail.space.id,itemId:item.id});refresh()}}><Trash2 className="h-3.5 w-3.5"/></button> : null
  return <article className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
    <div className="mb-2 flex items-center gap-2"><strong className="text-sm">{item.title || item.kind.replaceAll("-", " ")}</strong><span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase text-white/35">{item.kind}</span><span className="ml-auto">{deleteButton}</span></div>
    {(item.kind === "clipboard" || item.kind === "whiteboard") && <EditableTextItem item={item} spaceId={detail.space.id} onSaved={refresh} />}
    {(item.kind === "drawing" || item.kind === "canvas") && <DrawingBoard item={item} spaceId={detail.space.id} onSaved={refresh} />}
    {(item.kind === "vote" || item.kind === "jukebox" || item.kind === "trivia" || item.kind === "reaction" || item.kind === "mood") && <div className="flex flex-wrap gap-2">{options.map((option:any)=><button key={option.id} onClick={async()=>{await post({action:"toggle-vote",spaceId:detail.space.id,itemId:item.id,optionId:option.id});refresh()}} className={`rounded-lg border px-2.5 py-1.5 text-xs ${Array.isArray(option.voters)&&option.voters.includes(detail.meId)?"border-white bg-white text-black":"border-white/15 bg-black"}`}>{option.label || option.id} <span className="opacity-55">{Array.isArray(option.voters)?option.voters.length:0}</span></button>)}</div>}
    {item.kind === "score" && <div className="grid gap-2 sm:grid-cols-2">{Object.entries(item.data?.scores || {}).map(([key,value])=><div key={key} className="flex items-center rounded-lg border border-white/10 bg-black px-2 py-1.5 text-xs"><span className="flex-1">{key}</span><button className="px-2" onClick={async()=>{await post({action:"score-delta",spaceId:detail.space.id,itemId:item.id,key,delta:-1});refresh()}}>-</button><b className="w-10 text-center">{String(value)}</b><button className="px-2" onClick={async()=>{await post({action:"score-delta",spaceId:detail.space.id,itemId:item.id,key,delta:1});refresh()}}>+</button></div>)}</div>}
    {item.kind === "timer" && <p className="font-mono text-2xl">{Math.max(0, Math.floor(((Number(item.data?.startedAt)||now)+(Number(item.data?.durationMs)||0)-now)/1000))}s</p>}
    {item.kind === "countdown" && <p className="font-mono text-2xl">{Math.max(0, Math.floor((Number(item.data?.endsAt)||now)-now)/1000)}s</p>}
    {item.kind === "file-link" && <a className="break-all text-sm text-sky-300 underline" href={String(item.data?.url||"")} target="_blank" rel="noreferrer">{String(item.data?.url||"Open shared link")}</a>}
    {["note","question","truth-dare","team","recap","challenge","match","memory","schedule"].includes(item.kind) && <div className="whitespace-pre-wrap text-sm text-white/70">{String(item.data?.text || item.data?.body || item.title || "")}</div>}
  </article>
}

export function SpacesPanel() {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [kind, setKind] = useState("hangout")
  const [ttl, setTtl] = useState(180)
  const [joinCode, setJoinCode] = useState("")

  const loadList = useCallback(async () => { try { const body=await json<{spaces:Space[]}>("/api/features/spaces"); setSpaces(body.spaces||[]) } finally { setLoading(false) } }, [])
  const loadDetail = useCallback(async (id=selectedId) => { if (!id) return; try { setDetail(await json<Detail>(`/api/features/spaces?spaceId=${encodeURIComponent(id)}`)) } catch { setSelectedId(""); setDetail(null); void loadList() } }, [selectedId, loadList])
  useEffect(()=>{void loadList()},[loadList])
  useEffect(()=>{if(selectedId)void loadDetail(selectedId)},[selectedId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!selectedId)return;const t=setInterval(()=>void loadDetail(selectedId),3500);return()=>clearInterval(t)},[selectedId,loadDetail])

  const add = async (kind: string) => {
    if (!detail) return
    let title = "", data:any = {}
    if (kind === "reaction") { title="Reaction wall"; data={options:["❤️","😂","🔥","😭","👏","💀"].map((label,i)=>({id:`r${i}`,label,voters:[]}))} }
    else if (kind === "mood") { title="Room mood"; data={options:["Chill","Hyped","Focused","Tired","Chaos"].map((label,i)=>({id:`m${i}`,label,voters:[]}))} }
    else if (kind === "score") { title=window.prompt("Scoreboard name","Scoreboard")||"Scoreboard"; const names=(window.prompt("Teams/players, comma separated","Team A, Team B")||"").split(",").map(x=>x.trim()).filter(Boolean).slice(0,20); data={scores:Object.fromEntries(names.map(x=>[x,0]))} }
    else if (kind === "clipboard") { title="Shared clipboard"; data={text:""} }
    else if (kind === "whiteboard") { title="Shared whiteboard"; data={text:""} }
    else if (kind === "drawing") { title="Collaborative drawing"; data={strokes:[]} }
    else if (kind === "timer") { const seconds=Math.max(1,Math.min(86400,Number(window.prompt("Timer seconds","300"))||300)); title="Room timer"; data={startedAt:Date.now(),durationMs:seconds*1000} }
    else if (kind === "countdown") { const minutes=Math.max(1,Math.min(10080,Number(window.prompt("Countdown minutes","60"))||60)); title="Countdown"; data={endsAt:Date.now()+minutes*60000} }
    else if (kind === "jukebox") { title=window.prompt("Song / queue item")||"Jukebox item"; const url=window.prompt("Optional song link")||""; data={url,options:[{id:"up",label:"Vote to play",voters:[]}]} }
    else if (kind === "trivia" || kind === "vote") { title=window.prompt(kind==="trivia"?"Trivia question":"Vote question")||"Question"; const labels=(window.prompt("Options, comma separated")||"").split(",").map(x=>x.trim()).filter(Boolean).slice(0,12); if(labels.length<2)return; data={options:labels.map((label,i)=>({id:`o${i}`,label,voters:[]}))} }
    else if (kind === "truth-dare") { title="Truth or dare"; data={text:window.prompt("Prompt")||"Truth or dare?"} }
    else if (kind === "question") { title="Random question"; const q=["What made you laugh today?","What game should we play next?","What's your most unpopular opinion?","What are you looking forward to?","What song is stuck in your head?"]; data={text:q[Math.floor(Math.random()*q.length)]} }
    else if (kind === "team") { title="Team picker"; const names=detail.members.map(m=>m.user?.displayName||m.user?.username||m.userId).sort(()=>Math.random()-.5); const half=Math.ceil(names.length/2); data={text:`Team 1: ${names.slice(0,half).join(", ")}\nTeam 2: ${names.slice(half).join(", ")}`} }
    else if (kind === "file-link") { title=window.prompt("Link label","Shared link")||"Shared link"; const url=window.prompt("Paste a URL")||""; if(!/^https?:\/\//i.test(url))return toast.error("Use a valid http/https link"); data={url} }
    else { title=window.prompt("Title",kind.replaceAll("-"," "))||kind; data={text:window.prompt("Text")||""} }
    try { await post({action:"add-item",spaceId:detail.space.id,kind,title,data}); await loadDetail(detail.space.id) } catch(error){toast.error(error instanceof Error?error.message:"Could not add tool")}
  }

  if (selectedId && detail) return <section className="h-full overflow-y-auto bg-black p-4 text-white sm:p-5" style={detail.space.background?{backgroundImage:`linear-gradient(rgba(0,0,0,.82),rgba(0,0,0,.82)),url(${detail.space.background})`,backgroundSize:"cover",backgroundPosition:"center"}:undefined}>
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/75 p-3 backdrop-blur">
        <button onClick={()=>{setSelectedId("");setDetail(null);void loadList()}} className="rounded border border-white/15 px-2 py-1 text-xs">← Spaces</button>
        <div className="min-w-0 flex-1"><h1 className="truncate text-xl font-semibold">{detail.space.name}</h1><p className="text-xs text-white/45">{detail.space.kind} · {detail.space.temporary?"temporary":"permanent"}</p></div>
        <button className="rounded border border-white/15 px-2 py-1 text-xs" onClick={async()=>{await navigator.clipboard.writeText(detail.space.inviteCode);toast.success("Invite code copied")}}><Copy className="mr-1 inline h-3 w-3"/>{detail.space.inviteCode}</button>
        <button className="rounded border border-white/15 px-2 py-1 text-xs" onClick={()=>void loadDetail(detail.space.id)}><RefreshCw className="h-3.5 w-3.5"/></button>
      </header>
      <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
        <aside className="space-y-3 rounded-xl border border-white/10 bg-black/75 p-3 backdrop-blur">
          <div><p className="mb-2 text-[10px] uppercase tracking-wider text-white/35">People</p>{detail.members.map(m=><div key={m.userId} className="mb-1 flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5 text-xs"><span className={`h-2 w-2 rounded-full ${m.ready?"bg-emerald-400":"bg-white/20"}`}/><span className="truncate">{m.user?.displayName||m.user?.username||"Member"}</span>{m.role==="owner"?<span className="ml-auto text-[9px] text-amber-300">OWNER</span>:null}</div>)}</div>
          <button className="w-full rounded bg-white px-2 py-1.5 text-xs font-semibold text-black" onClick={async()=>{const me=detail.members.find(m=>m.userId===detail.meId);await post({action:"ready",spaceId:detail.space.id,ready:!me?.ready});void loadDetail(detail.space.id)}}>{detail.members.find(m=>m.userId===detail.meId)?.ready?"Not ready":"I'm ready"}</button>
          {detail.space.ownerId===detail.meId?<><button className="w-full rounded border border-white/15 px-2 py-1.5 text-xs" onClick={async()=>{await post({action:"update-space",spaceId:detail.space.id,convertPermanent:true});void loadDetail(detail.space.id)}} disabled={!detail.space.temporary}>Make permanent</button><button className="w-full rounded border border-amber-400/30 px-2 py-1.5 text-xs text-amber-200" onClick={async()=>{await post({action:"archive",spaceId:detail.space.id});setSelectedId("");setDetail(null);void loadList();toast.success("Room archived as a memory")}}>Archive + recap</button></>:null}
          <button className="w-full rounded border border-rose-400/20 px-2 py-1.5 text-xs text-rose-200" onClick={async()=>{try{await post({action:"leave",spaceId:detail.space.id});setSelectedId("");setDetail(null);void loadList()}catch(e){toast.error(e instanceof Error?e.message:"Could not leave")}}}><DoorOpen className="mr-1 inline h-3 w-3"/>Leave</button>
        </aside>
        <main className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-black/75 p-3 backdrop-blur"><p className="mb-2 text-[10px] uppercase tracking-wider text-white/35">Add room tool</p><div className="flex flex-wrap gap-2">{[["reaction","Reactions"],["mood","Mood"],["score","Scoreboard"],["clipboard","Clipboard"],["whiteboard","Whiteboard"],["drawing","Drawing"],["timer","Timer"],["countdown","Countdown"],["jukebox","Jukebox"],["trivia","Trivia"],["vote","Vote"],["truth-dare","Truth / dare"],["question","Random question"],["team","Team picker"],["file-link","Link drop"],["note","Note"]].map(([k,l])=><button key={k} onClick={()=>void add(k)} className="rounded-lg border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-xs hover:border-white/30">+ {l}</button>)}</div></div>
          <div className="grid gap-3">{detail.items.length?detail.items.map(item=><ToolItem key={item.id} item={item} detail={detail} refresh={()=>void loadDetail(detail.space.id)}/>):<div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-sm text-white/35">Empty room. Add a tool above.</div>}</div>
        </main>
      </div>
    </div>
  </section>

  return <section className="h-full overflow-y-auto bg-black p-4 text-white sm:p-6"><div className="mx-auto max-w-6xl space-y-5"><header><p className="text-[10px] uppercase tracking-[.2em] text-white/35">Social Spaces</p><h1 className="mt-1 text-2xl font-semibold">Temporary rooms, squads & hangouts</h1><p className="mt-1 text-sm text-white/45">Rooms can disappear on expiry or be archived into a private memory.</p></header>
    <div className="grid gap-4 md:grid-cols-2"><form className="rounded-xl border border-white/10 bg-white/[0.025] p-4" onSubmit={async(e)=>{e.preventDefault();if(!name.trim())return;try{const r=await post<{space:Space}>({action:"create",name,kind,ttlMinutes:ttl,temporary:true});setName("");await loadList();setSelectedId(r.space.id)}catch(error){toast.error(error instanceof Error?error.message:"Could not create room")}}}><h2 className="mb-3 font-medium">Create a space</h2><input value={name} onChange={e=>setName(e.target.value)} placeholder="Room name" className="mb-2 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none"/><div className="grid grid-cols-2 gap-2"><select value={kind} onChange={e=>setKind(e.target.value)} className="rounded-lg border border-white/10 bg-black px-2 py-2 text-sm">{kinds.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><select value={ttl} onChange={e=>setTtl(Number(e.target.value))} className="rounded-lg border border-white/10 bg-black px-2 py-2 text-sm"><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={180}>3 hours</option><option value={360}>6 hours</option><option value={1440}>24 hours</option></select></div><button className="mt-3 rounded bg-white px-3 py-2 text-sm font-semibold text-black"><Plus className="mr-1 inline h-4 w-4"/>Create</button></form>
      <form className="rounded-xl border border-white/10 bg-white/[0.025] p-4" onSubmit={async(e)=>{e.preventDefault();if(!joinCode.trim())return;try{const r=await post<{space:Space}>({action:"join",inviteCode:joinCode});setJoinCode("");await loadList();setSelectedId(r.space.id)}catch(error){toast.error(error instanceof Error?error.message:"Could not join")}}}><h2 className="mb-3 font-medium">Join with invite code</h2><input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} placeholder="Invite code" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 font-mono text-sm uppercase outline-none"/><button className="mt-3 rounded border border-white/20 px-3 py-2 text-sm"><DoorOpen className="mr-1 inline h-4 w-4"/>Join space</button></form></div>
    <div><div className="mb-2 flex items-center justify-between"><h2 className="font-medium">Your active spaces</h2><button onClick={()=>void loadList()} className="rounded p-1 text-white/45 hover:text-white"><RefreshCw className="h-4 w-4"/></button></div>{loading?<p className="text-sm text-white/35">Loading…</p>:spaces.length?<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{spaces.map(space=><button key={space.id} onClick={()=>setSelectedId(space.id)} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-left hover:border-white/25"><div className="flex items-center gap-2"><strong className="truncate">{space.name}</strong><span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase text-white/35">{space.kind}</span></div><p className="mt-2 line-clamp-2 text-xs text-white/45">{space.description||"No description"}</p><p className="mt-3 font-mono text-[10px] text-white/30">{space.inviteCode}</p></button>)}</div>:<div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-sm text-white/35">No active spaces yet.</div>}</div>
  </div></section>
}
