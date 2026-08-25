"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Shield, ShieldAlert, RefreshCw, Download, KeyRound, Monitor, Eye, Users, Lock, Copy, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"

const fetchJson = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers || {}) }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Request failed")
  return data
}

const CAPABILITIES = [
  ["profile", "Profile"], ["activity", "Activity details"],
  ["connections", "Connections"], ["birthday", "Birthday"], ["pronouns", "Pronouns"],
  ["game", "Game activity"], ["music", "Music activity"], ["stats", "Profile statistics"],
] as const
const AUDIENCE_LABELS: Record<string, string> = { everyone: "Everyone", friends: "Friends", close_friends: "Close Friends", nobody: "Nobody" }

type PrivacyState = {
  config: Record<string, string>
  friends: Array<{ id: string; username: string; displayName: string; closeFriend: boolean; rule?: Record<string, unknown> | null }>
}

export function R7PrivacyControls() {
  const [state, setState] = useState<PrivacyState | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState("")
  const [friendPreset, setFriendPreset] = useState("standard")
  const [friendOverrides, setFriendOverrides] = useState<Record<string, "inherit" | "show" | "hide">>({})
  const [preview, setPreview] = useState<Record<string, boolean> | null>(null)

  const load = useCallback(async () => {
    try { setState(await fetchJson("/api/features/privacy")) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load privacy settings") }
  }, [])
  useEffect(() => { void load() }, [load])

  const selected = useMemo(() => state?.friends.find((friend) => friend.id === selectedId) || null, [state, selectedId])
  useEffect(() => {
    const preset = typeof selected?.rule?.preset === "string" ? selected.rule.preset : "standard"
    setFriendPreset(preset)
    const next: Record<string, "inherit" | "show" | "hide"> = {}
    for (const [key] of CAPABILITIES) {
      const field = `share${key[0].toUpperCase()}${key.slice(1)}`
      const value = selected?.rule?.[field]
      next[key] = value === true ? "show" : value === false ? "hide" : "inherit"
    }
    setFriendOverrides(next)
    setPreview(null)
  }, [selected])

  const saveConfig = async () => {
    if (!state) return
    setBusy(true)
    try {
      const result = await fetchJson("/api/features/privacy", { method: "POST", body: JSON.stringify({ action: "save-config", config: state.config }) })
      setState((current) => current ? { ...current, config: result.config } : current)
      toast.success("Privacy defaults saved")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save privacy settings") }
    finally { setBusy(false) }
  }

  const applyPreset = (preset: string) => {
    if (!state) return
    const values: Record<string, string> = preset === "everyone"
      ? Object.fromEntries(CAPABILITIES.map(([key]) => [key, "everyone"]))
      : preset === "friends"
        ? { profile: "everyone", activity: "friends", connections: "friends", birthday: "friends", pronouns: "friends", game: "friends", music: "friends", stats: "friends" }
        : preset === "close_friends"
          ? { profile: "everyone", activity: "close_friends", connections: "close_friends", birthday: "close_friends", pronouns: "close_friends", game: "close_friends", music: "close_friends", stats: "close_friends" }
          : { profile: "nobody", activity: "nobody", connections: "nobody", birthday: "nobody", pronouns: "nobody", game: "nobody", music: "nobody", stats: "nobody" }
    setState({ ...state, config: { preset, ...values } })
  }

  const saveFriendRule = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      const custom = friendPreset === "custom" ? Object.fromEntries(CAPABILITIES.map(([key]) => {
        const value = friendOverrides[key] || "inherit"
        const field = `share${key[0].toUpperCase()}${key.slice(1)}`
        return [field, value === "inherit" ? null : value === "show"]
      })) : {}
      const result = await fetchJson("/api/features/privacy", { method: "POST", body: JSON.stringify({ action: "set-rule", viewerId: selectedId, preset: friendPreset, ...custom }) })
      setPreview(result.view)
      await load()
      toast.success("Per-friend privacy rule saved")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save friend rule") }
    finally { setBusy(false) }
  }

  const resetFriendRule = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      const result = await fetchJson("/api/features/privacy", { method: "POST", body: JSON.stringify({ action: "delete-rule", viewerId: selectedId }) })
      setPreview(result.view)
      await load()
      toast.success("Friend now inherits your default privacy")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not reset friend rule") }
    finally { setBusy(false) }
  }

  const previewSaved = async () => {
    if (!selectedId) return
    try { setPreview((await fetchJson(`/api/features/privacy?viewerId=${encodeURIComponent(selectedId)}`)).view) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not preview privacy") }
  }

  if (!state) return <div className="rounded-xl border border-[var(--synnical-border)] p-4 text-sm text-[var(--synnical-muted)]">Loading account privacy…</div>

  return (
    <div className="space-y-5 mb-6">
      <div className="rounded-xl border border-[var(--synnical-border)] bg-[#070707] p-4">
        <div className="flex items-start gap-3"><Lock className="h-5 w-5 text-[var(--synnical-accent)] mt-0.5" /><div><h3 className="font-semibold">Account privacy defaults</h3><p className="text-xs text-[var(--synnical-muted)] mt-1">These rules are enforced by the server for profile and activity details. Your real online/offline state is always shown when you are signed in.</p></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
          <div><Label>Preset</Label><Select value={state.config.preset || "friends"} onValueChange={applyPreset}><SelectTrigger className="mt-1 bg-black"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="everyone">Everyone</SelectItem><SelectItem value="friends">Friends</SelectItem><SelectItem value="close_friends">Close Friends</SelectItem><SelectItem value="private">Private</SelectItem></SelectContent></Select></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {CAPABILITIES.map(([key, label]) => <div key={key}><Label className="text-[11px]">{label}</Label><Select value={state.config[key] || "friends"} onValueChange={(value) => setState({ ...state, config: { ...state.config, preset: "friends", [key]: value } })}><SelectTrigger className="mt-1 h-8 bg-black text-xs"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(AUDIENCE_LABELS).map(([value, text]) => <SelectItem value={value} key={value}>{text}</SelectItem>)}</SelectContent></Select></div>)}
          </div>
        </div>
        <div className="mt-4 flex justify-end"><Button onClick={() => void saveConfig()} disabled={busy}>Save privacy defaults</Button></div>
      </div>

      <div className="rounded-xl border border-[var(--synnical-border)] p-4">
        <div className="flex items-start gap-3"><Users className="h-5 w-5 text-[var(--synnical-accent)] mt-0.5" /><div><h3 className="font-semibold">Per-friend privacy & “View as”</h3><p className="text-xs text-[var(--synnical-muted)] mt-1">Override your defaults for one friend, then simulate exactly what Synnical will allow that account to see.</p></div></div>
        {state.friends.length === 0 ? <p className="mt-4 text-sm text-[var(--synnical-muted)]">Add a friend first to create a per-friend rule.</p> : <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><Label>Friend</Label><Select value={selectedId} onValueChange={setSelectedId}><SelectTrigger className="mt-1 bg-black"><SelectValue placeholder="Choose a friend" /></SelectTrigger><SelectContent>{state.friends.map((friend) => <SelectItem key={friend.id} value={friend.id}>{friend.displayName} (@{friend.username}){friend.closeFriend ? " · Close Friend" : ""}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Override preset</Label><Select value={friendPreset} onValueChange={setFriendPreset} disabled={!selectedId}><SelectTrigger className="mt-1 bg-black"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="allow_all">Allow all</SelectItem><SelectItem value="standard">Standard friend</SelectItem><SelectItem value="limited">Limited</SelectItem><SelectItem value="hidden">Hidden</SelectItem><SelectItem value="custom">Custom</SelectItem></SelectContent></Select></div>
          </div>
          {selectedId && friendPreset === "custom" && <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 rounded-lg border border-[var(--synnical-border)] p-3"><p className="sm:col-span-2 lg:col-span-3 text-xs text-[var(--synnical-muted)]">Custom rules can inherit your account default or explicitly show/hide one category for this friend.</p>{CAPABILITIES.map(([key, label]) => <div key={key}><Label className="text-[11px]">{label}</Label><Select value={friendOverrides[key] || "inherit"} onValueChange={(value) => setFriendOverrides((current) => ({ ...current, [key]: value as "inherit" | "show" | "hide" }))}><SelectTrigger className="mt-1 h-8 bg-black text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">Use account default</SelectItem><SelectItem value="show">Always show</SelectItem><SelectItem value="hide">Always hide</SelectItem></SelectContent></Select></div>)}</div>}
          <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={!selectedId || busy} onClick={() => void saveFriendRule()}>Save override</Button><Button size="sm" variant="outline" disabled={!selectedId || busy} onClick={() => void previewSaved()}><Eye className="h-4 w-4 mr-1" />What can they see?</Button><Button size="sm" variant="ghost" disabled={!selectedId || busy} onClick={() => void resetFriendRule()}><Trash2 className="h-4 w-4 mr-1" />Use defaults</Button></div>
          {preview && selected && <div className="mt-4 rounded-lg border border-[var(--synnical-border)] bg-black/40 p-3"><p className="text-xs font-semibold">Viewing your account as {selected.displayName}</p><div className="mt-2 flex flex-wrap gap-1.5">{CAPABILITIES.map(([key, label]) => <span key={key} className={`rounded-full border px-2 py-1 text-[11px] ${preview[key] ? "border-emerald-500/30 text-emerald-300" : "border-red-500/30 text-red-300"}`}>{label}: {preview[key] ? "Visible" : "Hidden"}</span>)}</div></div>}
        </>}
      </div>
    </div>
  )
}

type SecurityState = {
  currentSessionId: string
  lockdown: boolean
  score: number
  checklist: Array<{ id: string; label: string; complete: boolean }>
  sessions: Array<{ id: string; deviceName: string; userAgent: string; lastSeenAt: string; createdAt: string; current: boolean; trusted: boolean; trustMode: "none" | "temporary" | "permanent"; trustedUntil?: string | null }>
  trustedSessions: number
  recovery: { remaining: number; total: number; used: Array<{ id: string; usedAt: string }> }
  events: Array<{ id: string; type: string; message: string; createdAt: string }>
  newRecoveryCodes?: string[]
}


export function R7DevicesControls() {
  const [state, setState] = useState<SecurityState | null>(null)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { setState(await fetchJson("/api/features/security")) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load signed-in devices") }
  }, [])
  useEffect(() => { void load() }, [load])

  const rename = async (sessionId: string, currentName: string) => {
    const deviceName = window.prompt("Name this signed-in device", currentName)
    if (!deviceName?.trim()) return
    try { setState(await fetchJson("/api/features/security", { method: "POST", body: JSON.stringify({ action: "rename-session", sessionId, deviceName }) })) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Rename failed") }
  }

  const revoke = async (sessionId?: string) => {
    if (!password) { toast.error("Enter your account password to sign out devices remotely"); return }
    setBusy(true)
    try {
      const next = await fetchJson("/api/features/security", { method: "POST", body: JSON.stringify({ action: sessionId ? "revoke-session" : "revoke-others", sessionId, password }) })
      setState(next)
      setPassword("")
      toast.success(sessionId ? "Device signed out" : "Other devices signed out")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not sign out device") }
    finally { setBusy(false) }
  }


  const trust = async (sessionId: string, trusted: boolean) => {
    if (!password) { toast.error("Enter your account password to change trusted devices"); return }
    const mode = trusted ? "none" : (window.confirm("Trust this device permanently? Choose Cancel for 7 days.") ? "permanent" : "temporary")
    setBusy(true)
    try {
      const next = await fetchJson("/api/features/security", { method: "POST", body: JSON.stringify({ action: trusted ? "untrust-session" : "trust-session", sessionId, mode, days: 7, password }) })
      setState(next); setPassword("")
      toast.success(trusted ? "Device removed from trusted list" : mode === "permanent" ? "Device trusted" : "Device trusted for 7 days")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update trusted device") }
    finally { setBusy(false) }
  }

  if (!state) return <div className="rounded-lg border border-[var(--synnical-border)] p-5 text-sm text-[var(--synnical-muted)]">Loading signed-in devices…</div>
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--synnical-border)] p-4 sm:flex-row sm:items-end">
      <div className="flex-1"><Label>Password confirmation</Label><Input className="mt-1 bg-black" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Current password" autoComplete="current-password" /></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button><Button variant="destructive" disabled={busy || state.sessions.length <= 1} onClick={() => void revoke()}>Sign out other devices</Button></div>
    </div>
    <div className="space-y-2">{state.sessions.map((session) => <div key={session.id} className="flex flex-col gap-3 rounded-xl border border-[var(--synnical-border)] p-4 sm:flex-row sm:items-center"><Monitor className="h-5 w-5 text-[var(--synnical-accent)] shrink-0" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{session.deviceName || "Browser session"}{session.current ? " · This device" : ""}</p><p className="text-xs text-[var(--synnical-muted)] truncate">Last active {new Date(session.lastSeenAt).toLocaleString()}{session.trusted ? ` · Trusted${session.trustMode === "temporary" && session.trustedUntil ? ` until ${new Date(session.trustedUntil).toLocaleDateString()}` : ""}` : ""}</p><p className="text-[11px] text-[var(--synnical-muted)] truncate">{session.userAgent || "Browser details unavailable"}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void rename(session.id, session.deviceName)}>Rename</Button><Button size="sm" variant={session.trusted ? "ghost" : "outline"} disabled={busy} onClick={() => void trust(session.id, session.trusted)}>{session.trusted ? "Untrust" : "Trust"}</Button>{!session.current && <Button size="sm" variant="destructive" disabled={busy} onClick={() => void revoke(session.id)}>Sign out</Button>}</div></div>)}</div>
  </div>
}

export function R7SecurityControls() {
  const [state, setState] = useState<SecurityState | null>(null)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [codes, setCodes] = useState<string[]>([])
  const load = useCallback(async () => { try { setState(await fetchJson("/api/features/security")) } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load security") } }, [])
  useEffect(() => { void load() }, [load])
  const protectedAction = async (body: Record<string, unknown>) => {
    if (!password) { toast.error("Enter your account password to confirm this security action"); return }
    setBusy(true)
    try {
      const next = await fetchJson("/api/features/security", { method: "POST", body: JSON.stringify({ ...body, password }) })
      setState(next)
      if (Array.isArray(next.newRecoveryCodes)) setCodes(next.newRecoveryCodes)
      setPassword("")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Security action failed") }
    finally { setBusy(false) }
  }
  const rename = async (sessionId: string, currentName: string) => {
    const deviceName = window.prompt("Name this signed-in device", currentName)
    if (!deviceName?.trim()) return
    try { setState(await fetchJson("/api/features/security", { method: "POST", body: JSON.stringify({ action: "rename-session", sessionId, deviceName }) })) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Rename failed") }
  }
  if (!state) return <div className="rounded-xl border border-[var(--synnical-border)] p-4 text-sm text-[var(--synnical-muted)]">Loading account security…</div>
  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-[180px_1fr]">
      <div className="rounded-xl border border-[var(--synnical-border)] p-4 text-center"><Shield className="h-7 w-7 mx-auto text-[var(--synnical-accent)]" /><p className="text-3xl font-bold mt-2">{state.score}</p><p className="text-xs text-[var(--synnical-muted)]">Security score / 100</p></div>
      <div className="rounded-xl border border-[var(--synnical-border)] p-4"><h3 className="font-semibold">Security checklist</h3><div className="mt-2 space-y-1">{state.checklist.map((item) => <div key={item.id} className="flex items-center gap-2 text-sm"><span className={item.complete ? "text-emerald-400" : "text-amber-400"}>{item.complete ? "✓" : "○"}</span>{item.label}</div>)}</div></div>
    </div>

    <div className={`rounded-xl border p-4 ${state.lockdown ? "border-red-500/40 bg-red-500/5" : "border-[var(--synnical-border)]"}`}><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><ShieldAlert className={state.lockdown ? "h-5 w-5 text-red-400" : "h-5 w-5 text-[var(--synnical-accent)]"} /><div><h3 className="font-semibold">Emergency account lockdown</h3><p className="text-xs text-[var(--synnical-muted)] mt-1">When enabled, Synnical blocks outgoing chat messages, scheduled messages, credit transfers and cosmetic gifts. Incoming access remains available so you can investigate.</p></div></div><Button variant={state.lockdown ? "outline" : "destructive"} disabled={busy} onClick={() => void protectedAction({ action: "set-lockdown", enabled: !state.lockdown })}>{state.lockdown ? "Unlock account" : "Lock down"}</Button></div></div>

    <div className="rounded-xl border border-[var(--synnical-border)] p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Password confirmation</h3><p className="text-xs text-[var(--synnical-muted)]">Sensitive security changes require your password again.</p></div><Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Current password" className="max-w-xs bg-black" autoComplete="current-password" /></div></div>

    <div className="rounded-xl border border-[var(--synnical-border)] p-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Signed-in devices</h3><p className="text-xs text-[var(--synnical-muted)]">Sessions are server-side and can be named or revoked remotely.</p></div><Button size="sm" variant="outline" disabled={busy || state.sessions.length <= 1} onClick={() => void protectedAction({ action: "revoke-others" })}>Sign out other devices</Button></div><div className="mt-3 space-y-2">{state.sessions.map((session) => <div key={session.id} className="flex items-center gap-3 rounded-lg border border-[var(--synnical-border)] p-3"><Monitor className="h-4 w-4 text-[var(--synnical-accent)]" /><div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{session.deviceName || "Browser session"}{session.current ? " · This device" : ""}</p><p className="text-[11px] text-[var(--synnical-muted)] truncate">Last active {new Date(session.lastSeenAt).toLocaleString()} · {session.userAgent || "Browser details unavailable"}{session.trusted ? ` · Trusted${session.trustMode === "temporary" && session.trustedUntil ? ` until ${new Date(session.trustedUntil).toLocaleDateString()}` : ""}` : ""}</p></div><Button size="sm" variant="ghost" onClick={() => void rename(session.id, session.deviceName)}>Rename</Button><Button size="sm" variant={session.trusted ? "ghost" : "outline"} disabled={busy} onClick={() => void protectedAction(session.trusted ? { action: "untrust-session", sessionId: session.id } : { action: "trust-session", sessionId: session.id, mode: "temporary", days: 7 })}>{session.trusted ? "Untrust" : "Trust 7 days"}</Button>{!session.current && <Button size="sm" variant="destructive" disabled={busy} onClick={() => void protectedAction({ action: "revoke-session", sessionId: session.id })}>Sign out</Button>}</div>)}</div></div>

    <div className="rounded-xl border border-[var(--synnical-border)] p-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Recovery codes</h3><p className="text-xs text-[var(--synnical-muted)]">{state.recovery.remaining} unused code(s). Each code can sign in once if you cannot use your password.</p></div><Button size="sm" disabled={busy} onClick={() => void protectedAction({ action: "generate-recovery-codes" })}><KeyRound className="h-4 w-4 mr-1" />Generate new codes</Button></div>{codes.length > 0 && <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><p className="text-xs text-amber-200">Save these now. Synnical only shows the raw codes once.</p><div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 font-mono text-xs">{codes.map((code) => <code key={code}>{code}</code>)}</div><Button size="sm" variant="outline" className="mt-3" onClick={() => { void navigator.clipboard?.writeText(codes.join("\n")); toast.success("Recovery codes copied") }}><Copy className="h-4 w-4 mr-1" />Copy codes</Button></div>}</div>

    <div className="rounded-xl border border-[var(--synnical-border)] p-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Private security timeline</h3><p className="text-xs text-[var(--synnical-muted)]">Simple-language records of important account security changes.</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button><Button asChild size="sm" variant="outline"><a href="/api/features/security?download=1"><Download className="h-4 w-4 mr-1" />Security report</a></Button></div></div><div className="mt-3 max-h-72 overflow-y-auto space-y-2">{state.events.length === 0 ? <p className="text-sm text-[var(--synnical-muted)]">No security events recorded yet.</p> : state.events.map((event) => <div key={event.id} className="border-b border-[var(--synnical-border)] pb-2 last:border-0"><p className="text-sm">{event.message}</p><p className="text-[11px] text-[var(--synnical-muted)]">{new Date(event.createdAt).toLocaleString()}</p></div>)}</div></div>
  </div>
}
