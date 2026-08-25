"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Brush, Copy, History, Save, Sparkles, Trash2, UserPlus, CheckCircle2, FlaskConical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

async function request(body?: any) {
  const res = await fetch("/api/features/creator", { method: body ? "POST" : "GET", credentials: "include", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const json = await res.json().catch(() => ({})); if (!res.ok) throw new Error(json.error || "Creator Studio request failed"); return json
}
const baseState = { assetUrl: "", scale: 1, rotation: 0, opacity: 1, particleCount: 12, animationDuration: 3, keyframes: [] as any[], collaborators: [] as string[], attribution: "", background: "dark" }

export function CreatorStudioPanel() {
  const [data, setData] = useState<any>({ projects: [], meId: "" })
  const [selectedId, setSelectedId] = useState<string>("")
  const [name, setName] = useState("New decoration")
  const [kind, setKind] = useState("avatar-decoration")
  const [description, setDescription] = useState("")
  const [state, setState] = useState<any>(baseState)
  const [collaborator, setCollaborator] = useState("")
  const [validation, setValidation] = useState<string[]>([])
  const refresh = useCallback(async () => { const next = await request(); setData(next); return next }, [])
  useEffect(() => { void refresh().catch(e => toast.error(e.message)) }, [refresh])
  const selected = useMemo(() => data.projects?.find((p: any) => p.id === selectedId), [data.projects, selectedId])
  useEffect(() => { if (!selected) return; setName(selected.name); setKind(selected.kind); setDescription(selected.description || ""); setState({ ...baseState, ...(selected.state || {}) }) }, [selected?.id])
  const create = async () => { const result = await request({ action: "create", name, kind, description, state }); await refresh(); setSelectedId(result.project.id); toast.success("Creator draft created") }
  const save = async () => { if (!selectedId) return create(); await request({ action: "save", projectId: selectedId, name, description, state }); await refresh(); toast.success("Draft saved") }
  const checkpoint = async () => { if (!selectedId) return; const note = prompt("Version note") || "Checkpoint"; await request({ action: "checkpoint", projectId: selectedId, note }); await refresh(); toast.success("Version saved") }
  const validate = async () => { const result = await request({ action: "validate", state }); setState(result.normalized || state); setValidation(result.warnings || []); toast.success(result.warnings?.length ? "Valid with warnings" : "Project looks good") }
  const addFrame = () => setState((s: any) => ({ ...s, keyframes: [...(s.keyframes || []), { time: Number(((s.keyframes?.length || 0) * .5).toFixed(1)), scale: s.scale, rotation: s.rotation, opacity: s.opacity }].slice(0, 60) }))

  return <section className="flex h-full min-h-0 bg-black text-white">
    <aside className="w-72 shrink-0 overflow-y-auto border-r border-white/10 bg-[#050505] p-3 custom-scroll">
      <div className="flex items-center gap-2 px-2 py-2"><Brush className="h-5 w-5" /><div><h1 className="text-sm font-semibold">Creator Studio</h1><p className="text-[10px] text-white/35">Drafts & prototypes</p></div></div>
      <Button className="mt-2 w-full" onClick={() => { setSelectedId(""); setName("New decoration"); setKind("avatar-decoration"); setDescription(""); setState(baseState) }}>New project</Button>
      <div className="mt-3 space-y-1">{data.projects?.map((p: any) => <button key={p.id} onClick={() => setSelectedId(p.id)} className={`w-full rounded-lg border p-3 text-left ${selectedId === p.id ? "border-white/35 bg-white/10" : "border-white/8 hover:bg-white/5"}`}><p className="truncate text-xs font-medium">{p.name}</p><p className="mt-1 text-[10px] text-white/35">{p.kind} · {p.status}{p.ownerId !== data.meId ? " · collaborator" : ""}</p></button>)}</div>
    </aside>
    <div className="min-w-0 flex-1 overflow-y-auto p-5 custom-scroll">
      <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2"><Input value={name} onChange={e=>setName(e.target.value)} className="min-w-[220px] flex-1" /><select value={kind} onChange={e=>setKind(e.target.value)} disabled={Boolean(selectedId)} className="rounded-lg border border-white/10 bg-black px-3 text-sm"><option value="avatar-decoration">Avatar decoration</option><option value="profile-effect">Profile effect</option><option value="particle-effect">Particle effect</option></select><Button onClick={()=>void save()}><Save className="mr-2 h-4 w-4" />Save</Button></div>
          <Textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Project description / changelog notes" rows={2} />
          <section className="rounded-xl border border-white/10 bg-[#070707] p-4"><h2 className="text-sm font-semibold">Asset & transform</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-white/50 sm:col-span-2">Asset URL<Input value={state.assetUrl || ""} onChange={e=>setState({...state,assetUrl:e.target.value})} placeholder="/uploads/... or https://..." className="mt-1" /></label>{[["Scale","scale",.2,4,.05],["Rotation","rotation",-360,360,1],["Opacity","opacity",0,1,.05],["Particles","particleCount",0,80,1],["Animation seconds","animationDuration",.2,30,.1]].map(([label,key,min,max,step]:any)=><label key={key} className="text-xs text-white/50">{label} · {state[key]}<input className="mt-2 w-full accent-white" type="range" min={min} max={max} step={step} value={state[key]} onChange={e=>setState({...state,[key]:Number(e.target.value)})} /></label>)}</div></section>
          <section className="rounded-xl border border-white/10 bg-[#070707] p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Animation timeline</h2><Button size="sm" variant="outline" onClick={addFrame}>Add keyframe</Button></div><div className="mt-3 space-y-2">{(state.keyframes || []).map((k:any,i:number)=><div key={i} className="grid grid-cols-[70px_1fr_1fr_1fr_32px] items-center gap-2 rounded border border-white/8 p-2 text-[10px]"><Input type="number" step=".1" value={k.time} onChange={e=>{const a=[...state.keyframes];a[i]={...k,time:Number(e.target.value)};setState({...state,keyframes:a})}} /><span>scale {k.scale}</span><span>rot {k.rotation}°</span><span>opacity {k.opacity}</span><button onClick={()=>setState({...state,keyframes:state.keyframes.filter((_:any,j:number)=>j!==i)})}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div></section>
          {selected && <section className="rounded-xl border border-white/10 bg-[#070707] p-4"><div className="flex flex-wrap items-center gap-2"><History className="h-4 w-4" /><h2 className="mr-auto text-sm font-semibold">Version history</h2><Button size="sm" variant="outline" onClick={()=>void checkpoint()}>Checkpoint</Button><Button size="sm" variant="outline" onClick={async()=>{const r=await request({action:"duplicate",projectId:selected.id});await refresh();setSelectedId(r.project.id)}}><Copy className="mr-1 h-3.5 w-3.5" />Duplicate</Button></div><div className="mt-3 space-y-1">{selected.versions?.map((v:any)=><div key={v.id} className="flex items-center gap-2 rounded border border-white/8 px-3 py-2 text-xs"><span className="font-medium">v{v.version}</span><span className="min-w-0 flex-1 truncate text-white/45">{v.note}</span><Button size="sm" variant="ghost" onClick={async()=>{await request({action:"restore",projectId:selected.id,versionId:v.id});await refresh()}}>Restore</Button></div>)}</div></section>}
          {selected?.ownerId === data.meId && <section className="rounded-xl border border-white/10 bg-[#070707] p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4" />Collaborators</h2><p className="mt-1 text-xs text-white/40">Collaborators must already be your friend. They can edit and checkpoint, but cannot delete the project or manage collaborators.</p><div className="mt-3 flex gap-2"><Input value={collaborator} onChange={e=>setCollaborator(e.target.value)} placeholder="Friend account id" /><Button variant="outline" onClick={async()=>{await request({action:"collaborator",projectId:selected.id,userId:collaborator});setCollaborator("");await refresh()}}>Add</Button></div><div className="mt-2 flex flex-wrap gap-1">{selected.state?.collaborators?.map((id:string)=><button key={id} onClick={async()=>{await request({action:"collaborator",projectId:selected.id,userId:id,remove:true});await refresh()}} className="rounded-full border border-white/10 px-2 py-1 text-[10px]">{id} ×</button>)}</div></section>}
        </div>
        <aside className="space-y-4">
          <section className={`overflow-hidden rounded-2xl border border-white/10 p-6 ${state.background === "light" ? "bg-[#eee] text-black" : "bg-[#080808] text-white"}`}><div className="flex justify-between"><h2 className="text-sm font-semibold">Test profile</h2><button onClick={()=>setState({...state,background:state.background==="light"?"dark":"light"})} className="text-[10px] opacity-50">Switch background</button></div><div className="mt-8 grid place-items-center"><div className="relative h-40 w-40"><div className="absolute inset-5 rounded-full bg-gradient-to-br from-[#222] to-[#555]" />{Array.from({length:Math.min(80,Number(state.particleCount)||0)}).map((_,i)=><span key={i} className="absolute h-1.5 w-1.5 rounded-full bg-current opacity-40" style={{left:`${10+(i*37)%80}%`,top:`${5+(i*53)%90}%`}} />)}{state.assetUrl ? <img src={state.assetUrl} alt="Decoration prototype" className="absolute inset-0 h-full w-full object-contain" style={{transform:`scale(${state.scale}) rotate(${state.rotation}deg)`,opacity:state.opacity}} /> : <Sparkles className="absolute inset-0 m-auto h-16 w-16 opacity-35" />}</div></div><p className="mt-6 text-center text-[10px] opacity-50">Prototype preview only. Saving a creator project does not silently publish it to the Shop.</p></section>
          <section className="rounded-xl border border-white/10 bg-[#070707] p-4"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /><h2 className="text-sm font-semibold">Asset validation</h2></div><Button className="mt-3 w-full" variant="outline" onClick={()=>void validate()}>Validate prototype</Button>{validation.length ? <ul className="mt-3 space-y-1 text-xs text-amber-200">{validation.map(x=><li key={x}>• {x}</li>)}</ul> : <p className="mt-2 text-xs text-white/35">Checks URL shape, keyframe load and particle intensity.</p>}</section>
          {selected?.ownerId === data.meId && <section className="rounded-xl border border-white/10 bg-[#070707] p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4" />Prototype status</h2><p className="mt-1 text-xs text-white/40">Beta marks the creator prototype as ready for internal testing. It does not publish a purchasable cosmetic.</p><div className="mt-3 flex gap-2"><Button size="sm" variant={selected.status==="draft"?"default":"outline"} onClick={async()=>{await request({action:"status",projectId:selected.id,status:"draft"});await refresh()}}>Draft</Button><Button size="sm" variant={selected.status==="beta"?"default":"outline"} onClick={async()=>{await request({action:"status",projectId:selected.id,status:"beta"});await refresh()}}>Beta</Button></div></section>}
        </aside>
      </div>
    </div>
  </section>
}
