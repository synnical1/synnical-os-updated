"use client"

import { useCallback, useEffect, useState } from "react"
import { FlaskConical, Bug, ThumbsUp, ThumbsDown, RotateCcw, Plus, Users, UserMinus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"

async function request(init?: RequestInit) {
  const res = await fetch("/api/features/lab", { credentials: "include", headers: { "Content-Type": "application/json" }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Lab request failed")
  return data
}

export function SynnicalLabPanel() {
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [rollout, setRollout] = useState(0)
  const [labOnly, setLabOnly] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [enrollNames, setEnrollNames] = useState<Record<string, string>>({})
  const [bugText, setBugText] = useState<Record<string, string>>({})

  const load = useCallback(async () => { try { setData(await request()) } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load Synnical Lab") } }, [])
  useEffect(() => { void load() }, [load])
  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    try { await request({ method: "POST", body: JSON.stringify(body) }); await load() }
    catch (error) { toast.error(error instanceof Error ? error.message : "Lab action failed") }
    finally { setBusy(false) }
  }

  if (!data) return <div className="h-full grid place-items-center bg-black text-[var(--synnical-muted)]">Loading Synnical Lab…</div>
  if (!data.admin && !data.eligible) return <div className="h-full grid place-items-center bg-black"><div className="max-w-md text-center"><FlaskConical className="h-10 w-10 mx-auto text-[var(--synnical-accent)]" /><h2 className="mt-3 text-xl font-semibold">Synnical Lab</h2><p className="mt-2 text-sm text-[var(--synnical-muted)]">No experiments are assigned to this account right now. Lab stays hidden unless you are selected for a test.</p></div></div>

  return <div className="h-full overflow-y-auto bg-black p-5 custom-scroll"><div className="mx-auto max-w-5xl space-y-5">
    <div className="flex items-start gap-3"><div className="rounded-xl border border-[var(--synnical-border)] bg-[#0b0b0b] p-2"><FlaskConical className="h-6 w-6 text-[var(--synnical-accent)]" /></div><div><h1 className="text-2xl font-bold">Synnical Lab</h1><p className="text-sm text-[var(--synnical-muted)]">Try unfinished features without contaminating the stable experience. Experiments can be disabled independently of the whole build.</p></div></div>

    {data.admin ? <>
      <div className="rounded-xl border border-[var(--synnical-border)] bg-[#070707] p-4"><h2 className="font-semibold">Create or update a feature flag</h2><p className="mt-1 text-xs text-[var(--synnical-muted)]">Lab-only flags require explicit enrollment. Production flags can use a stable percentage rollout so the same account stays in the same bucket.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><div><Label>Key</Label><Input value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} placeholder="new-profile-cards" className="mt-1 bg-black" /></div><div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New profile cards" className="mt-1 bg-black" /></div><div className="sm:col-span-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 bg-black" placeholder="What is being tested and what should testers look for?" /></div><div><Label>Rollout percentage</Label><Input type="number" min={0} max={100} value={rollout} onChange={(e) => setRollout(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="mt-1 bg-black" /></div><div className="flex items-center gap-6 pt-6"><label className="flex items-center gap-2 text-sm"><Switch checked={labOnly} onCheckedChange={setLabOnly} />Lab only</label><label className="flex items-center gap-2 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} />Enabled</label></div></div><Button className="mt-4" disabled={busy || !key || !name} onClick={() => void post({ action: "upsert-flag", key, name, description, rolloutPercent: rollout, labOnly, enabled })}><Plus className="h-4 w-4 mr-1" />Save feature flag</Button></div>
      <div className="space-y-3">{(data.flags || []).length === 0 ? <div className="rounded-xl border border-dashed border-[var(--synnical-border)] p-8 text-center text-sm text-[var(--synnical-muted)]">No flags yet. Create the first experiment above.</div> : data.flags.map((flag: any) => <div key={flag.key} className="rounded-xl border border-[var(--synnical-border)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{flag.name}</h3><code className="rounded bg-white/5 px-1.5 py-0.5 text-[10px]">{flag.key}</code></div><p className="mt-1 text-xs text-[var(--synnical-muted)]">{flag.description || "No description"}</p><p className="mt-1 text-[11px] text-[var(--synnical-muted)]">{flag.enabled ? "Enabled" : "Disabled"} · {flag.labOnly ? "Lab only" : `${flag.rolloutPercent}% rollout`} · {(flag.enrollments || []).filter((row: any) => row.enabled && !row.optedOut).length} selected tester(s)</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void post({ action: "upsert-flag", key: flag.key, name: flag.name, description: flag.description, rolloutPercent: flag.rolloutPercent, labOnly: flag.labOnly, enabled: !flag.enabled })}>{flag.enabled ? "Disable instantly" : "Enable"}</Button></div><div className="mt-3 flex gap-2"><Input value={enrollNames[flag.key] || ""} onChange={(e) => setEnrollNames((current) => ({ ...current, [flag.key]: e.target.value }))} placeholder="Username to add" className="max-w-xs bg-black" /><Button size="sm" disabled={busy || !enrollNames[flag.key]?.trim()} onClick={() => void post({ action: "enroll-user", key: flag.key, username: enrollNames[flag.key] })}><Users className="h-4 w-4 mr-1" />Select tester</Button></div>{(flag.enrollments || []).length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{flag.enrollments.map((row: any) => <span key={row.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--synnical-border)] pl-2 pr-1 py-1 text-[11px]">@{row.user?.username || row.userId}{row.optedOut ? " · opted out" : ""}<button type="button" className="rounded p-0.5 text-[var(--synnical-muted)] hover:text-red-300" title="Remove tester" aria-label={`Remove @${row.user?.username || row.userId} from ${flag.name}`} disabled={busy} onClick={() => void post({ action: "remove-enrollment", key: flag.key, userId: row.user?.id || row.userId })}><UserMinus className="h-3 w-3" /></button></span>)}</div>}{(flag.feedback || []).length > 0 && <div className="mt-3 border-t border-[var(--synnical-border)] pt-3"><p className="text-xs font-semibold">Latest feedback</p>{flag.feedback.slice(0, 5).map((item: any) => <p key={item.id} className="mt-1 text-xs text-[var(--synnical-muted)]"><span className="text-[var(--synnical-text)]">@{item.user?.username}</span> · {item.kind}{item.message ? ` · ${item.message}` : ""}</p>)}</div>}</div>)}</div>
    </> : <div className="space-y-4">{(data.experiments || []).filter((row: any) => row.active).map((row: any) => <div key={row.flag.key} className="rounded-xl border border-[var(--synnical-border)] bg-[#070707] p-5"><h2 className="text-lg font-semibold">{row.flag.name}</h2><p className="mt-1 text-sm text-[var(--synnical-muted)]">{row.flag.description}</p><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void post({ action: "feedback", key: row.flag.key, kind: "ship" })}><ThumbsUp className="h-4 w-4 mr-1" />Ship it</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void post({ action: "feedback", key: row.flag.key, kind: "needs_work" })}><ThumbsDown className="h-4 w-4 mr-1" />Needs work</Button><Button size="sm" variant="destructive" disabled={busy} onClick={() => void post({ action: "opt-out", key: row.flag.key })}><RotateCcw className="h-4 w-4 mr-1" />Return to stable</Button></div><div className="mt-4 flex gap-2"><Input value={bugText[row.flag.key] || ""} onChange={(e) => setBugText((current) => ({ ...current, [row.flag.key]: e.target.value }))} placeholder="Describe a problem in this experiment" className="bg-black" /><Button size="sm" variant="outline" disabled={busy || (bugText[row.flag.key] || "").trim().length < 3} onClick={() => void post({ action: "feedback", key: row.flag.key, kind: "bug", message: bugText[row.flag.key] })}><Bug className="h-4 w-4 mr-1" />Report</Button></div></div>)}</div>}
  </div></div>
}
