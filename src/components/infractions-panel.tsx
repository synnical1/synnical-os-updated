"use client"

import { useState, useEffect, useCallback } from "react"
import { api, type SafeUser } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AvatarWithDeco, DisplayName, RoleBadge } from "@/components/role-ui"
import {
  Shield, ShieldAlert, AlertTriangle, Ban, Trash2, Loader2, Search, Gavel, Clock, Sparkles, Flag, CheckCircle2, XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { AUTO_PUNISHMENTS } from "@/lib/constants"
import { useSetting } from "@/lib/settings-runtime"

type InfractionType = "WARN" | "MUTE" | "BAN" | "AUTO_MUTE" | "AUTO_BAN"

type Infraction = {
  id: string
  userId: string
  issuerId: string
  type: InfractionType
  reason: string
  duration: number | null
  createdAt: string
  user?: SafeUser
  issuer?: SafeUser
}

type ModerationReport = {
  id: string
  reporterUsername: string
  targetUsername: string
  category: string
  reason: string
  priority: number
  status: string
  messageIdSnapshot: string | null
  channelNameSnapshot: string | null
  messageContentSnapshot: string
  messageGifSnapshot: string | null
  context: Array<{ id?: string; username?: string; displayName?: string; content?: string; gifUrl?: string | null; createdAt?: string; deleted?: boolean }>
  createdAt: string
}

const TYPE_TABS: { id: string; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "WARN", label: "Warnings" },
  { id: "MUTE", label: "Mutes" },
  { id: "BAN", label: "Bans" },
  { id: "AUTO_MUTE", label: "Auto-Mutes" },
  { id: "AUTO_BAN", label: "Auto-Bans" },
]

