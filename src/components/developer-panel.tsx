"use client"

import { useCallback, useEffect, useState } from "react"
import { Code2, Copy, KeyRound, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

type TokenRow = { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt?: string | null; revokedAt?: string | null; createdAt: string }
type State = { tokens: TokenRow[]; scopes: string[]; newToken?: string }

const fetchJson = async (init?: RequestInit) => {
  const response = await fetch("/api/features/developer", { credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, ...init })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || "Developer request failed")
  return data as State
}

export function DeveloperPanel() {
  const [state, setState] = useState<State | null>(null)
  const [name, setName] = useState("My integration")
  const [password, setPassword] = useState("")
  const [scopes, setScopes] = useState<string[]>(["read:profile"])
  const [rawToken, setRawToken] = useState("")
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { setState(await fetchJson()) } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load developer tools") } }, [])
  useEffect(() => { void load() }, [load])

  const mutate = async (body: Record<string, unknown>) => {
    if (!password) return toast.error("Enter your account password first")
    setBusy(true)
    try {
      const next = await fetchJson({ method: "POST", body: JSON.stringify({ ...body, password }) })
      setState(next); setPassword("")
      if (next.newToken) setRawToken(next.newToken)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Developer action failed") }
    finally { setBusy(false) }
  }

  return <div className="h-full overflow-y-auto bg-black custom-scroll p-4 sm:p-6">
    <div className="mx-auto max-w-5xl space-y-5">
      <div><div className="flex items-center gap-2"><Code2 className="h-5 w-5 text-[var(--synnical-accent)]" /><h1 className="text-xl font-semibold">Developer</h1></div><p className="mt-1 text-sm text-[var(--synnical-muted)]">Create scoped, read-only API tokens for your own Synnical account. Raw tokens are shown once and are never stored in plaintext.</p></div>

      <section className="rounded-xl border border-[var(--synnical-border)] p-4 space-y-4">
        <div><h2 className="font-semibold">Create API token</h2><p className="text-xs text-[var(--synnical-muted)]">Tokens can only read the permissions you explicitly choose. Password confirmation is required.</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" /></div><div><Label>Current password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" autoComplete="current-password" /></div></div>
        <div className="flex flex-wrap gap-4">{(state?.scopes || ["read:profile", "read:friends", "read:games"]).map((scope) => <label key={scope} className="flex items-center gap-2 text-sm"><Checkbox checked={scopes.includes(scope)} onCheckedChange={(checked) => setScopes((current) => checked ? [...new Set([...current, scope])] : current.filter((item) => item !== scope))} />{scope}</label>)}</div>
        <Button disabled={busy || !name.trim() || scopes.length === 0} onClick={() => void mutate({ action: "create", name, scopes })}><KeyRound className="h-4 w-4" />Create token</Button>
        {rawToken && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><p className="text-xs text-amber-200">Copy this token now. Synnical will not show it again.</p><div className="mt-2 flex gap-2"><Input readOnly value={rawToken} className="font-mono text-xs" /><Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(rawToken); toast.success("Token copied") }}><Copy className="h-4 w-4" /></Button></div></div>}
      </section>

      <section className="rounded-xl border border-[var(--synnical-border)] p-4">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">Your tokens</h2><p className="text-xs text-[var(--synnical-muted)]">Use <code>Authorization: Bearer YOUR_TOKEN</code> against the v1 endpoints.</p></div><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button></div>
        <div className="mt-3 space-y-2">{!state?.tokens.length ? <p className="text-sm text-[var(--synnical-muted)]">No API tokens yet.</p> : state.tokens.map((token) => <div key={token.id} className="rounded-lg border border-[var(--synnical-border)] p-3 flex flex-col gap-2 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{token.name}{token.revokedAt ? " · Revoked" : ""}</p><p className="text-[11px] text-[var(--synnical-muted)]">Prefix {token.prefix} · {token.scopes.join(", ")} · Created {new Date(token.createdAt).toLocaleDateString()}{token.lastUsedAt ? ` · Last used ${new Date(token.lastUsedAt).toLocaleString()}` : ""}</p></div>{!token.revokedAt && <Button size="sm" variant="destructive" disabled={busy} onClick={() => void mutate({ action: "revoke", id: token.id })}><Trash2 className="h-4 w-4" />Revoke</Button>}</div>)}</div>
      </section>

      <section className="rounded-xl border border-[var(--synnical-border)] p-4"><h2 className="font-semibold">v1 endpoints</h2><div className="mt-2 space-y-1 font-mono text-xs text-[var(--synnical-muted)]"><p>GET /api/developer/v1/me</p><p>GET /api/developer/v1/friends</p><p>GET /api/developer/v1/games</p></div><p className="mt-3 text-xs text-[var(--synnical-muted)]">This first API surface is intentionally read-only. Write access and bots should get separate permission/audit rules instead of inheriting god-mode from a generic token.</p></section>
    </div>
  </div>
}
