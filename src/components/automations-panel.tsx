"use client"

import { useEffect, useMemo, useState } from "react"
import { Bot, History, Play, Power, Share2, Sparkles, Trash2, Undo2, WandSparkles } from "lucide-react"
import { toast } from "sonner"

const TRIGGERS = [
  ["time_of_day", "Time of day"], ["game_launch", "Game launch"], ["message_contains", "Message contains"],
  ["friend_online", "Friend comes online"], ["credits_at_least", "Credits reach amount"], ["panel_open", "Open a Synnical section"],
] as const
const ACTIONS = [
  ["set_presence", "Set presence/status"], ["open_panel", "Open Synnical section"], ["mute_music", "Mute Synnical music"],
  ["set_theme", "Switch theme"], ["set_setting", "Change safe setting"], ["notify", "Show notification"],
] as const

async function api(payload?: Record<string, unknown>) {
  const res = await fetch("/api/features/automations", payload ? { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : { credentials: "include", cache: "no-store" })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || "Automation request failed")
  return body
}

function fieldClass() { return "w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-white/30" }

export function AutomationsPanel() {
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [natural, setNatural] = useState("")
  const [name, setName] = useState("My routine")
  const [triggerType, setTriggerType] = useState("game_launch")
  const [actionType, setActionType] = useState("mute_music")
  const [trigger, setTrigger] = useState<Record<string, unknown>>({ gameName: "" })
  const [ruleAction, setRuleAction] = useState<Record<string, unknown>>({ mute: true })
  const load = async () => setData(await api().catch((e) => { toast.error(e.message); return null }))
  useEffect(() => { void load() }, [])

  const resetTrigger = (type: string) => {
    setTriggerType(type)
    setTrigger(type === "time_of_day" ? { hour: 20, minute: 0, days: [] } : type === "message_contains" ? { words: [""], direction: "any" } : type === "friend_online" ? { username: "" } : type === "credits_at_least" ? { amount: 1000 } : type === "panel_open" ? { panel: "games" } : { gameName: "" })
  }
  const resetAction = (type: string) => {
    setActionType(type)
    setRuleAction(type === "set_presence" ? { mode: "available_to_play", status: "", durationMinutes: 0 } : type === "open_panel" ? { panel: "chat" } : type === "mute_music" ? { mute: true } : type === "set_theme" ? { theme: "blood" } : type === "set_setting" ? { key: "perf.autoScale", value: true } : { title: "Synnical automation", body: "Routine completed" })
  }
  const save = async () => {
    setBusy(true)
    try { await api({ action: "save-rule", name, triggerType, trigger, actionType, ruleAction, cooldownSeconds: 60, permission: { allowClientActions: true } }); toast.success("Routine saved"); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save routine") } finally { setBusy(false) }
  }
  const parseNatural = async () => {
    if (!natural.trim()) return
    setBusy(true)
    try {
      const body = await api({ action: "parse", text: natural })
      const p = body.parsed
      setName(p.name); setTriggerType(p.triggerType); setTrigger(p.trigger); setActionType(p.actionType); setRuleAction(p.action)
      toast.success("Routine preview built. Review it before saving.")
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not parse routine") } finally { setBusy(false) }
  }

  const triggerFields = useMemo(() => {
    if (triggerType === "time_of_day") return <div className="grid grid-cols-2 gap-2"><input className={fieldClass()} type="number" min={0} max={23} value={Number(trigger.hour || 0)} onChange={(e) => setTrigger({ ...trigger, hour: Number(e.target.value) })} placeholder="Hour" /><input className={fieldClass()} type="number" min={0} max={59} value={Number(trigger.minute || 0)} onChange={(e) => setTrigger({ ...trigger, minute: Number(e.target.value) })} placeholder="Minute" /></div>
    if (triggerType === "game_launch") return <input className={fieldClass()} value={String(trigger.gameName || "")} onChange={(e) => setTrigger({ gameName: e.target.value })} placeholder="Game name, e.g. GTA" />
    if (triggerType === "message_contains") return <div className="grid grid-cols-[1fr_130px] gap-2"><input className={fieldClass()} value={Array.isArray(trigger.words) ? String(trigger.words[0] || "") : ""} onChange={(e) => setTrigger({ ...trigger, words: [e.target.value] })} placeholder="Word or phrase" /><select className={fieldClass()} value={String(trigger.direction || "any")} onChange={(e) => setTrigger({ ...trigger, direction: e.target.value })}><option value="any">Any</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option></select></div>
    if (triggerType === "friend_online") return <input className={fieldClass()} value={String(trigger.username || "")} onChange={(e) => setTrigger({ username: e.target.value.replace(/^@/, "") })} placeholder="Friend username" />
    if (triggerType === "credits_at_least") return <input className={fieldClass()} type="number" min={0} value={Number(trigger.amount || 0)} onChange={(e) => setTrigger({ amount: Number(e.target.value) })} />
    return <select className={fieldClass()} value={String(trigger.panel || "games")} onChange={(e) => setTrigger({ panel: e.target.value })}>{["browser","games","chat","friends","spaces","movies","synnime","music","shop","market","drive","profile","settings","linux-vm"].map((p) => <option key={p}>{p}</option>)}</select>
  }, [trigger, triggerType])

  const actionFields = useMemo(() => {
    if (actionType === "set_presence") return <div className="grid gap-2 md:grid-cols-3"><select className={fieldClass()} value={String(ruleAction.mode || "online")} onChange={(e) => setRuleAction({ ...ruleAction, mode: e.target.value })}>{["online","available_to_play","looking_to_talk","do_not_invite","free_15","busy"].map((x) => <option key={x}>{x}</option>)}</select><input className={fieldClass()} value={String(ruleAction.status || "")} onChange={(e) => setRuleAction({ ...ruleAction, status: e.target.value })} placeholder="Optional profile status" /><input className={fieldClass()} type="number" min={0} max={1440} value={Number(ruleAction.durationMinutes || 0)} onChange={(e) => setRuleAction({ ...ruleAction, durationMinutes: Number(e.target.value) })} placeholder="Minutes" /></div>
    if (actionType === "open_panel") return <select className={fieldClass()} value={String(ruleAction.panel || "chat")} onChange={(e) => setRuleAction({ panel: e.target.value })}>{["browser","games","chat","friends","spaces","movies","synnime","music","shop","market","drive","profile","settings","linux-vm"].map((p) => <option key={p}>{p}</option>)}</select>
    if (actionType === "mute_music") return <select className={fieldClass()} value={ruleAction.mute === false ? "false" : "true"} onChange={(e) => setRuleAction({ mute: e.target.value === "true" })}><option value="true">Mute</option><option value="false">Unmute</option></select>
    if (actionType === "set_theme") return <select className={fieldClass()} value={String(ruleAction.theme || "blood")} onChange={(e) => setRuleAction({ theme: e.target.value })}>{["blood","synnical","ocean","forest","sunset","midnight","lavender","cyberpunk","monochrome","amber"].map((p) => <option key={p}>{p}</option>)}</select>
    if (actionType === "set_setting") return <div className="grid grid-cols-[1fr_130px] gap-2"><select className={fieldClass()} value={String(ruleAction.key || "perf.autoScale")} onChange={(e) => setRuleAction({ ...ruleAction, key: e.target.value })}><option value="perf.autoScale">Auto performance scaling</option><option value="a11y.reduceMotion">Reduced motion</option><option value="a11y.simplifiedUi">Simplified UI</option><option value="layout.sidebarCollapsed">Collapsed sidebar</option></select><select className={fieldClass()} value={ruleAction.value === false ? "false" : "true"} onChange={(e) => setRuleAction({ ...ruleAction, value: e.target.value === "true" })}><option value="true">On</option><option value="false">Off</option></select></div>
    return <div className="grid gap-2 md:grid-cols-2"><input className={fieldClass()} value={String(ruleAction.title || "")} onChange={(e) => setRuleAction({ ...ruleAction, title: e.target.value })} placeholder="Notification title" /><input className={fieldClass()} value={String(ruleAction.body || "")} onChange={(e) => setRuleAction({ ...ruleAction, body: e.target.value })} placeholder="Message" /></div>
  }, [actionType, ruleAction])

  return <div className="h-full overflow-y-auto bg-black p-4 text-white md:p-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-black"><WandSparkles className="h-5 w-5" /></div><div><h1 className="text-2xl font-semibold">Automations</h1><p className="text-sm text-white/45">Build routines, preview what they can touch, and kill everything instantly if a rule gets annoying.</p></div><button onClick={async () => { const next = !data?.killSwitch; await api({ action: "kill-switch", enabled: next }); await load() }} className={`ml-auto rounded-xl border px-4 py-2 text-sm ${data?.killSwitch ? "border-red-500/40 bg-red-500/15 text-red-300" : "border-white/10 bg-white/5"}`}><Power className="mr-2 inline h-4 w-4" />{data?.killSwitch ? "Automations disabled" : "Kill switch"}</button></div>

      <section className="rounded-2xl border border-white/10 bg-[#070707] p-4"><div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4" /><h2 className="font-medium">Natural-language builder</h2></div><div className="flex gap-2"><input className={fieldClass()} value={natural} onChange={(e) => setNatural(e.target.value)} placeholder='e.g. "when I launch GTA, mute music"' /><button onClick={() => void parseNatural()} disabled={busy} className="rounded-xl bg-white px-4 text-sm font-medium text-black disabled:opacity-40">Build</button></div><p className="mt-2 text-xs text-white/35">It builds a preview first. Nothing is saved until you confirm it below.</p></section>

      <section className="rounded-2xl border border-white/10 bg-[#070707] p-4 space-y-3"><input className={fieldClass()} value={name} onChange={(e) => setName(e.target.value)} placeholder="Routine name" /><div className="grid gap-3 md:grid-cols-2"><div><p className="mb-1 text-xs text-white/40">WHEN</p><select className={fieldClass()} value={triggerType} onChange={(e) => resetTrigger(e.target.value)}>{TRIGGERS.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select><div className="mt-2">{triggerFields}</div></div><div><p className="mb-1 text-xs text-white/40">THEN</p><select className={fieldClass()} value={actionType} onChange={(e) => resetAction(e.target.value)}>{ACTIONS.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select><div className="mt-2">{actionFields}</div></div></div><div className="flex justify-end"><button onClick={() => void save()} disabled={busy} className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">Save routine</button></div></section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><section className="rounded-2xl border border-white/10 bg-[#070707] p-4"><div className="mb-3 flex items-center gap-2"><Bot className="h-4 w-4" /><h2 className="font-medium">Your routines</h2></div><div className="space-y-2">{data?.rules?.length ? data.rules.map((rule:any) => <div key={rule.id} className="rounded-xl border border-white/10 bg-black p-3"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="font-medium">{rule.name}</p><p className="mt-1 text-xs text-white/40">{rule.triggerType.replaceAll("_"," ")} → {rule.actionType.replaceAll("_"," ")}</p><p className="mt-1 text-[11px] text-white/25">Last run: {rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString() : "Never"}</p></div><button onClick={async()=>{await api({action:"toggle-rule",id:rule.id,enabled:!rule.enabled});await load()}} className={`rounded-lg px-2 py-1 text-xs ${rule.enabled?"bg-emerald-500/15 text-emerald-300":"bg-white/5 text-white/40"}`}>{rule.enabled?"On":"Off"}</button><button title="Share with friends" onClick={async()=>{await api({action:"share-template",id:rule.id});toast.success("Template shared with friends");await load()}} className="rounded-lg p-1.5 text-white/50 hover:bg-white/10"><Share2 className="h-4 w-4" /></button><button title="Delete" onClick={async()=>{await api({action:"delete-rule",id:rule.id});await load()}} className="rounded-lg p-1.5 text-red-300/70 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></button></div></div>) : <p className="text-sm text-white/35">No routines yet.</p>}</div></section>

      <section className="rounded-2xl border border-white/10 bg-[#070707] p-4"><div className="mb-3 flex items-center gap-2"><History className="h-4 w-4" /><h2 className="font-medium">Execution history</h2></div><div className="space-y-2">{data?.runs?.slice(0,20).map((run:any) => <div key={run.id} className="rounded-xl border border-white/10 bg-black p-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${run.status==="success"?"bg-emerald-400":run.status==="failed"?"bg-red-400":"bg-amber-400"}`} /><p className="min-w-0 flex-1 truncate text-sm">{run.summary || run.actionType}</p>{run.status === "success" && <button title="Undo" onClick={async()=>{try{await api({action:"undo",id:run.id});toast.success("Undo queued");await load()}catch(e){toast.error(e instanceof Error?e.message:"Could not undo")}}} className="p-1 text-white/45 hover:text-white"><Undo2 className="h-3.5 w-3.5" /></button>}</div><p className="mt-1 text-[11px] text-white/25">{new Date(run.createdAt).toLocaleString()} · {run.status}</p></div>)}</div></section></div>

      {data?.templates?.length > 0 && <section className="rounded-2xl border border-white/10 bg-[#070707] p-4"><h2 className="mb-3 font-medium">Friends' routine templates</h2><div className="grid gap-2 md:grid-cols-2">{data.templates.map((template:any)=><div key={template.id} className="rounded-xl border border-white/10 bg-black p-3"><p className="font-medium">{template.title}</p><p className="text-xs text-white/35">by @{template.author?.username || "friend"}</p><button onClick={async()=>{await api({action:"import-template",id:template.id});toast.success("Template imported");await load()}} className="mt-3 rounded-lg bg-white px-3 py-1.5 text-xs text-black"><Play className="mr-1 inline h-3 w-3" />Import</button></div>)}</div></section>}
    </div>
  </div>
}