const TYPE_CONFIG: Record<InfractionType, { label: string; cls: string; Icon: typeof AlertTriangle }> = {
  WARN: { label: "Warn", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30", Icon: AlertTriangle },
  MUTE: { label: "Mute", cls: "bg-orange-500/15 text-orange-500 border-orange-500/30", Icon: ShieldAlert },
  BAN: { label: "Ban", cls: "bg-red-500/15 text-red-500 border-red-500/30", Icon: Ban },
  AUTO_MUTE: { label: "Auto-Mute", cls: "bg-[var(--synnical-accent)]/15 text-[var(--synnical-accent)] border-[var(--synnical-accent)]/30", Icon: ShieldAlert },
  AUTO_BAN: { label: "Auto-Ban", cls: "bg-[var(--synnical-accent)]/20 text-[var(--synnical-accent)] border-[var(--synnical-accent)]/40", Icon: Ban },
}

function formatDuration(min: number | null): string {
  if (min === null) return "permanent"
  if (min < 60) return `${min}m`
  if (min < 1440) return `${Math.floor(min / 60)}h`
  return `${Math.floor(min / 1440)}d`
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

export function InfractionsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth()
  const [tab, setTab] = useState<string>("ALL")
  const [infractions, setInfractions] = useState<Infraction[]>([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<SafeUser[]>([])
  const [search, setSearch] = useState("")
  const [selectedUserId, setSelectedUserId] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reports, setReports] = useState<ModerationReport[]>([])
  const [reportsLoading, setReportsLoading] = useState(true)
  const [reportBusy, setReportBusy] = useState("")

  // --- Moderation settings (wired to settings-runtime) ---
  const [warnThreshold] = useSetting<number>("mod.warnThreshold", 3)
  const [muteThreshold] = useSetting<number>("mod.muteThreshold", 5)
  const [banThreshold] = useSetting<number>("mod.banThreshold", 7)
  const [muteDuration] = useSetting<number>("mod.muteDuration", 60)
  const [appealCooldown] = useSetting<number>("mod.appealCooldown", 7)
  const [showActions] = useSetting<boolean>("mod.showActions", false)
  const [requireReason] = useSetting<boolean>("mod.requireReason", true)
  const [maxWarnings] = useSetting<number>("mod.maxWarnings", 10)

  const canDelete = user?.role === "OWNER" || user?.role === "HEAD_ADMIN" || user?.role === "ADMIN"

  const loadInfractions = useCallback(async (type: string) => {
    setLoading(true)
    try {
      const { infractions: data } = await api.listInfractions(type === "ALL" ? undefined : type)
      setInfractions(data as Infraction[])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load infractions")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUsers = useCallback(async (query = "") => {
    try {
      const { users: u } = await api.listUsers({ q: query.trim(), page: 1, pageSize: 50 })
      setUsers(u)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users")
    }
  }, [])

  useEffect(() => {
    loadInfractions(tab)
  }, [tab, loadInfractions])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadUsers(search) }, 250)
    return () => window.clearTimeout(timer)
  }, [search, loadUsers])

  const loadReports = useCallback(async () => {
    setReportsLoading(true)
    try {
      const result = await api.listReports("OPEN")
      setReports(result.reports as ModerationReport[])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reports")
    } finally {
      setReportsLoading(false)
    }
  }, [])

  useEffect(() => { void loadReports() }, [loadReports])

  const closeReport = async (reportId: string, status: "RESOLVED" | "DISMISSED") => {
    setReportBusy(reportId)
    try {
      await api.resolveReport(reportId, status)
      setReports((current) => current.filter((report) => report.id !== reportId))
      toast.success(status === "RESOLVED" ? "Report resolved" : "Report dismissed")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update report")
    } finally {
      setReportBusy("")
    }
  }

  if (!user) return null

  const filteredUsers = users

  const submitWarn = async () => {
    if (!selectedUserId || !reason.trim()) {
      toast.error("Pick a user and enter a reason")
      return
    }
    setSubmitting(true)
    try {
      await api.warnUser(selectedUserId, reason.trim())
      toast.success("Warning issued")
      setReason("")
      setSelectedUserId("")
      setSearch("")
      // Reload both lists so the new warn shows up immediately
      await Promise.all([loadInfractions(tab), loadUsers("")])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to issue warning")
    } finally {
      setSubmitting(false)
    }
  }

  const onDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await api.deleteInfraction(id)
      toast.success("Infraction removed")
      setInfractions((prev) => prev.filter((i) => i.id !== id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete infraction")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className={embedded ? "min-h-[720px] flex flex-col" : "h-full flex flex-col bg-[var(--synnical-bg)]"}>
      {/* Header */}
      {!embedded && <div className="shrink-0 px-4 h-11 flex items-center gap-2 border-b border-[var(--synnical-border)]">
        <Shield className="h-4 w-4 text-[var(--synnical-accent)]" />
        <span className="font-semibold">Moderation</span>
        <Badge variant="outline" className="ml-1 border-[var(--synnical-accent)]/40 text-[var(--synnical-accent)]">
          <Shield className="h-2.5 w-2.5" />
          {user.role === "OWNER" ? "Owner" : user.role === "HEAD_ADMIN" ? "Head Admin" : user.role === "ADMIN" ? "Admin" : "Mod"}
        </Badge>
        <div className="flex-1" />
        <span className="text-xs text-[var(--synnical-muted)] hidden sm:block">
          {infractions.length} record{infractions.length === 1 ? "" : "s"}
        </span>
      </div>}

      <div className={embedded ? "flex-1" : "flex-1 overflow-y-auto custom-scroll"}>
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
          {/* Snapshot reports queue */}
          <section className="overflow-hidden rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--synnical-border)] px-4 py-3">
              <div><div className="flex items-center gap-2"><Flag className="h-4 w-4 text-amber-300" /><h2 className="text-sm font-semibold">Reports queue</h2></div><p className="mt-1 text-xs text-[var(--synnical-muted)]">Evidence shown here is the snapshot captured when the report was submitted, not a live message lookup.</p></div>
              <Badge variant="outline">{reports.length} open</Badge>
            </div>
            <div className="max-h-[520px] overflow-y-auto custom-scroll">
              {reportsLoading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> :
               reports.length === 0 ? <div className="p-8 text-center text-sm text-[var(--synnical-muted)]">No open reports.</div> :
               reports.map((report) => (
                <article key={report.id} className={cn("border-b border-[var(--synnical-border)] p-4 last:border-0", report.category === "CHILD_SAFETY" && "bg-amber-500/8")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={report.category === "CHILD_SAFETY" ? "border-amber-400/40 bg-amber-500/15 text-amber-100" : ""}>{report.category.replaceAll("_", " ")}</Badge>
                        {report.category === "CHILD_SAFETY" && <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Priority queue</span>}
                        <span className="text-[10px] text-[var(--synnical-muted)]">priority {report.priority}</span>
                      </div>
                      <p className="mt-2 text-xs text-[var(--synnical-muted)]">Reported by <span className="text-[var(--synnical-text)]">@{report.reporterUsername}</span> · target <span className="text-[var(--synnical-text)]">@{report.targetUsername}</span>{report.channelNameSnapshot ? ` · #${report.channelNameSnapshot}` : ""}</p>
                      <p className="mt-2 text-sm"><span className="font-semibold">Reason:</span> {report.reason}</p>
                    </div>
                    <span className="text-[10px] text-[var(--synnical-muted)]">{new Date(report.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-3 rounded-lg border border-[var(--synnical-border)] bg-[#080808] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--synnical-muted)]">Reported message snapshot</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{report.messageContentSnapshot || (report.messageGifSnapshot ? "[GIF message]" : "[empty message]")}</p>
                  </div>
                  {Array.isArray(report.context) && report.context.length > 0 && (
                    <details className="mt-2 rounded-lg border border-[var(--synnical-border)] bg-[#080808] p-3">
                      <summary className="cursor-pointer text-xs font-semibold">Surrounding conversation snapshot ({report.context.length})</summary>
                      <div className="mt-3 space-y-2">
                        {report.context.map((row, index) => <div key={`${row.id || "row"}-${index}`} className="rounded border border-white/5 bg-[#080808] px-3 py-2">
                          <p className="text-[10px] text-[var(--synnical-muted)]">{row.displayName || row.username || "Unknown"} · {row.createdAt ? new Date(row.createdAt).toLocaleString() : ""}</p>
                          <p className="mt-1 break-words text-xs">{row.deleted ? "[message was already deleted when captured]" : row.content || (row.gifUrl ? "[GIF]" : "")}</p>
                        </div>)}
                      </div>
                    </details>
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => void closeReport(report.id, "DISMISSED")} disabled={Boolean(reportBusy)}>{reportBusy === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Dismiss</Button>
                    <Button size="sm" onClick={() => void closeReport(report.id, "RESOLVED")} disabled={Boolean(reportBusy)}>{reportBusy === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Resolve</Button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Auto-punishment thresholds */}
          <section className="rounded-xl border border-[#2a2a2a] bg-[#070707] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-[var(--synnical-accent)]" />
              <h2 className="text-sm font-semibold text-[var(--synnical-accent)]">Auto-Punishment Thresholds</h2>
            </div>
            <p className="text-xs text-[var(--synnical-muted)] mb-3">
              Warnings accumulate on a user&apos;s account. When thresholds are crossed, automatic
              punishments are applied.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ThresholdCard
                count={AUTO_PUNISHMENTS.WARN_THRESHOLD_1H_MUTE}
                label="1 hour mute"
                Icon={Clock}
              />
              <ThresholdCard
                count={AUTO_PUNISHMENTS.WARN_THRESHOLD_24H_MUTE}
                label="24 hour mute"
                Icon={ShieldAlert}
              />
              <ThresholdCard
                count={AUTO_PUNISHMENTS.WARN_THRESHOLD_PERM_BAN}
                label="Permanent ban"
                Icon={Ban}
              />
            </div>
          </section>

          {/* Moderation settings info card */}
          <section className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-[var(--synnical-accent)]" />
              <h2 className="text-sm font-semibold">Moderation Settings</h2>
            </div>
            {/* Thresholds */}
            <p className="text-xs font-medium text-[var(--synnical-text)] mb-2">Thresholds</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg border border-[var(--synnical-border)] bg-black px-3 py-2">
                <p className="text-[10px] uppercase text-[var(--synnical-muted)]">Warn</p>
                <p className="text-sm font-semibold">{warnThreshold} <span className="text-[var(--synnical-muted)] font-normal text-xs">warns</span></p>
              </div>
              <div className="rounded-lg border border-[var(--synnical-border)] bg-black px-3 py-2">
                <p className="text-[10px] uppercase text-[var(--synnical-muted)]">Mute</p>
                <p className="text-sm font-semibold">{muteThreshold} <span className="text-[var(--synnical-muted)] font-normal text-xs">warns</span></p>
              </div>
              <div className="rounded-lg border border-[var(--synnical-border)] bg-black px-3 py-2">
                <p className="text-[10px] uppercase text-[var(--synnical-muted)]">Ban</p>
                <p className="text-sm font-semibold">{banThreshold} <span className="text-[var(--synnical-muted)] font-normal text-xs">warns</span></p>
              </div>
            </div>
            {/* Indicators */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-[var(--synnical-border)] text-[var(--synnical-muted)]" title={`Default mute: ${muteDuration} min`}>
                <Clock className="h-2.5 w-2.5" />
                Default mute: {muteDuration} min
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-[var(--synnical-border)] text-[var(--synnical-muted)]" title={`Appeal cooldown: ${appealCooldown} days`}>
                <Clock className="h-2.5 w-2.5" />
                Appeal cooldown: {appealCooldown} days
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-[var(--synnical-border)] text-[var(--synnical-muted)]" title={`Max warnings: ${maxWarnings}`}>
                <AlertTriangle className="h-2.5 w-2.5" />
                Max warnings: {maxWarnings}
              </span>
              <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border", showActions ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-[var(--synnical-border)] text-[var(--synnical-muted)]")} title={`Actions ${showActions ? "visible" : "hidden"} publicly`}>
                <ShieldAlert className="h-2.5 w-2.5" />
                Actions: {showActions ? "public" : "hidden"}
              </span>
            </div>
            {requireReason && (
              <p className="text-xs text-amber-500 mt-3 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" />
                Reason required for all actions
              </p>
            )}
          </section>

          {/* Warn user */}
          <section className="rounded-xl border border-[var(--synnical-border)] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Gavel className="h-4 w-4 text-[var(--synnical-accent)]" />
              <h2 className="text-sm font-semibold">Warn a user</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="warn-search" className="text-xs">Search user</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--synnical-muted)]" />
                  <Input
                    id="warn-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="username or display name"
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pick user</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {filteredUsers.length === 0 ? (
                      <SelectItem value="__none" disabled>No matches</SelectItem>
                    ) : (
                      filteredUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id} disabled={u.id === user.id}>
                          <span className="flex items-center gap-2">
                            <span>{u.displayName}</span>
                            <span className="text-[var(--synnical-muted)] text-xs">@{u.username}</span>
                            {(u.warnCount ?? 0) > 0 && (
                              <span className="ml-1 text-[10px] bg-amber-500/15 text-amber-500 px-1 rounded">
                                {u.warnCount}w
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="warn-reason" className="text-xs">Reason</Label>
              <Input
                id="warn-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this user being warned?"
                maxLength={200}
                onKeyDown={(e) => { if (e.key === "Enter" && !submitting) submitWarn() }}
              />
            </div>

            <div className="flex justify-end">
              <Button
                onClick={submitWarn}
                disabled={!selectedUserId || !reason.trim() || submitting}
                className="bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black"
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                Issue warning
              </Button>
            </div>
          </section>

          {/* Infractions table */}
          <section className="rounded-xl border border-[var(--synnical-border)] overflow-hidden">
            <Tabs value={tab} onValueChange={setTab}>
              <div className="p-2 border-b border-[var(--synnical-border)] overflow-x-auto">
                <TabsList className="bg-[var(--synnical-surface-2)]">
                  {TYPE_TABS.map((t) => (
                    <TabsTrigger key={t.id} value={t.id} className="text-xs">
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>

            <div className="max-h-[420px] overflow-y-auto custom-scroll">
              {loading ? (
                <div className="p-8 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--synnical-muted)]" />
                </div>
              ) : infractions.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--synnical-muted)]">
                  <Shield className="h-8 w-8 mx-auto mb-2 text-[var(--synnical-muted)]/40" />
                  No infractions in this view.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--synnical-surface-2)] text-xs uppercase text-[var(--synnical-muted)]">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">User</th>
                      {showActions && <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Type</th>}
                      <th className="text-left font-medium px-3 py-2">Reason</th>
                      {showActions && <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Issuer</th>}
                      <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">When</th>
                      {canDelete && <th className="px-3 py-2 w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {infractions.map((inf) => {
                      const cfg = TYPE_CONFIG[inf.type] || TYPE_CONFIG.WARN
                      const { Icon } = cfg
                      return (
                        <tr key={inf.id} className="border-t border-[var(--synnical-border)] hover:bg-[var(--synnical-surface-2)] align-top">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <AvatarWithDeco
                                src={inf.user?.pfpUrl}
                                name={inf.user?.displayName || "?"}
                                role={(inf.user?.role || "MEMBER") as SafeUser["role"]}
                                avatarDeco={inf.user?.avatarDeco}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <DisplayName
                                    name={inf.user?.displayName || "Unknown"}
                                    role={(inf.user?.role || "MEMBER") as SafeUser["role"]}
                                    className="text-sm truncate"
                                  />
                                  {inf.user && inf.user.role !== "MEMBER" && (
                                    <RoleBadge role={inf.user.role} tags={inf.user.tags} />
                                  )}
                                </div>
                                <p className="text-xs text-[var(--synnical-muted)] truncate">
                                  @{inf.user?.username || "unknown"}
                                </p>
                              </div>
                            </div>
                          </td>
                          {showActions && (
                          <td className="px-3 py-2.5 hidden sm:table-cell">
                            <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md border", cfg.cls)}>
                              <Icon className="h-2.5 w-2.5" />
                              {cfg.label}
                            </span>
                            {inf.duration !== null && (
                              <p className="text-[10px] text-[var(--synnical-muted)] mt-1">
                                {formatDuration(inf.duration)}
                              </p>
                            )}
                          </td>
                          )}
                          <td className="px-3 py-2.5">
                            <p className="text-sm text-[var(--synnical-text)]/90 break-words line-clamp-2">{inf.reason}</p>
                            <span className={cn("sm:hidden inline-flex items-center gap-1 text-[10px] font-semibold uppercase mt-1 px-1.5 py-0.5 rounded border", cfg.cls)}>
                              <Icon className="h-2.5 w-2.5" />{cfg.label}
                            </span>
                          </td>
                          {showActions && (
                          <td className="px-3 py-2.5 hidden md:table-cell">
                            <div className="flex items-center gap-2 min-w-0">
                              <AvatarWithDeco
                                src={inf.issuer?.pfpUrl}
                                name={inf.issuer?.displayName || "?"}
                                role={(inf.issuer?.role || "MEMBER") as SafeUser["role"]}
                                avatarDeco={inf.issuer?.avatarDeco}
                                size="xs"
                              />
                              <div className="min-w-0">
                                <DisplayName
                                  name={inf.issuer?.displayName || "System"}
                                  role={(inf.issuer?.role || "MEMBER") as SafeUser["role"]}
                                  className="text-xs truncate"
                                />
                                <p className="text-[10px] text-[var(--synnical-muted)] truncate">
                                  @{inf.issuer?.username || "system"}
                                </p>
                              </div>
                            </div>
                          </td>
                          )}
                          <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-[var(--synnical-muted)] whitespace-nowrap">
                            {formatRelative(inf.createdAt)}
                          </td>
                          {canDelete && (
                            <td className="px-3 py-2.5 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-[#ef4444] hover:text-[#ef4444] hover:bg-[#ef4444]/10"
                                onClick={() => onDelete(inf.id)}
                                disabled={deletingId === inf.id}
                                aria-label="Delete infraction"
                              >
                                {deletingId === inf.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function ThresholdCard({
  count,
  label,
  Icon,
}: {
  count: number
  label: string
  Icon: typeof AlertTriangle
}) {
  return (
    <div className="rounded-lg border border-[var(--synnical-accent)]/20 bg-black p-3 flex items-center gap-3">
      <div className="h-9 w-9 rounded-lg bg-[var(--synnical-accent)]/15 text-[var(--synnical-accent)] flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--synnical-muted)]">At</p>
        <p className="text-sm font-semibold leading-tight">
          {count} <span className="text-[var(--synnical-muted)] font-normal">warns</span>
        </p>
        <p className="text-xs text-[var(--synnical-accent)]">{label}</p>
      </div>
    </div>
  )
}
