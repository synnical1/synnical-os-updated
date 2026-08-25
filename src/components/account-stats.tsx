"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { AvatarWithDeco, DisplayName, RoleBadge } from "@/components/role-ui"
import {
  Loader2, CheckCircle2, XCircle, CalendarDays, MessageSquare, AlertTriangle,
  ShieldCheck, ShieldAlert, Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Stats = {
  accountAgeDays: number
  messageCount: number
  warnCount: number
  totalInfractions: number
  recentInfractions: number
  isTrusted: boolean
  role: string
  createdAt: string
}

type Requirements = {
  MIN_ACCOUNT_AGE_DAYS: number
  MIN_MESSAGES: number
  NO_INFRACTION_DAYS: number
}

const ROLE_TRUSTED_BYPASS = ["OWNER", "HEAD_ADMIN", "ADMIN", "MOD"]

export function AccountStats({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [reqs, setReqs] = useState<Requirements | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Defer setState out of the synchronous effect body to avoid cascading renders.
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      api.getAccountStats()
        .then((res: any) => {
          if (cancelled) return
          setStats(res.stats as Stats)
          setReqs(res.requirements as Requirements)
        })
        .catch(() => {
          if (!cancelled) {
            setStats(null)
            setReqs(null)
          }
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    })
    return () => { cancelled = true }
  }, [open])

  if (!user) return null

  const isRoleTrusted = ROLE_TRUSTED_BYPASS.includes(user.role)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-[#0a0a0a] border-[#2a2a2a] max-h-[90vh] overflow-y-auto custom-scroll">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-white" />
            <DialogTitle>Account Standing &amp; Stats</DialogTitle>
          </div>
          <DialogDescription>
            Your account statistics and trusted-user progress.
          </DialogDescription>
        </DialogHeader>

        {/* Identity row */}
        <div className="flex items-center gap-3 rounded-lg border border-[#2a2a2a] p-3 bg-[#070707]">
          <AvatarWithDeco
            src={user.pfpUrl}
            name={user.displayName}
            role={user.role}
            avatarDeco={user.avatarDeco}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <DisplayName name={user.displayName} role={user.role} className="text-sm font-semibold truncate" />
              <RoleBadge role={user.role} tags={user.tags} />
            </div>
            <p className="text-xs text-[#888888] truncate">@{user.username}</p>
          </div>
        </div>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#888888]" />
          </div>
        ) : !stats || !reqs ? (
          <div className="py-8 text-center text-sm text-[#888888]">
            Could not load account stats.
          </div>
        ) : (
          <>
            {/* Trusted banner */}
            <div
              className={cn(
                "rounded-lg border p-3 flex items-start gap-3",
                stats.isTrusted
                  ? "border-[#333] bg-[#111]"
                  : "border-[#2a2a2a] bg-[#0b0b0b]"
              )}
            >
              {stats.isTrusted ? (
                <CheckCircle2 className="h-5 w-5 text-white shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-white shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold", stats.isTrusted ? "text-white" : "text-white")}>
                  {stats.isTrusted ? "Trusted account" : "Not yet trusted"}
                </p>
                <p className="text-xs text-[#888888]">
                  {stats.isTrusted
                    ? isRoleTrusted
                      ? "Trusted by role (staff). Thank you for helping moderate Synnical."
                      : "You meet all the requirements for a trusted account."
                    : "Meet the requirements below to earn the trusted badge."}
                </p>
              </div>
            </div>

            {/* Quick stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <StatCard
                Icon={CalendarDays}
                label="Account age"
                value={`${stats.accountAgeDays}d`}
              />
              <StatCard
                Icon={MessageSquare}
                label="Messages"
                value={stats.messageCount.toLocaleString()}
              />
              <StatCard
                Icon={AlertTriangle}
                label="Warns"
                value={String(stats.warnCount)}
                tone={stats.warnCount > 0 ? "warn" : "default"}
              />
              <StatCard
                Icon={ShieldAlert}
                label="Total infractions"
                value={String(stats.totalInfractions)}
                tone={stats.totalInfractions > 0 ? "warn" : "default"}
              />
              <StatCard
                Icon={AlertTriangle}
                label={`Last ${reqs.NO_INFRACTION_DAYS}d`}
                value={String(stats.recentInfractions)}
                tone={stats.recentInfractions > 0 ? "warn" : "default"}
              />
              <StatCard
                Icon={Sparkles}
                label="Joined"
                value={new Date(stats.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              />
            </div>

            {/* Trusted requirements with progress bars */}
            <div className="rounded-lg border border-[#2a2a2a] p-3 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-white" />
                <h3 className="text-sm font-semibold">Trusted requirements</h3>
              </div>
              <p className="text-xs text-[#888888] -mt-1">
                Staff (owner/admin/mod) are trusted automatically.
              </p>

              <RequirementRow
                label="Account age"
                current={stats.accountAgeDays}
                target={reqs.MIN_ACCOUNT_AGE_DAYS}
                unit="days"
                format={(v) => `${v}d`}
              />
              <RequirementRow
                label="Messages sent"
                current={stats.messageCount}
                target={reqs.MIN_MESSAGES}
                unit="messages"
                format={(v) => v.toLocaleString()}
              />
              <RequirementRow
                label={`No infractions in last ${reqs.NO_INFRACTION_DAYS} days`}
                current={stats.recentInfractions === 0 ? reqs.NO_INFRACTION_DAYS : 0}
                target={reqs.NO_INFRACTION_DAYS}
                unit="days clean"
                format={(v) => `${v}/${reqs.NO_INFRACTION_DAYS}d`}
                invert
              />
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatCard({
  Icon,
  label,
  value,
  tone = "default",
}: {
  Icon: typeof CalendarDays
  label: string
  value: string
  tone?: "default" | "warn"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 flex flex-col gap-1",
        tone === "warn"
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-[#2a2a2a] bg-[#070707]"
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", tone === "warn" ? "text-amber-500" : "text-white")} />
        <span className="text-[10px] uppercase tracking-wide text-[#888888]">{label}</span>
      </div>
      <span className={cn("text-base font-semibold leading-none", tone === "warn" ? "text-amber-600" : "text-[#f0f0f0]")}>
        {value}
      </span>
    </div>
  )
}

function RequirementRow({
  label,
  current,
  target,
  unit,
  format,
  invert = false,
}: {
  label: string
  current: number
  target: number
  unit: string
  format: (v: number) => string
  invert?: boolean
}) {
  // For invert=true: success means current==0 infractions in window.
  // We treat "clean days" as the progress metric (NO_INFRACTION_DAYS if no infractions, 0 otherwise).
  const met = invert ? current >= target : current >= target
  const pct = Math.max(0, Math.min(100, Math.round((current / target) * 100)))

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#f0f0f0]/80">{label}</span>
        <span className={cn("font-medium", met ? "text-white" : "text-[#888888]")}>
          {met ? (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {invert ? "Clean" : "Met"}
            </span>
          ) : (
            <span>
              {format(current)} <span className="text-[#888888]/70">/ {format(target)}</span>
            </span>
          )}
        </span>
      </div>
      <Progress
        value={met ? 100 : pct}
        className={cn(
          "h-1.5",
          met ? "[&>[data-slot=progress-indicator]]:bg-white" : "[&>[data-slot=progress-indicator]]:bg-white"
        )}
      />
      <span className="sr-only">{unit}</span>
    </div>
  )
}
