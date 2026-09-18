"use client"
import { useEffect, useState } from "react"
import type { SafeUser } from "@/lib/api"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { RECOGNITION_TAGS } from "@/lib/recognition-tags"
import { RoleBadge } from "./role-ui"
type Infraction = { id: string; type: string; reason: string; duration: number | null; createdAt: string; issuer?: { username: string } }
export function UserManagementDetails({ actor, target, onClose, onChanged }: { actor: SafeUser; target: SafeUser | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const [history, setHistory] = useState<Infraction[]>([])
  const [action, setAction] = useState("WARN")
  const [reason, setReason] = useState("")
  const [minutes, setMinutes] = useState("15")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [role, setRole] = useState("MEMBER")
  const [tag, setTag] = useState<string>(RECOGNITION_TAGS[0])
  useEffect(() => {
    if (!target) return
    const controller = new AbortController()
    void fetch(`/api/infractions/user/${encodeURIComponent(target.id)}`, { signal: controller.signal, cache: "no-store" }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "History unavailable"); setHistory(body.infractions) }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [target])
  const submit = async (route: string, payload: Record<string, unknown>) => {
    if (!target) return
    setBusy(true); setError("")
    try {
      const response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target.id, ...payload }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Action failed")
      await onChanged(); onClose()
    } catch (error) { setError(error instanceof Error ? error.message : "Action failed") } finally { setBusy(false) }
  }
  return <Dialog open={Boolean(target)} onOpenChange={open => { if (!open) onClose() }}><DialogContent className="max-h-[85dvh] overflow-y-auto bg-[var(--synnical-surface)] text-[var(--synnical-text)]"><DialogHeader><DialogTitle>@{target?.username} · Account details</DialogTitle></DialogHeader>{target && <><p className="break-all text-xs">ID: {target.id}</p><RoleBadge role={target.role} tags={target.tags} /><p className="text-sm">{target.banned ? "Banned" : target.muted ? `Muted ${target.mutedUntil ? `until ${new Date(target.mutedUntil).toLocaleString()}` : "indefinitely"}` : "Active"} · {history.filter(row => row.type === "WARN").length} warnings</p><form className="grid gap-3" onSubmit={event => { event.preventDefault(); if (!confirm(`${action} @${target.username}? Reason: ${reason}`)) return; void submit(action === "UNMUTE" || action === "UNBAN" ? `/api/moderation/${action.toLowerCase()}` : "/api/infractions/create", { type: action, reason, ...(action === "MUTE" ? { durationMin: Number(minutes) } : {}) }) }}><label>Action<select className="ml-3 rounded border bg-[var(--synnical-surface-2)] p-2" value={action} onChange={e => setAction(e.target.value)}>{["WARN","MUTE","UNMUTE","BAN","UNBAN"].map(value => <option key={value}>{value}</option>)}</select></label>{action === "MUTE" && <label>Minutes<input aria-label="Mute duration in minutes" type="number" min="1" max="525600" required value={minutes} onChange={e => setMinutes(e.target.value)} className="ml-3 rounded border bg-[var(--synnical-surface-2)] p-2" /></label>}<label>Reason<input aria-label="Moderation reason" required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded border bg-[var(--synnical-surface-2)] p-2" /></label><button disabled={busy} className="rounded border border-red-500 p-2 disabled:opacity-40">Review & confirm action</button></form>{["OWNER","HEAD_ADMIN","ADMIN"].includes(actor.role) && <section className="space-y-2 border-t pt-3"><label>Staff role<select className="ml-2 bg-[var(--synnical-surface-2)] p-2" value={role} onChange={e => setRole(e.target.value)}>{["MEMBER","MOD", ...(actor.role === "OWNER" || actor.role === "HEAD_ADMIN" ? ["ADMIN"] : [])].map(value => <option key={value}>{value}</option>)}</select></label><button disabled={busy} className="ml-2 underline" onClick={() => { if (confirm(`Change @${target.username} to ${role}?`)) void submit("/api/roles/assign", { role }) }}>Assign</button></section>}{actor.role === "OWNER" && <div><label>Community badge<select className="ml-2 bg-[var(--synnical-surface-2)] p-2" value={tag} onChange={e => setTag(e.target.value)}>{RECOGNITION_TAGS.map(value => <option key={value}>{value}</option>)}</select></label><button disabled={busy} className="ml-2 underline" onClick={() => void submit("/api/roles/assign", { tag, action: target.tags.includes(tag) ? "removeTag" : "addTag" })}>{target.tags.includes(tag) ? "Remove" : "Add"}</button></div>}<h3 className="font-semibold">Moderation history</h3>{history.length === 0 ? <p>No infractions recorded.</p> : history.map(row => <article key={row.id} className="rounded border border-[var(--synnical-border)] p-3 text-sm"><strong>{row.type}</strong><p>{row.reason}</p><p className="text-xs text-[var(--synnical-muted)]">{new Date(row.createdAt).toLocaleString()} · @{row.issuer?.username || "deleted staff"}{row.duration !== null ? ` · ${row.duration} min` : ""}</p></article>)}</>}{error && <p role="alert" className="text-red-500">{error}</p>}</DialogContent></Dialog>
}
