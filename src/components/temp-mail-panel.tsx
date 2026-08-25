"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Mail,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Inbox as InboxIcon,
  Clock,
  AlertCircle,
  ChevronRight,
  X,
  Mailbox,
  Server,
  Forward,
  Bell,
  Globe,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSetting } from "@/lib/settings-runtime"

// ---------------------------------------------------------------------------
// Types — match the upstream API spec
// ---------------------------------------------------------------------------

interface MailSession {
  address: string
  token: string
  provider: string
}

interface Email {
  from: string
  to: string
  subject: string
  body: string
  date: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_LIFETIME_MS = 10 * 60 * 1000 // 10 minutes — mail.gw account lifetime
const INBOX_POLL_MS = 5_000
const COUNTDOWN_TICK_MS = 1000

// ---------------------------------------------------------------------------
// API helpers (call our own Next.js proxy — never the upstream directly, so
// the backend URL stays server-side)
// ---------------------------------------------------------------------------

async function createSession(): Promise<MailSession> {
  const res = await fetch("/api/tempmail/session", { method: "GET" })
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText)
    throw new Error(`Failed to create session (${res.status}): ${txt}`)
  }
  return res.json()
}

async function fetchInbox(token: string): Promise<Email[]> {
  const res = await fetch(`/api/tempmail/inbox/${encodeURIComponent(token)}`)
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText)
    throw new Error(`Failed to fetch inbox (${res.status}): ${txt}`)
  }
  const data = await res.json()
  // Upstream returns an array directly; be defensive.
  return Array.isArray(data) ? data : (data.emails ?? [])
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleString()
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "expired"
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function TempMailPanel() {
  const [session, setSession] = useState<MailSession | null>(null)
  const [inbox, setInbox] = useState<Email[]>([])
  const [loadingSession, setLoadingSession] = useState(false)
  const [loadingInbox, setLoadingInbox] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [selected, setSelected] = useState<Email | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  // --- Mail settings (wired to settings-runtime) ---
  const [mailRefresh] = useSetting<number>("mail.refresh", 30)
  const [mailFormat] = useSetting<string>("mail.format", "html")
  const [mailDesktopNotifs] = useSetting<boolean>("mail.desktopNotifs", true)
  const [mailAutoDelete] = useSetting<number>("mail.autoDelete", 7)
  const [mailDomain] = useSetting<string>("mail.domain", "auto")
  const [mailForward] = useSetting<string>("mail.forward", "")

  // Poll interval derived from the refresh setting (seconds -> ms)
  const inboxPollMs = mailRefresh * 1000

  const prevInboxCountRef = useRef(0)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionRef = useRef<MailSession | null>(null)
  sessionRef.current = session

  // --- Countdown ticker (1Hz) ---
  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [])

  // --- Request Notification permission when desktop notifs are enabled ---
  useEffect(() => {
    if (!mailDesktopNotifs) return
    if (typeof Notification === "undefined") return
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {})
    }
  }, [mailDesktopNotifs])

  // --- Inbox poller (every `inboxPollMs` while session is alive) ---
  const pollInbox = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return
    try {
      const mails = await fetchInbox(s.token)
      // Fire a desktop notification when new mail arrives.
      if (
        mailDesktopNotifs &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        mails.length > prevInboxCountRef.current
      ) {
        try {
          const latest = mails[mails.length - 1]
          new Notification("New mail", {
            body: latest?.subject || "(no subject)",
          })
        } catch {
          /* notification creation can fail; ignore */
        }
      }
      prevInboxCountRef.current = mails.length
      setInbox(mails)
      setError(null)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoadingInbox(false)
    }
  }, [mailDesktopNotifs])

  useEffect(() => {
    if (!session) {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
      return
    }
    // immediate poll
    setLoadingInbox(true)
    pollInbox()
    pollRef.current = setInterval(pollInbox, inboxPollMs)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [session, pollInbox, inboxPollMs])

  // --- Create a brand-new mail session ---
  const newSession = useCallback(async () => {
    setLoadingSession(true)
    setError(null)
    setInbox([])
    setSelected(null)
    try {
      const s = await createSession()
      setSession(s)
      setExpiresAt(Date.now() + SESSION_LIFETIME_MS)
    } catch (e: any) {
      setError(e.message || String(e))
      setSession(null)
      setExpiresAt(null)
    } finally {
      setLoadingSession(false)
    }
  }, [])

  // --- Auto-create the first session on mount ---
  useEffect(() => {
    if (!session && !loadingSession) newSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Expire handler — when the countdown hits zero, clear inbox ---
  const remaining = expiresAt ? expiresAt - now : null
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && session) {
      setInbox([])
      setError("Session expired — emails destroyed. Generate a new address below.")
    }
  }, [remaining, session])

  // --- Copy address to clipboard ---
  const copyAddress = useCallback(async () => {
    if (!session) return
    const text = session.address
    // Try modern clipboard API first (requires HTTPS or localhost)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      return
    } catch {
      // Clipboard API failed (likely non-secure context / HTTP)
    }
    // Fallback: execCommand('copy') with a hidden textarea
    try {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.left = "-9999px"
      textarea.style.top = "0"
      textarea.setAttribute("readonly", "")
      document.body.appendChild(textarea)
      textarea.select()
      textarea.setSelectionRange(0, text.length)
      const ok = document.execCommand("copy")
      document.body.removeChild(textarea)
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } else {
        setError("Copy failed — please select the address and copy manually.")
      }
    } catch {
      setError("Copy failed — please select the address and copy manually.")
    }
  }, [session])

  const expired = remaining !== null && remaining <= 0

  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <div className="shrink-0 border-b border-[#2a2a2a] px-4 py-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-[#101010] border border-[#303030] flex items-center justify-center">
          <Mailbox className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-[#f0f0f0]">Temp Mail</h2>
          <p className="text-xs text-[#888888]">
            Disposable inbox · no signup · emails auto-destroyed after 2 minutes
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={newSession}
          disabled={loadingSession}
          className="gap-1.5"
        >
          {loadingSession ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          New address
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Session card */}
        <div className="shrink-0 px-4 py-3 border-b border-[#2a2a2a] bg-[#0d0d0d]">
          {session ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#888888] uppercase tracking-wider">
                  Your address
                </span>
                {remaining !== null && (
                  <span
                    className={cn(
                      "ml-auto text-xs font-mono flex items-center gap-1 px-2 py-0.5 rounded-full border",
                      expired
                        ? "border-red-500/30 text-red-400 bg-red-500/10"
                        : remaining < 30_000
                          ? "border-orange-500/30 text-orange-400 bg-orange-500/10"
                          : "border-[#2a2a2a] text-[#aaaaaa]",
                    )}
                  >
                    <Clock className="h-3 w-3" />
                    {expired ? "expired" : formatCountdown(remaining)}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-md bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-[#f0f0f0] font-mono">
                  {session.address}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={copyAddress}
                  aria-label="Copy address"
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-[#666666]">
                <Server className="h-3 w-3" />
                <span>Provider:</span>
                <span className="text-[#aaaaaa] font-mono">{session.provider}</span>
              </div>

              {/* Mail setting indicators */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-[#888888]"
                  title={`Domain preference: ${mailDomain}`}
                >
                  <Globe className="h-2.5 w-2.5" />
                  {mailDomain === "auto" ? "Domain: auto" : mailDomain}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border",
                    mailDesktopNotifs
                      ? "border-green-500/30 bg-green-500/10 text-green-400"
                      : "border-[#2a2a2a] text-[#666666]",
                  )}
                  title={`Desktop notifications: ${mailDesktopNotifs ? "on" : "off"}`}
                >
                  <Bell className="h-2.5 w-2.5" />
                  {mailDesktopNotifs ? "Notifs on" : "Notifs off"}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-[#888888]"
                  title={`Auto-delete after ${mailAutoDelete} days`}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                  Auto-delete after {mailAutoDelete} days
                </span>
                {mailForward && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-[#333] bg-[#111] text-white"
                    title={`Forwarding to ${mailForward}`}
                  >
                    <Forward className="h-2.5 w-2.5" />
                    Forwarding to: {mailForward}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 py-2">
              {loadingSession ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  <span className="text-sm text-[#888888]">
                    Generating a fresh address…
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-orange-400" />
                  <span className="text-sm text-[#888888]">
                    No active session.
                  </span>
                  <Button size="sm" variant="default" onClick={newSession} className="ml-auto">
                    Generate
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="shrink-0 px-4 py-2 border-b border-red-500/20 bg-red-500/5 text-xs text-red-400 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400/60 hover:text-red-400"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Inbox */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="shrink-0 px-4 py-2 flex items-center gap-2 border-b border-[#2a2a2a]">
            <InboxIcon className="h-4 w-4 text-white" />
            <span className="text-xs font-medium text-[#888888] uppercase tracking-wider">
              Inbox
            </span>
            <span className="text-xs text-[#666666]">
              {inbox.length} {inbox.length === 1 ? "message" : "messages"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={pollInbox}
              disabled={!session || loadingInbox}
              className="ml-auto h-7 gap-1.5 text-xs"
            >
              {loadingInbox ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Refresh
            </Button>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 py-2">
              {inbox.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <div className="h-12 w-12 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center mb-3">
                    <Mail className="h-6 w-6 text-[#555555]" />
                  </div>
                  <p className="text-sm text-[#888888] font-medium">
                    {expired
                      ? "Session expired"
                      : "Waiting for emails"}
                  </p>
                  <p className="text-xs text-[#555555] mt-1 max-w-xs">
                    {expired
                      ? "Emails from this session have been destroyed. Generate a new address to receive more."
                      : "Send an email to your temporary address. New messages appear here automatically every 5 seconds."}
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {inbox.map((mail, i) => (
                    <li key={`${mail.date}-${i}`}>
                      <button
                        onClick={() => setSelected(mail)}
                        className={cn(
                          "w-full text-left px-3 py-2.5 rounded-md border transition-colors",
                          "border-transparent hover:bg-[#1a1a1a] hover:border-[#2a2a2a]",
                          selected?.date === mail.date && selected?.from === mail.from
                            ? "bg-[#0d0d0d] border-[#2a2a2a]"
                            : "",
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-[#f0f0f0] truncate flex-1">
                            {mail.from}
                          </span>
                          <span className="text-[10px] text-[#555555] font-mono shrink-0">
                            {formatRelative(mail.date)}
                          </span>
                        </div>
                        <div className="text-sm text-[#cccccc] truncate">
                          {mail.subject || "(no subject)"}
                        </div>
                        <div className="text-xs text-[#666666] truncate mt-0.5">
                          {mail.body?.replace(/<[^>]*>/g, "").slice(0, 80) || ""}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Email viewer modal */}
      {selected && (
        <EmailViewer
          email={selected}
          format={mailFormat}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Email viewer
// ---------------------------------------------------------------------------

function EmailViewer({ email, format, onClose }: { email: Email; format: string; onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-[#121212] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-5 py-3 border-b border-[#2a2a2a] flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-[#101010] border border-[#303030] flex items-center justify-center shrink-0">
            <Mail className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-[#f0f0f0] truncate">
              {email.subject || "(no subject)"}
            </h3>
            <p className="text-xs text-[#888888] truncate">
              From <span className="text-[#cccccc] font-mono">{email.from}</span>
              {" → "}
              <span className="text-[#cccccc] font-mono">{email.to}</span>
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Meta */}
        <div className="shrink-0 px-5 py-2 border-b border-[#2a2a2a] bg-[#0d0d0d]">
          <div className="flex items-center gap-1.5 text-xs text-[#666666]">
            <Clock className="h-3 w-3" />
            <span>{new Date(email.date).toLocaleString()}</span>
          </div>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4">
            <EmailBody body={email.body} format={format} />
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-[#2a2a2a] flex items-center justify-between">
          <span className="text-xs text-[#555555]">
            This message will be destroyed when the session expires.
          </span>
          <Button size="sm" variant="outline" onClick={onClose} className="gap-1.5">
            Close
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function EmailBody({ body, format }: { body: string; format: string }) {
  // If the user prefers plain text, strip all HTML tags and render as text.
  if (format === "text") {
    const plain = body.replace(/<[^>]*>/g, "")
    return (
      <pre className="text-sm text-[#cccccc] whitespace-pre-wrap break-words font-sans leading-relaxed">
        {plain || "(empty body)"}
      </pre>
    )
  }

  // If it looks like HTML, render with dangerouslySetInnerHTML (sanitized of
  // scripts). Otherwise show as preformatted text.
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(body)

  if (isHtml) {
    // Strip <script> tags and event handlers — basic XSS hardening.
    const cleaned = body
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
      .replace(/javascript:/gi, "")
    return (
      <div
        className="text-sm text-[#cccccc] prose prose-invert prose-sm max-w-none [&_a]:text-white [&_a]:underline"
        dangerouslySetInnerHTML={{ __html: cleaned }}
      />
    )
  }

  return (
    <pre className="text-sm text-[#cccccc] whitespace-pre-wrap break-words font-sans leading-relaxed">
      {body || "(empty body)"}
    </pre>
  )
}
