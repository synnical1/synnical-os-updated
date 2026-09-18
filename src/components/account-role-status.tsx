"use client"
import { useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { RoleBadge } from "./role-ui"
import { api } from "@/lib/api"
export function AccountRoleStatus() {
  const { user, refresh } = useAuth()
  const [secret, setSecret] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  if (!user) return null
  return <section className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><h2 className="mb-3 font-semibold">Roles & account status</h2><RoleBadge role={user.role} tags={user.tags} /><p className="mt-2 text-sm">{user.role === "MEMBER" ? "Member" : user.role} · {user.muted ? "Muted" : "Active"}</p>{user.role !== "OWNER" && <form className="mt-4 flex flex-wrap gap-2" id="owner-verification" autoComplete="off" onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage(""); try { await api.verifyOwner(secret); setSecret(""); await refresh(); setMessage("Owner verified") } catch (error) { setMessage(error instanceof Error ? error.message : "Verification failed") } finally { setBusy(false) } }}><label className="w-full text-xs" htmlFor="owner-verification-secret">Owner verification secret</label><input id="owner-verification-secret" name="owner-verification-secret" type="password" autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)} className="min-w-0 rounded border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-2" /><button disabled={busy || !secret} className="rounded border p-2 disabled:opacity-40">{busy ? "Verifying…" : "Verify owner"}</button><p className="w-full text-xs text-[var(--synnical-muted)]">Requires the secret configured by the server administrator. Community badges do not grant staff permissions.</p></form>}{message && <p role="status" className="mt-2 text-sm">{message}</p>}</section>
}
