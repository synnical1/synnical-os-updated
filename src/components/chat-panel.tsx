"use client"

import * as React from "react"
import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { getChatSocket, setReadingChannel, useChatUnread } from "@/lib/chat-realtime"
import { type Socket } from "socket.io-client"
import { messageNotification } from "@/lib/chat-mentions"
import { api, type Channel, type ChatMessage, type SafeUser, type Role } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Hash, Plus, Send, Loader2, Users, MoreVertical, Trash2, VolumeX, Volume2, MessageSquare,
  Pencil, Quote, Reply, Flag, X, Search, SmilePlus, Lock, Shield, Pin, Folder, SlidersHorizontal, Star, CalendarDays, Link2, ImageIcon, Bookmark, Languages, History, ListTree, Clapperboard,
} from "lucide-react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { RoleBadge, DisplayName, AvatarWithDeco, TagsDisplay } from "@/components/role-ui"
import { readSetting, useSetting } from "@/lib/settings-runtime"
import { useViewProfile } from "@/components/user-profile-modal"
import { SYNN_BOT_COMMANDS, type SynnBotCommand } from "@/lib/synn-bot"
import { canDeleteMessage } from "@/lib/message-permissions"
import { onlineDurationLabel, presenceSectionLabel, publicPresenceLabel, type PresenceMode, type RichPresenceActivity } from "@/lib/presence"
import { VoiceRecorder, VoiceMessage } from "@/components/voice-recorder"
import { CHAT_EMOJI_CATEGORIES } from "@/lib/chat-emojis"
import { gifUploadError } from "@/lib/media-limits"
import {
  canManageChannels,
  channelAudienceFromRoleList,
  type ChannelAudience,
} from "@/lib/channel-permissions"

type PresenceUser = {
  activity?: RichPresenceActivity | null
  userId: string
  username: string
  displayName: string
  pfpUrl: string | null
  pfpIsGif: boolean
  role: Role
  avatarDeco: string | null
  muted: boolean
  mutedUntil: string | null
  tags: string[]
  presenceMode?: PresenceMode
  presenceModeExpiresAt?: string | null
  afk?: boolean
  afkMessage?: string
  currentSection?: string | null
  deviceType?: "desktop" | "mobile" | "tablet" | "unknown" | null
  networkQuality?: "good" | "fair" | "poor" | "unknown" | null
  onlineSince?: string | null
}

type DmInfo = { id: string; otherId: string; otherName: string }
type ChannelPref = { channelId: string; pinned: boolean; folder: string; notificationLevel: string; notificationSound: string; draft: string; lastReadMessageId?: string | null; priority?: boolean; snoozedUntil?: string | null; dealLater?: boolean; catchUpMessageId?: string | null; privateNote?: string }
type GifResult = {
  id: string
  title: string
  url: string
  previewUrl: string
  username?: string
  analytics?: { onload?: string | null; onclick?: string | null; onsent?: string | null }
}
type GiphyApiResult = {
  id?: unknown
  title?: unknown
  username?: unknown
  images?: {
    fixed_width?: { url?: unknown }
    fixed_width_small?: { url?: unknown }
    fixed_height?: { url?: unknown }
    downsized?: { url?: unknown }
    downsized_medium?: { url?: unknown }
    preview_gif?: { url?: unknown }
    original?: { url?: unknown }
  }
  analytics?: { onload?: { url?: unknown }; onclick?: { url?: unknown }; onsent?: { url?: unknown } }
}

const STAFF_COMMANDS: SynnBotCommand[] = [
  { name: "mute", usage: "/mute @username", description: "Mute a member with a reason and duration", category: "Moderation", kind: "local" },
  { name: "warn", usage: "/warn @username", description: "Warn a member", category: "Moderation", kind: "local" },
  { name: "ban", usage: "/ban @username", description: "Permanently ban a member", category: "Moderation", kind: "local" },
  { name: "unban", usage: "/unban @username", description: "Revoke a permanent ban", category: "Moderation", kind: "local" },
]

function canModerate(role: Role) { return role === "OWNER" || role === "HEAD_ADMIN" || role === "ADMIN" || role === "MOD" }

function containsExactMention(content: string, username: string): boolean {
  if (!content || !username) return false
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?=$|[^A-Za-z0-9_])`, "i").test(content)
}

/* ----------------------------- Sound (Web Audio) ---------------------------- */

const LEGACY_SOUND_KEY = "synnical-chat-sound"
const GIPHY_RANDOM_ID_KEY = "synnical:giphy-random-id"

function chatClientNonce(): string {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")
  } catch {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  }
}

function giphyRandomId(): string {
  try {
    const existing = localStorage.getItem(GIPHY_RANDOM_ID_KEY)
    if (existing && /^[a-f0-9-]{20,80}$/i.test(existing)) return existing
    const value = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")
    localStorage.setItem(GIPHY_RANDOM_ID_KEY, value)
    return value
  } catch {
    return "anonymous-session"
  }
}

function registerGiphyAction(value?: string | null): void {
  if (!value) return
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.hostname !== "giphy-analytics.giphy.com" || url.pathname !== "/v2/pingback_simple") return
    url.searchParams.set("random_id", giphyRandomId())
    url.searchParams.set("ts", Date.now().toString())
    void fetch(url, { method: "GET", mode: "no-cors", keepalive: true }).catch(() => {})
  } catch {}
}

function directGiphyGifUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || !/^(?:media(?:[0-9]+)?|i)\.giphy\.com$/i.test(url.hostname)) return null
    if (url.username || url.password || !url.pathname.toLowerCase().endsWith(".gif")) return null
    url.hostname = "media.giphy.com"
    return url.toString()
  } catch { return null }
}

function directGiphyAnalyticsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.hostname !== "giphy-analytics.giphy.com" || url.pathname !== "/v2/pingback_simple") return null
    if (!url.searchParams.has("analytics_response_payload")) return null
    return url.toString()
  } catch { return null }
}

let audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor) audioCtx = new Ctor()
  }
  return audioCtx
}

function playMessageSound(tone = "default") {
  const ctx = getAudioCtx()
  if (!ctx) return
  if (ctx.state === "suspended") ctx.resume().catch(() => { /* ignore */ })

  // Chat volume and global Output Volume are both real gain controls. Keep
  // notification gain bounded so 100% remains audible without clipping.
  const notificationVolume = Math.max(0, Math.min(100, readSetting("chat.notificationVolume", 80)))
  const outputVolume = Math.max(0, Math.min(100, readSetting("voice.outputVolume", 100)))
  const vol = (notificationVolume / 100) * (outputVolume / 100) * 0.25

  const outputDevice = readSetting("voice.outputDevice", "default")
  const sinkContext = ctx as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }
  if (typeof sinkContext.setSinkId === "function") {
    void sinkContext.setSinkId(outputDevice === "default" ? "" : outputDevice).catch(() => {})
  }

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = tone === "pulse" ? "square" : tone === "soft" ? "sine" : "triangle"
  const startHz = tone === "low" ? 520 : tone === "bright" ? 1120 : tone === "soft" ? 760 : 880
  const endHz = tone === "low" ? 390 : tone === "bright" ? 840 : tone === "soft" ? 620 : 660
  osc.frequency.setValueAtTime(startHz, now)
  osc.frequency.exponentialRampToValueAtTime(endHz, now + 0.08)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(vol, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
  osc.start(now)
  osc.stop(now + 0.12)
}

/* ------------------------------ Mention pills ------------------------------ */

function MentionPill({ name, onClick }: { name: string; onClick: () => void }) {
  let mentionColor = "#5865f2"
  try {
    const raw = localStorage.getItem("synnical:settings:chat.mentionColor")
    if (raw) mentionColor = JSON.parse(raw)
  } catch {}
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ backgroundColor: `${mentionColor}33`, color: mentionColor }}
      className="px-1 rounded hover:opacity-80 transition-opacity inline"
    >
      @{name}
    </button>
  )
}

/** Recursively walk a ReactNode tree and replace `@username` strings with pills. */
function processMentions(node: React.ReactNode, onMention: (name: string) => void): React.ReactNode {
  const handle = (n: React.ReactNode, keyPrefix: string): React.ReactNode => {
    if (typeof n === "string") {
      const parts = n.split(/(@[a-zA-Z0-9_]+)/g)
      if (parts.length === 1) return n
      return parts.map((part, i) => {
        const k = `${keyPrefix}-${i}`
        if (part.startsWith("@") && part.length > 1) {
          return <MentionPill key={k} name={part.slice(1)} onClick={() => onMention(part.slice(1))} />
        }
        return <Fragment key={k}>{part || null}</Fragment>
      })
    }
    if (Array.isArray(n)) {
      return n.map((child, i) => (
        <Fragment key={`${keyPrefix}-a-${i}`}>{handle(child, `${keyPrefix}-a-${i}`)}</Fragment>
      ))
    }
    if (React.isValidElement(n)) {
      const tag = n.type
      // Don't recurse into links/code — preserve verbatim
      if (tag === "a" || tag === "code") return n
      const childProps = (n.props || {}) as { children?: React.ReactNode }
      const newChildren = handle(childProps.children, `${keyPrefix}-c`)
      return React.cloneElement(n, {}, newChildren)
    }
    return n
  }
  return handle(node, "root")
}

function CommandBrowser({ commands, onSelect }: { commands: SynnBotCommand[]; onSelect: (name: string) => void }) {
  const rowHeight = 44
  const viewportHeight = 256
  const overscan = 4
  const [scrollTop, setScrollTop] = useState(0)
  useEffect(() => setScrollTop(0), [commands])
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2
  const visible = commands.slice(start, start + visibleCount)

  return (
    <div className="absolute bottom-full left-3 z-20 mb-1 w-80 overflow-hidden rounded-md border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] shadow-md">
      <p className="border-b border-[var(--synnical-border)] px-2 py-1.5 text-[10px] uppercase tracking-wide text-[var(--synnical-muted)]">Synn Bot commands — {commands.length} match{commands.length === 1 ? "" : "es"}</p>
      <div className="max-h-64 overflow-y-auto custom-scroll" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div className="relative" style={{ height: commands.length * rowHeight }}>
          <div className="absolute inset-x-0" style={{ top: start * rowHeight }}>
            {visible.map((command) => (
              <button key={command.name} type="button" onClick={() => onSelect(command.name)} className="flex h-11 w-full items-center gap-3 px-3 text-left hover:bg-[var(--synnical-accent)]/10">
                <code className="max-w-32 shrink-0 truncate text-xs text-[var(--synnical-accent)]">{command.usage}</code>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs text-[var(--synnical-muted)]">{command.description}</span><span className="block text-[9px] uppercase tracking-wide text-[var(--synnical-muted)]/65">{command.category}</span></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------- Chat panel ------------------------------- */

export function ChatPanel() {
  const { user } = useAuth()
  const viewProfile = useViewProfile()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([])
  const [directory, setDirectory] = useState<SafeUser[]>([])
  type EpisodeSpoilerContext = { mediaType: "movie" | "tv"; mediaId: string; title: string; season: number | null; episode: number | null; episodeName?: string | null; updatedAt?: number }
  const readEpisodeSpoilerContext = (): EpisodeSpoilerContext | null => {
    if (typeof window === "undefined") return null
    try {
      const parsed = JSON.parse(localStorage.getItem("synnical:synnflix:last-context") || "null")
      if (!parsed || (parsed.mediaType !== "movie" && parsed.mediaType !== "tv") || typeof parsed.mediaId !== "string" || typeof parsed.title !== "string") return null
      if (parsed.mediaType === "tv" && (!Number.isInteger(Number(parsed.season)) || !Number.isInteger(Number(parsed.episode)))) return null
      return { mediaType: parsed.mediaType, mediaId: parsed.mediaId.slice(0, 128), title: parsed.title.slice(0, 160), season: parsed.mediaType === "tv" ? Number(parsed.season) : null, episode: parsed.mediaType === "tv" ? Number(parsed.episode) : null, episodeName: typeof parsed.episodeName === "string" ? parsed.episodeName.slice(0, 160) : null, updatedAt: Number(parsed.updatedAt) || undefined }
    } catch { return null }
  }
  const [draft, setDraft] = useState("")
  const deferredDraft = useDeferredValue(draft)
  const [episodeSpoiler, setEpisodeSpoiler] = useState<EpisodeSpoilerContext | null>(null)
  const [spoilerDays, setSpoilerDays] = useState(30)
  const [newChannel, setNewChannel] = useState("")
  const [newChannelAudience, setNewChannelAudience] = useState<ChannelAudience>("MEMBERS")
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [typingUsers, setTypingUsers] = useState<{ userId: string; username: string }[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)
  const [threadRootForComposer, setThreadRootForComposer] = useState<string | null>(null)
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  const [gifQuery, setGifQuery] = useState("")
  const [gifResults, setGifResults] = useState<GifResult[]>([])
  const [gifLoading, setGifLoading] = useState(false)
  const [gifError, setGifError] = useState("")
  const [imageUploading, setImageUploading] = useState(false)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const [chatVisible, setChatVisible] = useState(false)
  const seenMessageIds = useRef(new Set<string>())
  const { unread: unreadByChannel, mentions: mentionsByChannel } = useChatUnread()
  const [reportingMessage, setReportingMessage] = useState<ChatMessage | null>(null)
  const [reportCategory, setReportCategory] = useState("HARASSMENT")
  const [reportReason, setReportReason] = useState("")
  const [reportBusy, setReportBusy] = useState(false)
  const loadedGifAnalytics = useRef(new Set<string>())
  const typingLastSentAt = useRef(0)
  const typingStopTimer = useRef<number | null>(null)

  // New feature state
  const [soundEnabled, setSoundEnabled] = useSetting<boolean>("chat.notificationSound", true)
  const [dmChannels, setDmChannels] = useState<DmInfo[]>([])
  const [channelPrefs, setChannelPrefs] = useState<Record<string, ChannelPref>>({})
  const [chatToolsOpen, setChatToolsOpen] = useState(false)
  const [chatToolMessage, setChatToolMessage] = useState<ChatMessage | null>(null)
  const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const prependScrollRestoreRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
  const initialHistoryScrollRef = useRef(false)
  const autoScrollNextRef = useRef(false)
  const historyRequestRef = useRef<{ channelId: string; beforeId: string } | null>(null)
  const composerRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef("")
  const draftSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (draftSyncTimerRef.current) clearTimeout(draftSyncTimerRef.current) }, [])
  const typingExpiryTimersRef = useRef(new Map<string, number>())
  const pendingMessageTimersRef = useRef(new Map<string, number>())
  const replaceDraft = useCallback((value: string | ((current: string) => string)) => {
    if (draftSyncTimerRef.current) clearTimeout(draftSyncTimerRef.current)
    const next = typeof value === "function" ? value(draftRef.current) : value
    draftRef.current = next
    if (composerRef.current && composerRef.current.value !== next) composerRef.current.value = next
    setDraft(next)
  }, [])
  useEffect(() => { messagesRef.current = messages }, [messages])
  // Refs that hold the latest values, so socket listeners (registered once per
  // active-channel change) always see fresh data without re-subscribing.
  const soundRef = useRef(soundEnabled)
  useEffect(() => { soundRef.current = soundEnabled }, [soundEnabled])
  const dmRef = useRef(dmChannels)
  useEffect(() => { dmRef.current = dmChannels }, [dmChannels])
  const prefsRef = useRef(channelPrefs)
  useEffect(() => { prefsRef.current = channelPrefs }, [channelPrefs])
  const activeChannelRef = useRef(activeChannel)
  useEffect(() => { activeChannelRef.current = activeChannel }, [activeChannel])
  useEffect(() => { setReplyingTo(null) }, [activeChannel])
  const userIdRef = useRef<string | null>(user?.id ?? null)
  useEffect(() => { userIdRef.current = user?.id ?? null }, [user])
  const usernameRef = useRef(user?.username ?? "")
  useEffect(() => { usernameRef.current = user?.username ?? "" }, [user])
  const chatVisibleRef = useRef(false)
  const joinedPublicChannelsRef = useRef<Set<string>>(new Set())

  const clearPendingMessageTimer = useCallback((clientNonce: string) => {
    const timer = pendingMessageTimersRef.current.get(clientNonce)
    if (timer !== undefined) window.clearTimeout(timer)
    pendingMessageTimersRef.current.delete(clientNonce)
  }, [])

  useEffect(() => () => {
    for (const timer of pendingMessageTimersRef.current.values()) window.clearTimeout(timer)
    pendingMessageTimersRef.current.clear()
  }, [])

  useEffect(() => {
    const publishVisibility = (visible: boolean) => {
      chatVisibleRef.current = visible
      setChatVisible(visible)
      setReadingChannel(visible ? activeChannelRef.current : null)
    }
    publishVisibility(document.documentElement.dataset.synnicalPanel === "chat" && document.visibilityState === "visible")
    const receive = (event: Event) => publishVisibility(Boolean((event as CustomEvent<{ visible?: boolean }>).detail?.visible))
    const visibility = () => publishVisibility(document.documentElement.dataset.synnicalPanel === "chat" && !document.hidden)
    document.addEventListener("visibilitychange", visibility)
    window.addEventListener("synnical-chat-visibility", receive)
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("synnical-chat-visibility", receive) }
  }, [])

  useEffect(() => {
    setReadingChannel(chatVisible ? activeChannel : null)
    return () => setReadingChannel(null)
  }, [activeChannel, chatVisible])

  // One-time migration for the pre-settings sound toggle. After migration the
  // shared setting is the single source of truth for both Chat and Settings.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("synnical:settings:chat.notificationSound") === null) {
        const legacy = window.localStorage.getItem(LEGACY_SOUND_KEY)
        if (legacy !== null) setSoundEnabled(legacy === "1")
      }
      window.localStorage.removeItem(LEGACY_SOUND_KEY)
    } catch { /* ignore */ }
  }, [setSoundEnabled])

  const toggleSound = useCallback(() => {
    const next = !soundRef.current
    setSoundEnabled(next)
    if (next) playMessageSound()
  }, [setSoundEnabled])

  const loadChannelPreferences = useCallback(async () => {
    if (!user) { setChannelPrefs({}); return }
    try {
      const res = await fetch("/api/features/chat?action=preferences", { credentials: "include", cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Could not load chat preferences")
      const next: Record<string, ChannelPref> = {}
      for (const row of body.preferences || []) next[row.channelId] = row
      setChannelPrefs(next)
    } catch {}
  }, [user])

  const setChannelPreference = useCallback(async (channelId: string, patch: Partial<ChannelPref>) => {
    if (!channelId) return
    const base = prefsRef.current[channelId]
    const optimistic: ChannelPref = {
      channelId,
      pinned: patch.pinned ?? base?.pinned ?? false,
      folder: patch.folder ?? base?.folder ?? "",
      notificationLevel: patch.notificationLevel ?? base?.notificationLevel ?? "all",
      notificationSound: patch.notificationSound ?? base?.notificationSound ?? "default",
      draft: patch.draft ?? base?.draft ?? "",
      lastReadMessageId: patch.lastReadMessageId ?? base?.lastReadMessageId ?? null,
      priority: patch.priority ?? base?.priority ?? false,
      snoozedUntil: patch.snoozedUntil !== undefined ? patch.snoozedUntil : base?.snoozedUntil ?? null,
      dealLater: patch.dealLater ?? base?.dealLater ?? false,
      catchUpMessageId: patch.catchUpMessageId !== undefined ? patch.catchUpMessageId : base?.catchUpMessageId ?? null,
      privateNote: patch.privateNote ?? base?.privateNote ?? "",
    }
    setChannelPrefs((current) => ({ ...current, [channelId]: optimistic }))
    prefsRef.current = { ...prefsRef.current, [channelId]: optimistic }
    const res = await fetch("/api/features/chat", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-preference", channelId, ...patch }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { void loadChannelPreferences(); throw new Error(body?.error || "Could not save chat preference") }
    window.dispatchEvent(new Event("synnical-chat-preferences-changed"))
    if (body.preference) {
      setChannelPrefs((current) => ({ ...current, [channelId]: body.preference }))
      prefsRef.current = { ...prefsRef.current, [channelId]: body.preference }
    }
  }, [loadChannelPreferences])

  useEffect(() => {
    if (!activeChannel || !chatVisibleRef.current || messages.length === 0) return
    const last = [...messages].reverse().find((candidate) => !candidate.pendingLocal && !candidate.failedLocal)
    if (!last) return
    const timer = window.setTimeout(() => { void setChannelPreference(activeChannel, { lastReadMessageId: last.id }).catch(() => {}) }, 1800)
    return () => window.clearTimeout(timer)
  }, [activeChannel, messages, setChannelPreference, chatVisible])

  const loadChannels = useCallback(async () => {
    try {
      const { channels } = await api.listChannels()
      setChannels(channels)
      setActiveChannel((current) => current && channels.some((channel) => channel.id === current) ? current : channels[0]?.id || null)
    } catch { toast.error("Failed to load channels") }
    finally { setLoadingChannels(false) }
  }, [])

  useEffect(() => { loadChannels() }, [loadChannels])
  useEffect(() => { void loadChannelPreferences() }, [loadChannelPreferences])

  useEffect(() => () => {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
  }, [])

  useEffect(() => {
    if (!user) { setDirectory([]); return }
    let cancelled = false
    void api.listChatUsers().then(({ users }) => { if (!cancelled) setDirectory(users) }).catch(() => {})
    return () => { cancelled = true }
  }, [user])

  // Establish socket connection
  useEffect(() => {
    // Socket.IO lives on the SAME origin as the app (custom server in server.ts).
    // NEXT_PUBLIC_SOCKET_URL is a *path* ("/socket.io"), so it must be passed as
    // `path`, NOT as the first argument. Passing "/socket.io" as the URL makes
    // socket.io-client treat it as a NAMESPACE, which the server does not define —
    // the handshake then fails with "Invalid namespace" and the client retries
    // forever, which is what caused the permanent "reconnecting…" state.
    joinedPublicChannelsRef.current.clear()
    if (!user) return
    const s = getChatSocket(user.id)
    setSocket(s)
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    s.on("connect", onConnect)
    s.on("disconnect", onDisconnect)
    setConnected(s.connected)
    const onMuteError = (data: { message: string; clientNonce?: string }) => {
      if (data.clientNonce) {
        clearPendingMessageTimer(data.clientNonce)
        setMessages((current) => current.map((candidate) => candidate.clientNonce === data.clientNonce
          ? { ...candidate, pendingLocal: false, failedLocal: true }
          : candidate))
      }
      toast.error(data.message)
    }
    s.on("mute-error", onMuteError)
    return () => { s.off("connect", onConnect); s.off("disconnect", onDisconnect); s.off("mute-error", onMuteError) }
  }, [clearPendingMessageTimer, user?.id])

  // The member rail is global, not limited to whichever channel is open.
  useEffect(() => {
    if (!socket || !connected) return
    const receive = (data: { users?: PresenceUser[] }) => {
      const users = Array.isArray(data.users) ? data.users : []
      setOnlineUsers(users)
      window.dispatchEvent(new CustomEvent("synnical-chat-online-users", { detail: { users } }))
    }
    socket.on("online-users", receive)
    socket.emit("who-is-online")
    return () => { socket.off("online-users", receive) }
  }, [socket, connected])

  useEffect(() => {
    if (!socket || !connected) return
    const refresh = () => { void loadChannels() }
    socket.on("channels-updated", refresh)
    return () => { socket.off("channels-updated", refresh) }
  }, [socket, connected, loadChannels])

  // After connecting, fetch the user's DM channels and silently join each so
  // we receive "message" events for them (used for DM notifications + sound).
  useEffect(() => {
    if (!socket || !connected || !user) return
    let cancelled = false
    const load = () => { void api.listDMs().then(({ dms }) => {
      if (cancelled) return
      const mapped: DmInfo[] = dms.map((d) => ({
        id: d.id,
        otherId: d.other.id,
        otherName: d.other.displayName || d.other.username,
      }))
      setDmChannels(mapped)
      dmRef.current = mapped
      // Silently join each DM channel so we receive its messages
      for (const d of mapped) socket.emit("join-channel", { channelId: d.id, history: false })
    }).catch(() => { /* Retry on reconnect or the next channel event. */ }) }
    load()
    socket.on("dm-created", load)
    return () => { cancelled = true; socket.off("dm-created", load) }
  }, [socket, connected, user])

  // Join the active channel and bind its event handlers
  useEffect(() => {
    if (!socket || !activeChannel || !connected) return
    setMessages((current) => current.filter((message) => message.channelId === activeChannel && (message.pendingLocal || message.failedLocal)))
    messagesRef.current = []
    setHasOlderMessages(false)
    setLoadingOlderMessages(false)
    historyRequestRef.current = null
    prependScrollRestoreRef.current = null
    initialHistoryScrollRef.current = false
    setPresence([])
    socket.emit("join-channel", { channelId: activeChannel, history: true })

    const onHistory = (data: { channelId: string; messages: ChatMessage[]; hasMore?: boolean }) => {
      if (data.channelId !== activeChannel) return
      initialHistoryScrollRef.current = true
      setHasOlderMessages(Boolean(data.hasMore))
      setLoadingOlderMessages(false)
      historyRequestRef.current = null
      setMessages((current) => {
        const pendingLocal = current.filter((candidate) => candidate.pendingLocal || candidate.failedLocal)
        const serverIds = new Set(data.messages.map((candidate) => candidate.id))
        const unresolved = pendingLocal.filter((candidate) => {
          const confirmed = serverIds.has(candidate.id) || data.messages.some((message) => message.clientNonce && message.clientNonce === candidate.clientNonce && message.userId === candidate.userId)
          if (confirmed && candidate.clientNonce) clearPendingMessageTimer(candidate.clientNonce)
          return !confirmed
        })
        return [...data.messages, ...unresolved]
      })
      const lastRead = prefsRef.current[data.channelId]?.lastReadMessageId
      if (lastRead) {
        const index = data.messages.findIndex((message) => message.id === lastRead)
        setFirstUnreadMessageId(index >= 0 && index + 1 < data.messages.length ? data.messages[index + 1].id : null)
      } else {
        setFirstUnreadMessageId(data.messages[0]?.id || null)
      }
    }
    socket.on("message-history", onHistory)

    const onOlderHistory = (data: { channelId: string; beforeId: string; messages: ChatMessage[]; hasMore?: boolean }) => {
      if (data.channelId !== activeChannelRef.current) return
      const pending = historyRequestRef.current
      if (!pending || pending.channelId !== data.channelId || pending.beforeId !== data.beforeId) return
      historyRequestRef.current = null
      setLoadingOlderMessages(false)
      setHasOlderMessages(Boolean(data.hasMore))
      if (!Array.isArray(data.messages) || data.messages.length === 0) {
        prependScrollRestoreRef.current = null
        return
      }
      setMessages((current) => {
        const existing = new Set(current.map((message) => message.id))
        const older = data.messages.filter((message) => !existing.has(message.id))
        return older.length ? [...older, ...current] : current
      })
    }
    socket.on("older-message-history", onOlderHistory)

    const onMessage = (msg: ChatMessage) => {
      if (seenMessageIds.current.has(msg.id)) return
      seenMessageIds.current.add(msg.id)
      if (seenMessageIds.current.size > 2000) seenMessageIds.current.delete(seenMessageIds.current.values().next().value!)
      const myId = userIdRef.current
      const fromSelf = !!myId && msg.userId === myId
      const active = activeChannelRef.current
      const pref = prefsRef.current[msg.channelId]
      const mentionedMe = messageNotification(msg, myId || "")
      const shouldNotify = mentionedMe && pref?.notificationLevel !== "mute"
      // Append to active channel view only if it belongs to the active channel
      if (msg.channelId === active) {
        const el = scrollRef.current
        const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight <= 140
        autoScrollNextRef.current = readSetting("chat.autoScroll", true) && nearBottom
        setMessages((prev) => {
          const pendingIndex = msg.clientNonce
            ? prev.findIndex((candidate) => (candidate.pendingLocal || candidate.failedLocal) && candidate.clientNonce === msg.clientNonce && candidate.userId === msg.userId)
            : -1
          if (pendingIndex >= 0) {
            clearPendingMessageTimer(msg.clientNonce!)
            const next = [...prev]
            next[pendingIndex] = { ...msg, pendingLocal: false, failedLocal: false }
            return next.filter((candidate, index) => candidate.id !== msg.id || index === pendingIndex)
          }
          return prev.some((candidate) => candidate.id === msg.id) ? prev : [...prev, msg]
        })
      }
      if (shouldNotify && soundRef.current) playMessageSound(pref?.notificationSound || "default")

    }
    socket.on("message", onMessage)
    const onBotCommand = (result: { clientNonce?: string; message: string; ok: boolean }) => {
      if (result.clientNonce) { clearPendingMessageTimer(result.clientNonce); setMessages(rows => rows.filter(row => row.clientNonce !== result.clientNonce)) }
      if (result.ok) toast.success(`Synnbot: ${result.message}`)
      else toast.error(`Synnbot: ${result.message}`)
    }
    socket.on("bot-command-result", onBotCommand)


    const onDeleted = (data: { id: string; channelId: string }) => {
      if (data.channelId !== activeChannelRef.current) return
      setMessages((prev) => prev.map((m) => (m.id === data.id ? { ...m, deleted: true, content: "" } : m)))
    }
    socket.on("message-deleted", onDeleted)

    const onEdited = (data: { id: string; channelId: string; content: string; editedAt: string }) => {
      if (data.channelId !== activeChannelRef.current) return
      setMessages((prev) => prev.map((m) => (m.id === data.id ? { ...m, content: data.content, edited: true } : m)))
    }
    socket.on("message-edited", onEdited)

    const onReactions = (data: { messageId: string; channelId: string; reactions: { emoji: string; userId: string }[] }) => {
      if (data.channelId !== activeChannelRef.current || !Array.isArray(data.reactions)) return
      const grouped = new Map<string, { emoji: string; count: number; reacted: boolean }>()
      for (const row of data.reactions) {
        const value = grouped.get(row.emoji) || { emoji: row.emoji, count: 0, reacted: false }
        value.count += 1
        if (row.userId === userIdRef.current) value.reacted = true
        grouped.set(row.emoji, value)
      }
      const reactions = [...grouped.values()].sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji))
      setMessages((current) => current.map((message) => message.id === data.messageId ? { ...message, reactions } : message))
    }
    socket.on("message-reactions", onReactions)

    const onTyping = (data: { channelId: string; userId: string; username: string; isTyping: boolean }) => {
      if (data.channelId !== activeChannelRef.current) return
      if (data.userId === userIdRef.current) return
      // Use the flag from the PAYLOAD — the previous code read the component's
      // own `isTyping` state here, so remote typing state was never applied.
      setTypingUsers((prev) => {
        const next = data.isTyping
          ? [...prev.filter((u) => u.userId !== data.userId), { userId: data.userId, username: data.username }]
          : prev.filter((u) => u.userId !== data.userId)
        return next
      })
      const previous = typingExpiryTimersRef.current.get(data.userId)
      if (previous !== undefined) window.clearTimeout(previous)
      typingExpiryTimersRef.current.delete(data.userId)
      if (data.isTyping) {
        typingExpiryTimersRef.current.set(data.userId, window.setTimeout(() => {
          typingExpiryTimersRef.current.delete(data.userId)
          setTypingUsers((prev) => prev.filter((u) => u.userId !== data.userId))
        }, 3000))
      }
    }
    socket.on("typing", onTyping)

    const onPresence = (data: { channelId: string; users: PresenceUser[] }) => {
      if (data.channelId === activeChannelRef.current) setPresence(data.users)
    }
    socket.on("presence", onPresence)

    return () => {
      for (const timer of typingExpiryTimersRef.current.values()) window.clearTimeout(timer)
      typingExpiryTimersRef.current.clear()
      setTypingUsers([])
      socket.off("message-history", onHistory)
      socket.off("older-message-history", onOlderHistory)
      socket.off("message", onMessage)
      socket.off("bot-command-result", onBotCommand)
      socket.off("message-deleted", onDeleted)
      socket.off("message-edited", onEdited)
      socket.off("message-reactions", onReactions)
      socket.off("typing", onTyping)
      socket.off("presence", onPresence)
    }
  }, [socket, activeChannel, connected, clearPendingMessageTimer])

  // Stay subscribed only to public channels returned by the authenticated
  // channel catalogue. When permissions or roles change, immediately leave
  // rooms that disappeared from that catalogue so a stale socket cannot keep
  // receiving staff-only traffic after the UI hides the channel.
  useEffect(() => {
    if (!socket || !connected) return
    const next = new Set(channels.map((channel) => channel.id))
    for (const channelId of joinedPublicChannelsRef.current) {
      if (!next.has(channelId)) socket.emit("leave-channel", { channelId })
    }
    for (const channelId of next) {
      if (!joinedPublicChannelsRef.current.has(channelId)) socket.emit("join-channel", { channelId, history: false })
    }
    joinedPublicChannelsRef.current = next
  }, [socket, connected, channels])

  // Persist messages to localStorage so they survive page reloads.
  // We save the last 50 messages per channel.
  useEffect(() => {
    if (messages.length === 0 || !activeChannel) return
    const snapshot = messages.filter((candidate) => !candidate.pendingLocal && !candidate.failedLocal).slice(-50)
    if (snapshot.length === 0) return
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(`synnical-chat-messages:${activeChannel}`, JSON.stringify(snapshot)) } catch { /* ignore quota errors */ }
    }, 1_800)
    return () => window.clearTimeout(timer)
  }, [messages, activeChannel])

  useEffect(() => {
    if (!gifPickerOpen) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setGifLoading(true)
      setGifError("")
      const key = process.env.NEXT_PUBLIC_GIPHY_API_KEY?.trim()
      if (!key) {
        setGifLoading(false)
        setGifResults([])
        setGifError("GIPHY search is not configured")
        return
      }
      const query = gifQuery.trim().slice(0, 50)
      const endpoint = query ? "search" : "trending"
      const upstream = new URL(`https://api.giphy.com/v1/gifs/${endpoint}`)
      upstream.searchParams.set("api_key", key)
      upstream.searchParams.set("limit", "18")
      upstream.searchParams.set("rating", "g")
      upstream.searchParams.set("customer_id", giphyRandomId())
      if (query) {
        upstream.searchParams.set("q", query)
        upstream.searchParams.set("lang", "en")
      }
      fetch(upstream, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => ({})) as { data?: GiphyApiResult[]; meta?: { msg?: unknown } }
          if (!response.ok) throw new Error(typeof body.meta?.msg === "string" ? body.meta.msg : "GIF search failed")
          const mapped = (Array.isArray(body.data) ? body.data : []).flatMap((item): GifResult[] => {
            // GIPHY keys and rendition bundles do not all expose the same
            // subset. Try every official animated-GIF rendition we support so
            // a valid result cannot turn into an empty picker tile.
            const previewUrl = [
              item.images?.fixed_width?.url,
              item.images?.fixed_width_small?.url,
              item.images?.fixed_height?.url,
              item.images?.preview_gif?.url,
              item.images?.downsized?.url,
              item.images?.original?.url,
            ].map(directGiphyGifUrl).find(Boolean) || null
            const url = [
              item.images?.downsized_medium?.url,
              item.images?.downsized?.url,
              item.images?.original?.url,
              item.images?.fixed_width?.url,
            ].map(directGiphyGifUrl).find(Boolean) || previewUrl
            if (typeof item.id !== "string" || !previewUrl || !url) return []
            return [{
              id: item.id,
              title: typeof item.title === "string" && item.title.trim() ? item.title.slice(0, 120) : "GIF",
              username: typeof item.username === "string" ? item.username.slice(0, 80) : "",
              previewUrl,
              url,
              analytics: {
                onload: directGiphyAnalyticsUrl(item.analytics?.onload?.url),
                onclick: directGiphyAnalyticsUrl(item.analytics?.onclick?.url),
                onsent: directGiphyAnalyticsUrl(item.analytics?.onsent?.url),
              },
            }]
          })
          setGifResults(mapped)
        })
        .catch((reason: unknown) => {
          if (reason instanceof Error && reason.name === "AbortError") return
          setGifResults([])
          setGifError(reason instanceof Error ? reason.message : "GIF search failed")
        })
        .finally(() => { if (!controller.signal.aborted) setGifLoading(false) })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [gifPickerOpen, gifQuery])

  // Restore messages from localStorage when joining a channel (before
  // the socket delivers the fresh history from the server).
  useEffect(() => {
    if (!activeChannel) return
    try {
      const key = `synnical-chat-messages:${activeChannel}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored) as ChatMessage[]
        const confirmed = Array.isArray(parsed) ? parsed.filter((candidate) => !candidate.pendingLocal && !candidate.failedLocal) : []
        if (confirmed.length > 0) {
          initialHistoryScrollRef.current = true
          setMessages(confirmed)
        }
      }
    } catch { /* ignore */ }
  }, [activeChannel])

  const loadOlderMessages = useCallback(() => {
    if (!socket || !connected || !activeChannel || !hasOlderMessages || loadingOlderMessages) return
    const first = messagesRef.current[0]
    const el = scrollRef.current
    if (!first || !el) return
    historyRequestRef.current = { channelId: activeChannel, beforeId: first.id }
    prependScrollRestoreRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
    setLoadingOlderMessages(true)
    socket.emit("load-older-messages", { channelId: activeChannel, beforeId: first.id })
  }, [socket, connected, activeChannel, hasOlderMessages, loadingOlderMessages])

  const onMessageScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (event.currentTarget.scrollTop <= 96) loadOlderMessages()
  }, [loadOlderMessages])

  // Initial history goes to the newest message. Prepending an older page keeps
  // the exact visible message anchored in place instead of jumping the user to
  // the top or bottom. Live messages only auto-scroll if the user was already
  // near the bottom, so reading old history is not interrupted.
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const restore = prependScrollRestoreRef.current
    if (restore) {
      prependScrollRestoreRef.current = null
      el.scrollTop = restore.scrollTop + (el.scrollHeight - restore.scrollHeight)
      return
    }
    if (initialHistoryScrollRef.current) {
      initialHistoryScrollRef.current = false
      el.scrollTop = el.scrollHeight
      return
    }
    if (autoScrollNextRef.current) {
      autoScrollNextRef.current = false
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    const syncContext = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      if (detail && (detail.mediaType === "movie" || detail.mediaType === "tv")) {
        setEpisodeSpoiler((current) => current ? { mediaType: detail.mediaType, mediaId: String(detail.mediaId), title: String(detail.title), season: detail.mediaType === "tv" ? Number(detail.season) : null, episode: detail.mediaType === "tv" ? Number(detail.episode) : null, episodeName: detail.episodeName || null, updatedAt: Number(detail.updatedAt) || Date.now() } : null)
      }
    }
    window.addEventListener("synnical-media-context", syncContext as EventListener)
    return () => window.removeEventListener("synnical-media-context", syncContext as EventListener)
  }, [])

  /* ----------------------------- Send / edit / etc ----------------------------- */

  const executeModeration = useCallback(async (text: string) => {
    if (!user || !canModerate(user.role)) { toast.error("Moderation commands require a staff account"); return }
    const [rawCommand, rawTarget] = text.trim().split(/\s+/)
    const command = rawCommand.slice(1).toLowerCase()
    const username = (rawTarget || window.prompt("Member username") || "").replace(/^@/, "").toLowerCase()
    if (!username) return
    const target = directory.find((row) => row.username.toLowerCase() === username || row.id === username)
    if (!target) { toast.error("Member not found. Use the Moderation panel to search all accounts."); return }
    const reason = window.prompt(`Reason to ${command} @${target.username}`)?.trim()
    if (!reason) return
    let durationMin: number | undefined
    if (command === "mute") {
      const duration = window.prompt("Duration: 10m, 2h, 1d (or permanent)", "10m")?.trim().toLowerCase()
      if (!duration) return
      const match = /^(\d+)(m|h|d)$/.exec(duration)
      if (duration !== "permanent" && (!match || Number(match[1]) <= 0)) { toast.error("Choose a duration such as 10m, 2h or 1d"); return }
      if (match) durationMin = Number(match[1]) * (match[2] === "d" ? 1440 : match[2] === "h" ? 60 : 1)
      if (durationMin && durationMin > 525600) { toast.error("Duration must be at most one year"); return }
    }
    if (!window.confirm(`${command.toUpperCase()} @${target.username}? Reason: ${reason}`)) return
    try {
      const response = await fetch(command === "unban" ? "/api/moderation/unban" : "/api/infractions/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target.id, type: command.toUpperCase(), reason, durationMin }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Moderation failed")
      replaceDraft(""); toast.success(`${command} completed for @${target.username}`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Moderation failed") }
  }, [user, directory, replaceDraft])

  const send = useCallback((gifUrl?: string, imageUrl?: string) => {
    const text = draftRef.current.trim()
    if (!gifUrl && !imageUrl && /^\/(mute|warn|ban|unban)(?:\s|$)/i.test(text)) { void executeModeration(text); return }
    if (!text && !gifUrl && !imageUrl) return
    if (!socket || !connected || !activeChannel || !user) return
    const clientNonce = chatClientNonce()
    const payload: { channelId: string; content: string; clientNonce: string; gifUrl?: string; imageUrl?: string; replyToId?: string; threadRootId?: string; spoiler?: { mediaType: "movie" | "tv"; mediaId: string; title: string; season: number | null; episode: number | null; until: string } } = {
      channelId: activeChannel,
      content: text,
      clientNonce,
    }
    if (episodeSpoiler) payload.spoiler = { mediaType: episodeSpoiler.mediaType, mediaId: episodeSpoiler.mediaId, title: episodeSpoiler.title, season: episodeSpoiler.season, episode: episodeSpoiler.episode, until: new Date(Date.now() + spoilerDays * 86400000).toISOString() }
    if (gifUrl) payload.gifUrl = gifUrl
    if (imageUrl) payload.imageUrl = imageUrl
    if (replyingTo) payload.replyToId = replyingTo.id
    if (threadRootForComposer) payload.threadRootId = threadRootForComposer

    const pendingLocal: ChatMessage = {
      id: `pending:${clientNonce}`,
      clientNonce,
      pendingLocal: true,
      failedLocal: false,
      channelId: activeChannel,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      pfpUrl: user.pfpUrl,
      pfpIsGif: user.pfpIsGif,
      role: user.role,
      tags: user.tags,
      avatarDeco: user.avatarDeco,
      content: text,
      gifUrl: gifUrl || null,
      imageUrl: imageUrl || null,
      messageType: imageUrl ? "image" : threadRootForComposer ? "thread" : "text",
      threadRootId: threadRootForComposer,
      replyToId: replyingTo?.id || null,
      replyToName: replyingTo ? (replyingTo.displayName || replyingTo.username) : null,
      replyToContent: replyingTo ? (replyingTo.content.trim().slice(0, 180) || (replyingTo.imageUrl ? "Image" : replyingTo.gifUrl ? "GIF" : "Message")) : null,
      spoilerMediaType: episodeSpoiler?.mediaType || null,
      spoilerMediaId: episodeSpoiler?.mediaId || null,
      spoilerTitle: episodeSpoiler?.title || null,
      spoilerSeason: episodeSpoiler?.season || null,
      spoilerEpisode: episodeSpoiler?.episode || null,
      spoilerUntil: payload.spoiler?.until || null,
      createdAt: new Date().toISOString(),
      reactions: [],
    }
    autoScrollNextRef.current = true
    setMessages((current) => [...current, pendingLocal])
    const confirmationTimer = window.setTimeout(() => {
      pendingMessageTimersRef.current.delete(clientNonce)
      setMessages((current) => current.map((candidate) => candidate.clientNonce === clientNonce
        ? { ...candidate, pendingLocal: false, failedLocal: true }
        : candidate))
      toast.error("That message was not confirmed by the server. You can copy it and try again.")
    }, 12_000)
    pendingMessageTimersRef.current.set(clientNonce, confirmationTimer)

    socket.emit("send-message", payload)
    socket.emit("typing", { channelId: activeChannel, isTyping: false })
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
    typingLastSentAt.current = 0
    replaceDraft("")
    setEpisodeSpoiler(null)
    setReplyingTo(null)
    setThreadRootForComposer(null)
  }, [socket, connected, activeChannel, user, replyingTo, threadRootForComposer, episodeSpoiler, spoilerDays, replaceDraft, executeModeration])

  const uploadAndSendImage = useCallback(async (file: File | null | undefined) => {
    if (!file || !activeChannel || !connected) return
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.")
      return
    }
    const gifError = gifUploadError(file)
    if (gifError) {
      toast.error(gifError)
      return
    }
    setImageUploading(true)
    try {
      const { url } = await api.uploadChatImage(file)
      send(undefined, url)
      toast.success("Image sent")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed")
    } finally {
      setImageUploading(false)
      if (imageInputRef.current) imageInputRef.current.value = ""
    }
  }, [activeChannel, connected, send])

  const sendVoice = useCallback((voiceUrl: string) => {
    if (!socket || !connected || !activeChannel || !voiceUrl) return
    const payload: { channelId: string; content: string; voiceUrl: string; replyToId?: string; threadRootId?: string } = {
      channelId: activeChannel,
      content: "",
      voiceUrl,
    }
    if (replyingTo) payload.replyToId = replyingTo.id
    if (threadRootForComposer) payload.threadRootId = threadRootForComposer
    socket.emit("send-message", payload)
    setReplyingTo(null)
    setThreadRootForComposer(null)
  }, [socket, connected, activeChannel, replyingTo, threadRootForComposer])

  const onDraftChange = useCallback((v: string) => {
    const wasEmpty = !draftRef.current
    draftRef.current = v
    if (draftSyncTimerRef.current) clearTimeout(draftSyncTimerRef.current)
    if (wasEmpty !== !v || /^\//.test(v) || /@[a-zA-Z0-9_]*$/.test(v)) setDraft(v)
    else draftSyncTimerRef.current = setTimeout(() => setDraft(draftRef.current), 250)
    if (socket && connected && activeChannel) {
      const now = Date.now()
      if (!v) {
        socket.emit("typing", { channelId: activeChannel, isTyping: false })
        typingLastSentAt.current = 0
      } else if (typingLastSentAt.current === 0 || now - typingLastSentAt.current >= 2_000) {
        socket.emit("typing", { channelId: activeChannel, isTyping: true })
        typingLastSentAt.current = now
      }
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
      typingStopTimer.current = window.setTimeout(() => {
        socket.emit("typing", { channelId: activeChannel, isTyping: false })
        typingLastSentAt.current = 0
      }, 2_800)
    }
  }, [socket, connected, activeChannel, replaceDraft])

  useEffect(() => {
    if (!activeChannel) { replaceDraft(""); return }
    replaceDraft(prefsRef.current[activeChannel]?.draft || "")
  }, [activeChannel, replaceDraft])

  useEffect(() => {
    if (!activeChannel) return
    const timer = window.setTimeout(() => {
      if ((prefsRef.current[activeChannel]?.draft || "") === draft) return
      void setChannelPreference(activeChannel, { draft }).catch(() => {})
    }, 6_000)
    return () => window.clearTimeout(timer)
  }, [activeChannel, draft, setChannelPreference])

  // @mention autocomplete — show when draft ends with `@<partial>`
  const mentionCandidates = React.useMemo<SafeUser[]>(() => {
    const match = deferredDraft.match(/@([a-zA-Z0-9_]*)$/)
    if (!match) return []
    const q = match[1].toLowerCase()
    const seen = new Set<string>()
    const out: SafeUser[] = []
    for (const u of directory) {
      if (u.id === user?.id) continue
      if (q === "" || u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)) {
        if (seen.has(u.id)) continue
        seen.add(u.id)
        out.push(u)
        if (out.length >= 6) break
      }
    }
    return out
  }, [deferredDraft, directory, user?.id])

  const showMentionDropdown = mentionCandidates.length > 0

  const insertMention = useCallback((username: string) => {
    replaceDraft((prev) => prev.replace(/@([a-zA-Z0-9_]*)$/, `@${username} `))
  }, [replaceDraft])

  const commandCandidates = React.useMemo(() => {
    const match = deferredDraft.match(/^\/([a-zA-Z0-9-]*)$/)
    if (!match) return []
    const query = match[1].toLowerCase()
    return [...SYNN_BOT_COMMANDS, ...(user && canModerate(user.role) ? STAFF_COMMANDS : [])].filter((command) => command.name.startsWith(query))
  }, [deferredDraft, user])
  const showCommandDropdown = commandCandidates.length > 0 && !showMentionDropdown
  const insertCommand = useCallback((name: string) => replaceDraft(`/${name} `), [replaceDraft])

  const chooseGif = useCallback((gif: GifResult) => {
    registerGiphyAction(gif.analytics?.onclick)
    send(gif.url)
    registerGiphyAction(gif.analytics?.onsent)
    setGifPickerOpen(false)
    setGifQuery("")
  }, [send])

  const registerGifLoaded = useCallback((gif: GifResult) => {
    if (loadedGifAnalytics.current.has(gif.id)) return
    loadedGifAnalytics.current.add(gif.id)
    registerGiphyAction(gif.analytics?.onload)
  }, [])

  const startEdit = useCallback((m: ChatMessage) => { setEditingId(m.id); setEditContent(m.content) }, [])
  const cancelEdit = useCallback(() => { setEditingId(null); setEditContent("") }, [])

  const saveEdit = useCallback((m: ChatMessage) => {
    if (!socket) return
    api.editMessage(m.id, editContent).then(() => {
      socket.emit("edit-message", { messageId: m.id, channelId: m.channelId, content: editContent })
      cancelEdit()
      toast.success("Message edited")
    }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
  }, [socket, editContent, cancelEdit])

  const createChannel = useCallback(async () => {
    const name = newChannel.trim()
    if (!name) return
    try {
      const { channel } = await api.createChannel(name, newChannelAudience)
      setChannels((prev) => [...prev, channel])
      setActiveChannel(channel.id)
      setNewChannel("")
      setShowNewChannel(false)
      setNewChannelAudience("MEMBERS")
      socket?.emit("channels-changed", { audience: channel.audience || newChannelAudience })
      toast.success(`Channel #${channel.name} created`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed")
    }
  }, [newChannel, newChannelAudience, socket])

  const deleteChannel = useCallback(async (channel: Channel) => {
    if (!window.confirm(`Delete #${channel.name} and all of its messages?`)) return
    try {
      const result = await api.deleteChannel(channel.id)
      setChannels((current) => current.filter((item) => item.id !== channel.id))
      setActiveChannel((current) => current === channel.id ? null : current)
      socket?.emit("channels-changed", { audience: result.audience })
      toast.success(`Channel #${channel.name} deleted`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete channel")
    }
  }, [socket])

  const deleteMessage = useCallback((msg: ChatMessage) => {
    if (!socket || !user || !canDeleteMessage(user.role, user.id, msg.role, msg.userId)) return
    api.deleteMessage(msg.id).then(() => {
      socket.emit("delete-message", { messageId: msg.id, channelId: msg.channelId })
      toast.success("Message deleted")
    }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
  }, [socket, user])

  const toggleReaction = useCallback((msg: ChatMessage, emoji: string) => {
    if (!socket || !connected) return
    socket.emit("toggle-reaction", { messageId: msg.id, channelId: msg.channelId, emoji })
  }, [socket, connected])

  const startReply = useCallback((msg: ChatMessage) => {
    setThreadRootForComposer(null)
    setReplyingTo(msg)
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [])

  const startThreadReply = useCallback((msg: ChatMessage) => {
    setThreadRootForComposer(msg.threadRootId || msg.id)
    setReplyingTo(msg)
    setChatToolsOpen(false)
    setChatToolMessage(null)
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [])

  const jumpToMessage = useCallback(async (messageId: string) => {
    const reveal = () => {
      const element = document.getElementById(`message-${messageId}`)
      if (!element) return false
      element.scrollIntoView({ behavior: "smooth", block: "center" })
      element.classList.remove("synnical-reply-pulse")
      requestAnimationFrame(() => element.classList.add("synnical-reply-pulse"))
      window.setTimeout(() => element.classList.remove("synnical-reply-pulse"), 1400)
      return true
    }
    if (reveal()) return
    if (!activeChannel) { toast("Message is unavailable"); return }
    try {
      const qs = new URLSearchParams({ action: "around", channelId: activeChannel, messageId })
      const response = await fetch(`/api/features/chat?${qs}`, { credentials: "include", cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !Array.isArray(body.messages)) throw new Error(body?.error || "Message is unavailable")
      const recovered = body.messages as ChatMessage[]
      setMessages((current) => {
        const merged = new Map<string, ChatMessage>()
        for (const message of [...current, ...recovered]) merged.set(message.id, message)
        return [...merged.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      })
      window.setTimeout(() => { if (!reveal()) toast("Message could not be displayed") }, 80)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message is unavailable")
    }
  }, [activeChannel])

  useEffect(() => {
    const compose = (event: Event) => {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text
      if (typeof text === "string") { replaceDraft(text.slice(0, 4000)); requestAnimationFrame(() => composerRef.current?.focus()) }
    }
    const openMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: unknown; messageId?: unknown }>).detail
      if (typeof detail?.channelId !== "string") return
      setActiveChannel(detail.channelId)
      if (typeof detail.messageId === "string") window.setTimeout(() => jumpToMessage(detail.messageId as string), 700)
    }
    window.addEventListener("synnical-chat-compose", compose)
    window.addEventListener("synnical-chat-open-message", openMessage)
    return () => { window.removeEventListener("synnical-chat-compose", compose); window.removeEventListener("synnical-chat-open-message", openMessage) }
  }, [jumpToMessage, replaceDraft])

  const muteUser = async (u: PresenceUser) => {
    try {
      await api.muteUser(u.userId)
      toast.success(`${u.displayName} muted`)
      setPresence((prev) => prev.map((p) => (p.userId === u.userId ? { ...p, muted: true } : p)))
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
  }

  const unmuteUser = async (u: PresenceUser) => {
    try {
      await api.unmuteUser(u.userId)
      toast.success(`${u.displayName} unmuted`)
      setPresence((prev) => prev.map((p) => (p.userId === u.userId ? { ...p, muted: false } : p)))
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
  }

  // Click-to-DM: open a DM channel with the given user
  const openDM = useCallback(async (userId: string, name: string) => {
    if (!user || userId === user.id) return
    try {
      await api.createDM(userId)
      toast.success(`DM opened with ${name}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open DM")
    }
  }, [user])

  // @mention pill click → resolve username → open that account's profile.
  const handleMentionClick = useCallback((name: string) => {
    const match = directory.find((entry) => entry.username.toLowerCase() === name.toLowerCase())
    if (match) {
      viewProfile(match.id)
    } else {
      toast(`@${name} was not found`)
    }
  }, [directory, viewProfile])

  const quoteMessage = useCallback((m: ChatMessage) => {
    const authorName = (m.displayName || m.username).trim() || "User"
    const body = (m.content || (m.imageUrl ? "Image" : m.gifUrl ? "GIF" : m.voiceUrl ? "Voice message" : "Message")).trim().replace(/\n+/g, " ").slice(0, 500)
    const quoted = `> ${authorName}: ${body}\n\n`
    replaceDraft((current) => `${quoted}${current}`.slice(0, 4000))
    requestAnimationFrame(() => composerRef.current?.focus())
    toast.success("Quote added to your message")
  }, [replaceDraft])

  const saveQuoteCollection = useCallback(async (m: ChatMessage) => {
    const authorName = m.displayName || m.username
    try {
      await api.saveQuote(authorName, m.content, m.pfpUrl ?? undefined)
      toast.success("Saved to quote collection")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save quote")
    }
  }, [])

  const reportMessage = useCallback((m: ChatMessage) => {
    setReportingMessage(m)
    setReportCategory("HARASSMENT")
    setReportReason("")
  }, [])

  const submitReport = useCallback(async () => {
    if (!reportingMessage) return
    const reason = reportReason.trim()
    if (reason.length < 3 || reason.length > 500) {
      toast.error("Tell moderators what is wrong in 3 to 500 characters")
      return
    }
    setReportBusy(true)
    try {
      const result = await api.reportMessage(reportingMessage.id, reportCategory, reason)
      toast.success(result.childSafetyPriority ? "Child-safety report sent with priority" : "Report sent to moderators")
      setReportingMessage(null)
      setReportReason("")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Report failed")
    } finally {
      setReportBusy(false)
    }
  }, [reportCategory, reportReason, reportingMessage])

  const openMessageTools = useCallback((message: ChatMessage) => {
    setChatToolMessage(message)
    setChatToolsOpen(true)
  }, [])

  const toggleSavedMessage = useCallback(async (message: ChatMessage) => {
    try {
      const res = await fetch("/api/features/chat", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggle-save", messageId: message.id }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Could not save message")
      toast.success(body.saved ? "Message bookmarked" : "Bookmark removed")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save message") }
  }, [])

  const publishPollMessage = useCallback((messageId: string) => {
    if (!socket || !messageId) return
    socket.emit("publish-poll-message", { messageId })
  }, [socket])

  const activeDm = dmChannels.find((d) => d.id === activeChannel)
  const activeName = channels.find((c) => c.id === activeChannel)?.name || activeDm?.otherName || "No channel selected"
  const onlineIds = useMemo(() => new Set(onlineUsers.map(entry => entry.userId)), [onlineUsers])
  const offlineUsers = useMemo(() => directory.filter(entry => !onlineIds.has(entry.id)), [directory, onlineIds])
  const dmGroups = useMemo(() => Object.entries(dmChannels.reduce((groups, dm) => {
    const pref = channelPrefs[dm.id]
    const snoozed = pref?.snoozedUntil && new Date(pref.snoozedUntil).getTime() > Date.now()
    const folder = snoozed ? "Snoozed" : pref?.dealLater ? "Deal with later" : pref?.priority ? "Priority" : pref?.folder || "DMs"
    ;(groups[folder] ||= []).push(dm)
    return groups
  }, {} as Record<string, DmInfo[]>)).map(([folder, list]) => [
    folder,
    [...list].sort((a, b) => Number(Boolean(channelPrefs[b.id]?.priority)) - Number(Boolean(channelPrefs[a.id]?.priority)) || Number(Boolean(channelPrefs[b.id]?.pinned)) - Number(Boolean(channelPrefs[a.id]?.pinned)) || a.otherName.localeCompare(b.otherName)),
  ] as const).sort(([a], [b]) => (a === "Priority" ? -1 : b === "Priority" ? 1 : a.localeCompare(b))), [dmChannels, channelPrefs])

  // Keep the giant message tree out of the composer render path. Typing now
  // updates only the draft/composer unless message data or message actions
  // actually changed, instead of rebuilding hundreds of React elements per key.
  const renderedMessageRows = useMemo(() => !user ? [] : messages.map((m) => (
    <MessageRow
      key={m.id}
      m={m}
      currentUser={user}
      editing={editingId === m.id}
      editContent={editContent}
      onEditContentChange={setEditContent}
      onStartEdit={startEdit}
      onCancelEdit={cancelEdit}
      onSaveEdit={saveEdit}
      onDelete={deleteMessage}
      onReply={startReply}
      onJumpToReply={jumpToMessage}
      onQuote={quoteMessage}
      onReport={reportMessage}
      onOpenDM={openDM}
      onMention={handleMentionClick}
      onToggleReaction={toggleReaction}
      onFeatureTools={openMessageTools}
      onToggleSaved={toggleSavedMessage}
    />
  )), [messages, user, editingId, editContent, startEdit, cancelEdit, saveEdit, deleteMessage, startReply, jumpToMessage, quoteMessage, reportMessage, openDM, handleMentionClick, toggleReaction, openMessageTools, toggleSavedMessage])

  if (!user) return null
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Channel list */}
      <aside className="flex min-h-0 w-52 shrink-0 flex-col border-r border-[var(--synnical-border)] bg-black">
        <div className="h-11 px-3 flex items-center justify-between border-b border-[var(--synnical-border)]">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--synnical-muted)]">Channels</span>
          {canManageChannels(user.role) && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowNewChannel((v) => !v)} aria-label="New channel">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {showNewChannel && (
          <div className="space-y-2.5 border-b border-[var(--synnical-border)] p-2">
            <div className="flex gap-1.5">
              <Input value={newChannel} onChange={(e) => setNewChannel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createChannel()} placeholder="new-channel" className="h-8 text-sm" autoFocus />
              <Button size="sm" disabled={!newChannel.trim()} className="h-8 px-2 bg-white hover:bg-[#e8e8e8] text-black" onClick={createChannel}>Add</Button>
            </div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--synnical-muted)]">Who can see and use it</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setNewChannelAudience("MEMBERS")}
                aria-pressed={newChannelAudience === "MEMBERS"}
                className={cn(
                  "rounded-md border p-2 text-left transition-colors",
                  newChannelAudience === "MEMBERS"
                    ? "border-white bg-white text-black"
                    : "border-[#2a2a2a] bg-[#080808] text-[#b8b8b8] hover:border-[#555] hover:text-white",
                )}
              >
                <span className="flex items-center gap-1.5 text-[10px] font-semibold"><Users className="h-3.5 w-3.5" />Members</span>
                <span className={cn("mt-1 block text-[9px] leading-3", newChannelAudience === "MEMBERS" ? "text-[#333]" : "text-[#777]")}>Everyone can see and use it.</span>
              </button>
              <button
                type="button"
                onClick={() => setNewChannelAudience("STAFF")}
                aria-pressed={newChannelAudience === "STAFF"}
                className={cn(
                  "rounded-md border p-2 text-left transition-colors",
                  newChannelAudience === "STAFF"
                    ? "border-white bg-white text-black"
                    : "border-[#2a2a2a] bg-[#080808] text-[#b8b8b8] hover:border-[#555] hover:text-white",
                )}
              >
                <span className="flex items-center gap-1.5 text-[10px] font-semibold"><Shield className="h-3.5 w-3.5" />Staff</span>
                <span className={cn("mt-1 block text-[9px] leading-3", newChannelAudience === "STAFF" ? "text-[#333]" : "text-[#777]")}>MOD, ADMIN, HEAD ADMIN and OWNER only. Members cannot see it.</span>
              </button>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scroll">
          <div className="p-1.5 space-y-0.5">
            {loadingChannels ? <div className="p-2 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--synnical-muted)]" /></div> :
              channels.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-[var(--synnical-muted)]">
                  <Hash className="mx-auto mb-2 h-6 w-6 opacity-40" />
                  No public channels. Staff can create one with +.
                </div>
              ) : channels.map((c) => (
                <div key={c.id} className={cn("group/channel flex items-center rounded-md text-sm transition-colors", activeChannel === c.id ? "bg-[var(--synnical-accent)]/10 text-[var(--synnical-accent)]" : "hover:bg-[var(--synnical-surface-2)] text-[var(--synnical-muted)]")}>
                  <button type="button" onClick={() => setActiveChannel(c.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">
                    <Hash className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {(c.audience || channelAudienceFromRoleList(c.allowedRoles)) === "STAFF" && <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center" aria-label="Staff-only channel" title="Staff only"><Lock className="h-3 w-3" aria-hidden="true" /></span>}
                    {mentionsByChannel[c.id] ? <span aria-label="Unread mention" className="grid h-4 w-4 place-items-center rounded-full bg-red-600 text-xs font-bold text-white">!</span> : (unreadByChannel[c.id] || 0) > 0 ? <span aria-label="Unread messages" className="h-2 w-2 rounded-full bg-[var(--synnical-accent)]" /> : null}
                  </button>
                  {canManageChannels(user.role) && <button type="button" onClick={() => void deleteChannel(c)} className="mr-1 rounded p-1 opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover/channel:opacity-100" aria-label={`Delete ${c.name}`} title="Delete channel"><Trash2 className="h-3 w-3" /></button>}
                </div>
              ))
            }
          </div>
          {dmChannels.length > 0 && <div className="border-t border-[var(--synnical-border)] p-1.5">
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--synnical-muted)]">Direct messages</p>
            {dmGroups.map(([folder, list]) => <div key={folder} className="mb-2"><p className="px-2 py-1 text-[9px] uppercase tracking-wide text-[#555]">{folder}</p>{list.map((dm) => <div key={dm.id} className={cn("group/dm flex items-center rounded-md", activeChannel === dm.id ? "bg-[var(--synnical-accent)]/10 text-[var(--synnical-accent)]" : "text-[var(--synnical-muted)] hover:bg-[var(--synnical-surface-2)]")}><button type="button" onClick={() => setActiveChannel(dm.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">{channelPrefs[dm.id]?.pinned ? <Pin className="h-3 w-3 shrink-0" fill="currentColor" /> : <MessageSquare className="h-3.5 w-3.5 shrink-0" />}<span className="min-w-0 flex-1 truncate text-xs">{dm.otherName}</span>{mentionsByChannel[dm.id] ? <span aria-label="Unread mention" className="grid h-4 w-4 place-items-center rounded-full bg-red-600 text-xs font-bold text-white">!</span> : (unreadByChannel[dm.id] || 0) > 0 ? <span aria-label="Unread messages" className="h-2 w-2 rounded-full bg-[var(--synnical-accent)]" /> : null}</button><DropdownMenu><DropdownMenuTrigger asChild><button className="mr-1 rounded p-1 opacity-0 hover:bg-white/5 group-hover/dm:opacity-100" aria-label={`Manage ${dm.otherName}`}><MoreVertical className="h-3 w-3" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void setChannelPreference(dm.id, { pinned: !channelPrefs[dm.id]?.pinned }).catch((e) => toast.error(e.message))}><Pin className="mr-2 h-3.5 w-3.5" />{channelPrefs[dm.id]?.pinned ? "Unpin" : "Pin DM"}</DropdownMenuItem><DropdownMenuItem onClick={() => void setChannelPreference(dm.id, { priority: !channelPrefs[dm.id]?.priority }).catch((e) => toast.error(e.message))}><Star className="mr-2 h-3.5 w-3.5" />{channelPrefs[dm.id]?.priority ? "Remove priority" : "Priority inbox"}</DropdownMenuItem><DropdownMenuItem onClick={() => void setChannelPreference(dm.id, { dealLater: !channelPrefs[dm.id]?.dealLater }).catch((e) => toast.error(e.message))}><Bookmark className="mr-2 h-3.5 w-3.5" />{channelPrefs[dm.id]?.dealLater ? "Clear deal later" : "Deal with later"}</DropdownMenuItem><DropdownMenuItem onClick={() => { const current = channelPrefs[dm.id]?.snoozedUntil && new Date(channelPrefs[dm.id]!.snoozedUntil!).getTime() > Date.now(); if (current) { void setChannelPreference(dm.id,{snoozedUntil:null}).catch((e)=>toast.error(e.message)); return } const hours = Number(window.prompt("Snooze for how many hours?", "8")); if (Number.isFinite(hours) && hours > 0) void setChannelPreference(dm.id,{snoozedUntil:new Date(Date.now()+Math.min(hours,2160)*3600000).toISOString()}).catch((e) => toast.error(e.message)) }}><CalendarDays className="mr-2 h-3.5 w-3.5" />{channelPrefs[dm.id]?.snoozedUntil && new Date(channelPrefs[dm.id]!.snoozedUntil!).getTime() > Date.now() ? "Unsnooze" : "Snooze..."}</DropdownMenuItem><DropdownMenuItem onClick={() => { const folderName = window.prompt("DM folder", channelPrefs[dm.id]?.folder || "DMs"); if (folderName !== null) void setChannelPreference(dm.id, { folder: folderName.trim().slice(0,60) || "DMs" }).catch((e) => toast.error(e.message)) }}><Folder className="mr-2 h-3.5 w-3.5" />Move to folder...</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</div>)}
          </div>}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="h-11 shrink-0 px-4 flex items-center justify-between border-b border-[var(--synnical-border)]">
          <div className="flex items-center gap-2 min-w-0">
            <Hash className="h-4 w-4 text-[var(--synnical-muted)] shrink-0" />
            <span className="font-semibold truncate">{activeName}</span>
            <span className={cn("ml-2 h-2 w-2 rounded-full", connected ? "bg-[var(--synnical-accent)]" : "bg-red-500")} />
            <span className="text-xs text-[var(--synnical-muted)]">{connected ? "connected" : "Reconnecting to live chat…"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setDraft(draftRef.current); setChatToolMessage(null); setChatToolsOpen(true) }} aria-label="Chat tools" title="Search, saved messages, schedules, polls and events"><SlidersHorizontal className="h-4 w-4" /></Button>{firstUnreadMessageId && <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => jumpToMessage(firstUnreadMessageId)} title="Jump to first unread">First unread</Button>}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleSound}
              aria-label={soundEnabled ? "Mute notification sound" : "Unmute notification sound"}
              title={soundEnabled ? "Sound on" : "Sound off"}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4 text-[var(--synnical-accent)]" /> : <VolumeX className="h-4 w-4 text-[var(--synnical-muted)]" />}
            </Button>
            <div className="flex items-center gap-1.5 text-xs text-[var(--synnical-muted)]">
              <Users className="h-3.5 w-3.5" /><span>{onlineUsers.length}</span>
            </div>
          </div>
        </div>

        <div ref={scrollRef} onScroll={onMessageScroll} className="min-h-0 flex-1 overflow-y-auto custom-scroll px-4 py-4 space-y-3">
          {activeChannel && messages.length > 0 && (
            <div className="flex h-6 items-center justify-center text-[10px] text-[var(--synnical-muted)]">
              {loadingOlderMessages ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Loading older messages…</> : hasOlderMessages ? "Scroll up for older messages" : "Beginning of channel"}
            </div>
          )}
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-[var(--synnical-muted)]">
              <Hash className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">{activeChannel ? `No messages yet in #${activeName}` : "No channel selected"}</p>
            </div>
          )}
          {renderedMessageRows}
        </div>

        <div className="shrink-0 p-3 border-t border-[var(--synnical-border)] relative">
          {replyingTo && (
            <div className="mb-2 flex items-center gap-3 rounded-md border-l-2 border-[var(--synnical-accent)] bg-[#080808] px-3 py-2">
              <Reply className="h-4 w-4 shrink-0 text-[var(--synnical-accent)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[var(--synnical-text)]">Replying to {replyingTo.displayName || replyingTo.username}</p>
                <p className="truncate text-[11px] text-[var(--synnical-muted)]">{replyingTo.content || (replyingTo.imageUrl ? "Image" : replyingTo.gifUrl ? "GIF" : "Message")}</p>
              </div>
              {threadRootForComposer && <span className="shrink-0 rounded border border-[var(--synnical-accent)]/40 bg-[var(--synnical-accent)]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--synnical-accent)]">Thread</span>}
              <button type="button" onClick={() => { setReplyingTo(null); setThreadRootForComposer(null) }} className="rounded p-1 text-[var(--synnical-muted)] hover:bg-white/5 hover:text-[var(--synnical-text)]" aria-label="Cancel reply" title="Cancel reply">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {episodeSpoiler && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-xs">
              <Clapperboard className="h-4 w-4 text-amber-300" />
              <span className="min-w-0 flex-1 truncate text-amber-100">Episode spoiler · {episodeSpoiler.title}{episodeSpoiler.mediaType === "tv" ? ` · S${episodeSpoiler.season} E${episodeSpoiler.episode}` : ""}</span>
              <select value={spoilerDays} onChange={(event) => setSpoilerDays(Number(event.target.value) || 30)} className="rounded border border-amber-300/25 bg-black px-2 py-1 text-[11px] text-amber-100" aria-label="Spoiler expiry">
                <option value={7}>Hide 7 days</option><option value={30}>Hide 30 days</option><option value={90}>Hide 90 days</option><option value={365}>Hide 1 year</option>
              </select>
              <button type="button" onClick={() => setEpisodeSpoiler(null)} className="rounded p-1 text-amber-200 hover:bg-white/10" aria-label="Remove episode spoiler"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          {readSetting("chat.typingIndicators", true) && typingUsers.length > 0 && (
            <p className="text-xs text-[var(--synnical-muted)] mb-1.5 italic">
              {typingUsers.length === 1 ? `${typingUsers[0].username} is typing…` : `${typingUsers.length} users are typing…`}
            </p>
          )}

          {/* @mention autocomplete searches the whole account directory. */}
          {showMentionDropdown && (
            <div className="absolute bottom-full left-3 mb-1 z-20 w-64 rounded-md border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] shadow-md overflow-hidden">
              <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-[var(--synnical-muted)] border-b border-[var(--synnical-border)]">
                Mention a member
              </p>
              <div className="max-h-56 overflow-y-auto custom-scroll">
                {mentionCandidates.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => insertMention(u.username)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--synnical-accent)]/10 text-left"
                  >
                    <AvatarWithDeco src={u.pfpUrl} name={u.displayName} role={u.role} avatarDeco={u.avatarDeco} isGif={u.pfpIsGif} size="xs" />
                    <div className="min-w-0">
                      <DisplayName name={u.displayName} role={u.role} className="text-sm truncate block" />
                      <span className="text-[10px] text-[var(--synnical-muted)]">@{u.username}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {showCommandDropdown && (
            <CommandBrowser commands={commandCandidates} onSelect={insertCommand} />
          )}

          {gifPickerOpen && (
            <div className="absolute bottom-full left-3 right-3 z-30 mb-2 overflow-hidden rounded-md border border-[var(--synnical-border)] bg-black/90 shadow-xl">
              <div className="flex items-center gap-2 border-b border-white/10 p-2">
                <Search className="ml-1 h-4 w-4 text-white/35" />
                <input value={gifQuery} onChange={(event) => setGifQuery(event.target.value)} placeholder="Search GIPHY" className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm outline-none" autoFocus />
                {gifLoading ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : null}
                <button type="button" onClick={() => setGifPickerOpen(false)} className="rounded-md p-1.5 text-white/45 hover:bg-white/8 hover:text-white" aria-label="Close GIF picker"><X className="h-4 w-4" /></button>
              </div>
              {gifError ? <p role="alert" className="px-4 py-5 text-center text-sm text-rose-200">{gifError}</p> : (
                <div className="grid max-h-[42vh] grid-cols-2 gap-1 overflow-y-auto p-2 custom-scroll sm:grid-cols-3 lg:grid-cols-4">
                  {gifResults.map((gif) => <button key={gif.id} type="button" onClick={() => chooseGif(gif)} title={gif.username ? `${gif.title} · @${gif.username}` : gif.title} className="group relative h-28 overflow-hidden rounded-sm bg-white/5"><img src={gif.previewUrl} alt={gif.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => registerGifLoaded(gif)} onError={(event) => { if (event.currentTarget.src !== gif.url) event.currentTarget.src = gif.url }} className="block h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />{gif.username ? <span className="absolute bottom-1 left-1 max-w-[90%] truncate bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold text-white/85 opacity-0 transition-opacity group-hover:opacity-100">@{gif.username}</span> : null}</button>)}
                  {!gifLoading && gifResults.length === 0 ? <p className="col-span-full px-3 py-8 text-center text-sm text-white/45">No GIFs found.</p> : null}
                </div>
              )}
              <p className="border-t border-white/8 px-3 py-1.5 text-right text-[10px] font-semibold tracking-wide text-white/45">POWERED BY GIPHY</p>
            </div>
          )}

          <div className="flex gap-2 items-center">
            <Input
              ref={composerRef}
              defaultValue={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                const enterToSend = readSetting("chat.enterToSend", true)
                if (e.key === "Enter" && (enterToSend ? !e.shiftKey : (e.ctrlKey || e.metaKey))) {
                  e.preventDefault()
                  if (showMentionDropdown) insertMention(mentionCandidates[0].username)
                  else if (showCommandDropdown) insertCommand(commandCandidates[0].name)
                  else send()
                }
              }}
              placeholder={activeChannel ? `Message #${activeName}` : "Create or select a channel to chat"}
              disabled={!connected || !activeChannel}
              className="flex-1"
            />
            {/* Character limit warning */}
            {(() => {
              const maxWarn = readSetting("chat.maxMsgWarn", 1500)
              if (deferredDraft.length >= maxWarn) {
                return <span className="text-[10px] text-amber-400 shrink-0">{deferredDraft.length} chars</span>
              }
              return null
            })()}

            <Button type="button" variant="ghost" size="icon" onClick={() => { const context = readEpisodeSpoilerContext(); if (!context) { toast.error("Play a SynnFlix title or episode first, then tag this message as a spoiler."); return } setEpisodeSpoiler((current) => current ? null : context) }} disabled={!connected || !activeChannel} className={cn(episodeSpoiler && "bg-amber-400/12 text-amber-300")} aria-label="Tag SynnFlix spoiler" title="Tag last watched SynnFlix title as spoiler"><Clapperboard className="h-4 w-4" /></Button>
            <VoiceRecorder onSent={sendVoice} disabled={!connected || !activeChannel} />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
              onChange={(event) => void uploadAndSendImage(event.target.files?.[0])}
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => imageInputRef.current?.click()} disabled={!connected || !activeChannel || imageUploading} aria-label="Upload image" title="Image">
              {imageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => setGifPickerOpen((open) => !open)} disabled={!connected} className={cn("text-[10px] font-black tracking-normal", gifPickerOpen && "bg-[var(--synnical-accent)]/12 text-[var(--synnical-accent)]")} aria-label="Open GIF picker" title="GIF">GIF</Button>

            <Button
              onClick={() => send()}
              disabled={!connected || !activeChannel}
              className="bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black"
              size="icon"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Online users (respects chat.showOnlineStatus setting) */}
      {readSetting("chat.showOnlineStatus", true) && (
      <aside className="hidden min-h-0 w-48 shrink-0 flex-col overflow-hidden border-l border-[var(--synnical-border)] bg-black lg:flex">
        <div className="h-11 px-3 flex items-center border-b border-[var(--synnical-border)]">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--synnical-muted)]">People</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scroll">
          <div className="p-1.5 space-y-0.5">
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--synnical-muted)]">Online — {onlineUsers.length}</p>
            {onlineUsers.map((u) => (
              <div key={u.userId} className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--synnical-surface-2)]">
                <button
                  type="button"
                  onClick={() => viewProfile(u.userId)}
                  title={`View ${u.displayName}'s profile`}
                  className="relative shrink-0 rounded-full"
                >
                  <AvatarWithDeco src={u.pfpUrl} name={u.displayName} role={u.role} avatarDeco={u.avatarDeco} isGif={u.pfpIsGif} size="xs" />
                  <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background", u.muted ? "bg-red-500" : "bg-[var(--synnical-accent)]")} />
                </button>
                <button
                  type="button"
                  onClick={() => viewProfile(u.userId)}
                  className="min-w-0 flex-1 text-left"
                  title={`View ${u.displayName}'s profile`}
                >
                  <div className="flex items-center gap-1">
                    <DisplayName name={u.displayName} role={u.role} className="text-sm truncate" />
                  </div>
                  <RoleBadge role={u.role} tags={u.tags} className="mt-0.5" />
                  <p className="mt-0.5 truncate text-[10px] text-[var(--synnical-muted)]">
                    {[
                      u.afk && u.afkMessage ? u.afkMessage : publicPresenceLabel(u.presenceMode, u.afk, u.presenceModeExpiresAt),
                      u.activity ? `${u.activity.kind}: ${u.activity.name}${u.activity.details ? ` · ${u.activity.details}` : ""}` : presenceSectionLabel(u.currentSection),
                      u.deviceType && u.deviceType !== "unknown" ? u.deviceType.charAt(0).toUpperCase() + u.deviceType.slice(1) : null,
                      u.networkQuality && u.networkQuality !== "unknown" ? `${u.networkQuality.charAt(0).toUpperCase() + u.networkQuality.slice(1)} connection` : null,
                      onlineDurationLabel(u.onlineSince),
                    ].filter(Boolean).join(" · ")}
                  </p>
                  {u.tags && u.tags.length > 0 && <TagsDisplay tags={u.tags} className="mt-1" />}
                </button>
                {canModerate(user.role) && u.userId !== user.id && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--synnical-surface-2)] rounded" aria-label="User actions"><MoreVertical className="h-3 w-3" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {u.muted ? (
                        <DropdownMenuItem onClick={() => unmuteUser(u)}><Volume2 className="h-3.5 w-3.5 mr-2" />Unmute</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => muteUser(u)} className="text-[#ef4444]"><VolumeX className="h-3.5 w-3.5 mr-2" />Mute</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
            {onlineUsers.length === 0 && <p className="px-2 py-2 text-center text-xs text-[var(--synnical-muted)]">No one online</p>}
            <p className="mt-2 border-t border-[var(--synnical-border)] px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--synnical-muted)]">Offline — {offlineUsers.length}</p>
            {offlineUsers.map((u) => (
              <button key={u.id} type="button" onClick={() => viewProfile(u.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left opacity-55 hover:bg-[var(--synnical-surface-2)] hover:opacity-80">
                <span className="relative shrink-0 rounded-full grayscale">
                  <AvatarWithDeco src={u.pfpUrl} name={u.displayName} role={u.role} avatarDeco={u.avatarDeco} isGif={u.pfpIsGif} size="xs" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-zinc-600" />
                </span>
                <span className="min-w-0 flex-1">
                  <DisplayName name={u.displayName} role={u.role} className="block truncate text-sm" />
                  <RoleBadge role={u.role} tags={u.tags} className="mt-0.5" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>
      )}

      <ChatToolsPanel open={chatToolsOpen} onClose={() => { setChatToolsOpen(false); setChatToolMessage(null) }} activeChannel={activeChannel} activeName={activeName} draft={draft} setDraft={replaceDraft} currentUser={user} channelPreference={activeChannel ? channelPrefs[activeChannel] : undefined} setPreference={(patch) => activeChannel ? setChannelPreference(activeChannel, patch) : Promise.resolve()} onJumpToMessage={jumpToMessage} selectedMessage={chatToolMessage} onReplyInThread={startThreadReply} onPublishPoll={publishPollMessage} onSaveQuote={saveQuoteCollection} />

      {reportingMessage && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !reportBusy) setReportingMessage(null) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="report-message-title" className="w-full max-w-lg rounded-xl border border-[var(--synnical-border)] bg-[#07101f] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h2 id="report-message-title" className="text-lg font-semibold">Report message</h2><p className="mt-1 text-xs text-[var(--synnical-muted)]">What&apos;s wrong? The reported message and nearby conversation are copied into the report now, so later deletion cannot erase the evidence.</p></div>
              <button type="button" disabled={reportBusy} onClick={() => setReportingMessage(null)} className="rounded p-1 text-[var(--synnical-muted)] hover:bg-white/5 hover:text-white" aria-label="Close report dialog"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 rounded-lg border border-[var(--synnical-border)] bg-[#080808] p-3">
              <p className="text-xs font-semibold">{reportingMessage.displayName || reportingMessage.username}</p>
              <p className="mt-1 line-clamp-4 text-sm text-[var(--synnical-muted)]">{reportingMessage.content || (reportingMessage.imageUrl ? "Image message" : reportingMessage.gifUrl ? "GIF message" : "Message")}</p>
            </div>
            <label className="mt-4 block text-xs font-semibold" htmlFor="report-category">Reason category</label>
            <select id="report-category" value={reportCategory} onChange={(event) => setReportCategory(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-[var(--synnical-border)] bg-[#080808] px-3 text-sm outline-none focus:border-white">
              <option value="CHILD_SAFETY">Child safety</option>
              <option value="THREATS">Threats or violence</option>
              <option value="SEXUAL_CONTENT">Sexual content</option>
              <option value="SCAM_MANIPULATION">Scam or manipulation</option>
              <option value="HATE">Hate or targeted abuse</option>
              <option value="HARASSMENT">Harassment</option>
              <option value="SPAM">Spam</option>
              <option value="OTHER">Other</option>
            </select>
            {reportCategory === "CHILD_SAFETY" && <p className="mt-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Child-safety reports are placed at the top of the moderator queue.</p>}
            <label className="mt-4 block text-xs font-semibold" htmlFor="report-reason">What happened?</label>
            <textarea id="report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)} maxLength={500} rows={5} placeholder="Give moderators enough context to understand the problem." className="mt-2 w-full resize-none rounded-md border border-[var(--synnical-border)] bg-[#080808] px-3 py-2 text-sm outline-none focus:border-white" />
            <div className="mt-1 text-right text-[10px] text-[var(--synnical-muted)]">{reportReason.length}/500</div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReportingMessage(null)} disabled={reportBusy}>Cancel</Button>
              <Button onClick={() => void submitReport()} disabled={reportBusy || reportReason.trim().length < 3}>{reportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />} Send report</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------- MessageRow ------------------------------- */

function EmojiReactionPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const [categoryId, setCategoryId] = useState(CHAT_EMOJI_CATEGORIES[0].id)
  const [query, setQuery] = useState("")
  const normalized = query.trim().toLowerCase()
  const categories = normalized
    ? CHAT_EMOJI_CATEGORIES.filter((category) => `${category.label} ${category.keywords}`.toLowerCase().includes(normalized))
    : CHAT_EMOJI_CATEGORIES.filter((category) => category.id === categoryId)
  const emojis = categories.flatMap((category) => category.emojis)

  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="p-1 text-[var(--synnical-muted)] hover:text-[var(--synnical-accent)]" aria-label="Add emoji reaction" title="Add reaction"><SmilePlus className="h-3 w-3" /></button>
      {open && (
        <span className="absolute right-0 top-full z-40 mt-1 block w-72 overflow-hidden rounded-md border border-[var(--synnical-border)] bg-[#07101f] text-left shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <span className="flex items-center gap-1 border-b border-[var(--synnical-border)] p-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--synnical-muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search emoji categories" className="min-w-0 flex-1 bg-transparent text-xs outline-none" autoFocus />
            <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-[var(--synnical-muted)] hover:text-white" aria-label="Close emoji picker"><X className="h-3.5 w-3.5" /></button>
          </span>
          {!normalized && <span className="flex gap-0.5 overflow-x-auto border-b border-[var(--synnical-border)] p-1 custom-scroll">{CHAT_EMOJI_CATEGORIES.map((category) => <button key={category.id} type="button" onClick={() => setCategoryId(category.id)} className={cn("shrink-0 rounded px-2 py-1 text-[10px]", category.id === categoryId ? "bg-[var(--synnical-accent)]/15 text-[var(--synnical-accent)]" : "text-[var(--synnical-muted)] hover:bg-white/5")}>{category.label}</button>)}</span>}
          <span className="grid max-h-56 grid-cols-10 gap-0.5 overflow-y-auto p-2 custom-scroll">
            {emojis.map((emoji) => <button key={emoji} type="button" onClick={() => { onSelect(emoji); setOpen(false) }} className="grid h-6 w-6 place-items-center rounded text-base hover:bg-[var(--synnical-accent)]/18" aria-label={`React with ${emoji}`}>{emoji}</button>)}
          </span>
          {emojis.length === 0 && <span className="block p-4 text-center text-xs text-[var(--synnical-muted)]">No matching category</span>}
          <span className="block border-t border-[var(--synnical-border)] px-2 py-1 text-[9px] text-[var(--synnical-muted)]">500 reactions · choose a category or search</span>
        </span>
      )}
    </span>
  )
}


type ChatToolsProps = {
  open: boolean
  onClose: () => void
  activeChannel: string | null
  activeName: string
  draft: string
  setDraft: (value: string) => void
  currentUser: SafeUser
  channelPreference?: ChannelPref
  setPreference: (patch: Partial<ChannelPref>) => Promise<void>
  onJumpToMessage: (id: string) => void
  selectedMessage: ChatMessage | null
  onReplyInThread: (message: ChatMessage) => void
  onPublishPoll: (messageId: string) => void
  onSaveQuote: (message: ChatMessage) => Promise<void>
}

function ChatToolsPanel({ open, onClose, activeChannel, activeName, draft, setDraft, currentUser, channelPreference, setPreference, onJumpToMessage, selectedMessage, onReplyInThread, onPublishPoll, onSaveQuote }: ChatToolsProps) {
  const [tab, setTab] = useState<"channel" | "search" | "saved" | "scheduled" | "polls" | "events" | "message">("channel")
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchUser, setSearchUser] = useState("")
  const [searchMedia, setSearchMedia] = useState(false)
  const [searchFrom, setSearchFrom] = useState("")
  const [searchTo, setSearchTo] = useState("")
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [saved, setSaved] = useState<any[]>([])
  const [scheduled, setScheduled] = useState<any[]>([])
  const [polls, setPolls] = useState<any[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [gallery, setGallery] = useState<{ media: any[]; links: any[] }>({ media: [], links: [] })
  const [conversationStats, setConversationStats] = useState<any>(null)
  const [scheduleAt, setScheduleAt] = useState("")
  const [pollQuestion, setPollQuestion] = useState("")
  const [pollOptions, setPollOptions] = useState("Yes, No")
  const [pollAnonymous, setPollAnonymous] = useState(false)
  const [pollMultiple, setPollMultiple] = useState(false)
  const [eventTitle, setEventTitle] = useState("")
  const [eventDescription, setEventDescription] = useState("")
  const [eventAt, setEventAt] = useState("")
  const [slowMode, setSlowMode] = useState("0")
  const [translationLanguage, setTranslationLanguage] = useState("English")
  const [translation, setTranslation] = useState("")
  const [editHistory, setEditHistory] = useState<any[]>([])
  const [thread, setThread] = useState<{ root?: any; replies?: any[] }>({})

  const get = useCallback(async (action: string, extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ action, ...(activeChannel ? { channelId: activeChannel } : {}), ...extra })
    const res = await fetch(`/api/features/chat?${qs}`, { credentials: "include", cache: "no-store" })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || "Chat tools request failed")
    return body
  }, [activeChannel])
  const post = useCallback(async (body: any) => {
    const res = await fetch("/api/features/chat", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error || "Chat tools request failed")
    return json
  }, [])

  const refreshTab = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      if (tab === "saved") setSaved((await get("saved")).saved || [])
      else if (tab === "scheduled") setScheduled((await get("scheduled")).scheduled || [])
      else if (tab === "polls" && activeChannel) setPolls((await get("polls")).polls || [])
      else if (tab === "events" && activeChannel) setEvents((await get("events")).events || [])
      else if (tab === "channel" && activeChannel) { const [galleryData, statsData] = await Promise.all([get("gallery"), get("stats")]); setGallery(galleryData); setConversationStats(statsData) }
      else if (tab === "message" && selectedMessage) {
        const [edits, threadData] = await Promise.all([get("edits", { messageId: selectedMessage.id }), get("thread", { messageId: selectedMessage.id })])
        setEditHistory(edits.edits || [])
        setThread(threadData || {})
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load chat tools") }
    finally { setLoading(false) }
  }, [open, tab, activeChannel, selectedMessage, get])

  useEffect(() => { if (open) { setTab(selectedMessage ? "message" : "channel"); setTranslation("") } }, [open, selectedMessage])
  useEffect(() => { void refreshTab() }, [refreshTab])
  if (!open) return null

  const runSearch = async () => {
    if (!activeChannel) return
    setLoading(true)
    try {
      const extra: Record<string, string> = { q: searchQuery }
      if (searchUser) extra.userId = searchUser
      if (searchMedia) extra.media = "1"
      if (searchFrom) extra.from = new Date(`${searchFrom}T00:00:00`).toISOString()
      if (searchTo) extra.to = new Date(`${searchTo}T23:59:59.999`).toISOString()
      setSearchResults((await get("search", extra)).messages || [])
    } catch (error) { toast.error(error instanceof Error ? error.message : "Search failed") }
    finally { setLoading(false) }
  }

  const schedule = async () => {
    if (!activeChannel || !draft.trim() || !scheduleAt) return
    try { await post({ action: "schedule", channelId: activeChannel, content: draft, sendAt: new Date(scheduleAt).toISOString() }); setDraft(""); toast.success("Message scheduled"); setTab("scheduled") }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not schedule message") }
  }
  const createPoll = async () => {
    if (!activeChannel) return
    const options = pollOptions.split(",").map((x) => x.trim()).filter(Boolean)
    try {
      const result = await post({ action: "create-poll", channelId: activeChannel, question: pollQuestion, options, anonymous: pollAnonymous, multiple: pollMultiple })
      if (result?.message?.id) onPublishPoll(String(result.message.id))
      toast.success("Poll posted to chat")
      setPollQuestion("")
      await refreshTab()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create poll") }
  }
  const createEvent = async () => {
    if (!activeChannel || !eventAt) return
    try { await post({ action: "create-event", channelId: activeChannel, title: eventTitle, description: eventDescription, startsAt: new Date(eventAt).toISOString() }); toast.success("Event created"); setEventTitle(""); await refreshTab() }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not create event") }
  }
  const exportConversation = async () => {
    if (!activeChannel) return
    const res = await fetch(`/api/features/chat?action=export&channelId=${encodeURIComponent(activeChannel)}`, { credentials: "include" })
    if (!res.ok) return toast.error("Conversation export failed")
    const blob = await res.blob(); const href = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = href; a.download = `synnical-${activeName.replace(/[^a-z0-9_-]+/gi,"-").slice(0,50) || "conversation"}.txt`; a.click(); URL.revokeObjectURL(href)
  }

  return <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/75 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#292929] bg-[#080808] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[#222] p-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">Chat tools · {activeName}</p><p className="text-[11px] text-[#666]">Account-backed tools for this conversation.</p></div><button onClick={onClose} className="rounded p-1 text-[#777] hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button></div>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#222] p-2">{(["channel","search","saved","scheduled","polls","events",...(selectedMessage ? ["message"] : [])] as const).map((value) => <button key={value} onClick={() => setTab(value as any)} className={cn("rounded-md px-2.5 py-1.5 text-xs capitalize", tab === value ? "bg-white text-black" : "text-[#888] hover:bg-[#151515] hover:text-white")}>{value}</button>)}</div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scroll">
        {loading && <div className="mb-3 flex items-center gap-2 text-xs text-[#777]"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>}
        {tab === "channel" && <div className="space-y-5">
          <section><h3 className="text-sm font-semibold">Notifications & draft sync</h3><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="text-xs text-[#777]">Level<select value={channelPreference?.notificationLevel || "all"} onChange={(e) => void setPreference({ notificationLevel: e.target.value }).catch((x) => toast.error(x.message))} className="mt-1 h-9 w-full rounded-md border border-[#222] bg-black px-2 text-white"><option value="all">Mentions</option><option value="mentions">Mentions only</option><option value="mute">Muted</option></select></label><label className="text-xs text-[#777]">Sound<select value={channelPreference?.notificationSound || "default"} onChange={(e) => void setPreference({ notificationSound: e.target.value }).catch((x) => toast.error(x.message))} className="mt-1 h-9 w-full rounded-md border border-[#222] bg-black px-2 text-white"><option value="default">Default</option><option value="soft">Soft</option><option value="bright">Bright</option><option value="low">Low</option><option value="pulse">Pulse</option></select></label>{canManageChannels(currentUser.role) && !activeChannel?.startsWith("dm-") && <label className="text-xs text-[#777]">Slow mode seconds<div className="mt-1 flex gap-1"><Input type="number" min={0} max={21600} value={slowMode} onChange={(e) => setSlowMode(e.target.value)} /><Button size="sm" onClick={() => activeChannel && void post({ action: "set-slowmode", channelId: activeChannel, seconds: Number(slowMode) }).then(() => toast.success("Slow mode saved")).catch((e) => toast.error(e.message))}>Set</Button></div></label>}</div><p className="mt-2 text-[11px] text-[#555]">Your current composer draft is synced to this account automatically.</p></section>
          <section><div className="flex items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Conversation organisation</h3><Button size="sm" variant="outline" onClick={() => void exportConversation()}>Export archive</Button></div><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs text-[#777]">Private conversation note<Textarea className="mt-1" value={channelPreference?.privateNote || ""} onChange={(e)=>void setPreference({privateNote:e.target.value}).catch(()=>{})} rows={2} placeholder="Only you can see this note" /></label><div className="rounded-lg border border-[#222] bg-black/30 p-3 text-xs"><p><strong>{conversationStats?.count ?? 0}</strong> messages · <strong>{conversationStats?.mediaCount ?? 0}</strong> media</p>{conversationStats?.firstMessage && <p className="mt-1 text-[#666]">First message: {new Date(conversationStats.firstMessage.createdAt).toLocaleDateString()}</p>}{channelPreference?.catchUpMessageId ? <Button size="sm" variant="ghost" className="mt-2" onClick={()=>onJumpToMessage(channelPreference.catchUpMessageId!)}>Jump to my catch-up marker</Button> : null}</div></div>{conversationStats?.topWords?.length ? <div className="mt-2 flex flex-wrap gap-1">{conversationStats.topWords.slice(0,12).map((row:any)=><span key={row.word} className="rounded-full border border-[#222] px-2 py-1 text-[10px] text-[#777]">{row.word} · {row.count}</span>)}</div> : null}</section>
          <section><h3 className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="h-4 w-4" />Shared media</h3><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{(gallery.media || []).slice(0,24).map((item:any)=><button key={`${item.messageId}:${item.type}`} onClick={() => onJumpToMessage(item.messageId)} className="rounded-lg border border-[#222] bg-black/40 p-2 text-left text-xs"><p className="truncate">{item.type === "gif" ? "GIF" : item.type === "image" ? "Image" : "Voice"} · @{item.username}</p>{item.transcript && <p className="mt-1 line-clamp-2 text-[10px] text-[#666]">{item.transcript}</p>}</button>)}</div></section>
          <section><h3 className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4" />Shared links</h3><div className="mt-2 space-y-1">{(gallery.links || []).slice(0,40).map((item:any)=><a key={`${item.messageId}:${item.url}`} href={item.url} target="_blank" rel="noreferrer" className="block truncate rounded-md border border-[#222] bg-black/40 px-2 py-1.5 text-xs text-[var(--synnical-accent)]">{item.url}</a>)}</div></section>
        </div>}
        {tab === "search" && <div><h3 className="text-sm font-semibold">Search this conversation</h3><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_150px_150px_auto_auto]"><Input value={searchQuery} onChange={(e)=>setSearchQuery(e.target.value)} placeholder="Text" /><Input value={searchUser} onChange={(e)=>setSearchUser(e.target.value)} placeholder="Sender user ID (optional)" /><Input type="date" value={searchFrom} onChange={(e)=>setSearchFrom(e.target.value)} aria-label="Search from date" /><Input type="date" value={searchTo} onChange={(e)=>setSearchTo(e.target.value)} aria-label="Search to date" /><label className="flex items-center gap-2 rounded-md border border-[#222] px-2 text-xs text-[#888]"><input type="checkbox" checked={searchMedia} onChange={(e)=>setSearchMedia(e.target.checked)} />Media only</label><Button onClick={() => void runSearch()}><Search className="mr-2 h-4 w-4" />Search</Button></div><div className="mt-3 space-y-2">{searchResults.map((m:any)=><button key={m.id} onClick={()=>onJumpToMessage(m.id)} className="block w-full rounded-lg border border-[#222] bg-black/40 p-3 text-left"><p className="text-xs font-medium">{m.displayName || m.username}</p><p className="mt-1 line-clamp-2 text-xs text-[#777]">{m.content || "Media message"}</p></button>)}</div></div>}
        {tab === "saved" && <div><h3 className="flex items-center gap-2 text-sm font-semibold"><Bookmark className="h-4 w-4" />Saved messages</h3><div className="mt-3 space-y-2">{saved.map((row:any)=><button key={row.id} onClick={()=>onJumpToMessage(row.messageId)} className="block w-full rounded-lg border border-[#222] bg-black/40 p-3 text-left"><p className="text-xs font-medium">{row.message?.displayName || row.message?.username}</p><p className="mt-1 line-clamp-2 text-xs text-[#777]">{row.message?.content}</p></button>)}</div></div>}
        {tab === "scheduled" && <div><h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4" />Scheduled messages</h3><div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]"><Input type="datetime-local" value={scheduleAt} onChange={(e)=>setScheduleAt(e.target.value)} /><Button onClick={() => void schedule()} disabled={!activeChannel || !draft.trim() || !scheduleAt}>Schedule current draft</Button></div><div className="mt-3 space-y-2">{scheduled.map((row:any)=><div key={row.id} className="flex items-start gap-3 rounded-lg border border-[#222] bg-black/40 p-3"><div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs">{row.content || "GIF"}</p><p className="mt-1 text-[10px] text-[#666]">{new Date(row.sendAt).toLocaleString()} · {row.status}</p></div>{row.status === "pending" && <Button size="sm" variant="ghost" onClick={() => void post({ action:"cancel-scheduled", id:row.id }).then(refreshTab).catch((e)=>toast.error(e.message))}>Cancel</Button>}</div>)}</div></div>}
        {tab === "polls" && <div><h3 className="text-sm font-semibold">Polls</h3><div className="mt-2 space-y-2 rounded-lg border border-[#222] bg-black/30 p-3"><Input value={pollQuestion} onChange={(e)=>setPollQuestion(e.target.value)} placeholder="Question" /><Input value={pollOptions} onChange={(e)=>setPollOptions(e.target.value)} placeholder="Option 1, Option 2" /><div className="flex flex-wrap gap-4 text-xs text-[#777]"><label><input className="mr-1" type="checkbox" checked={pollMultiple} onChange={(e)=>setPollMultiple(e.target.checked)} />Multiple choice</label>{canModerate(currentUser.role) && <label><input className="mr-1" type="checkbox" checked={pollAnonymous} onChange={(e)=>setPollAnonymous(e.target.checked)} />Anonymous voters</label>}</div><Button size="sm" onClick={() => void createPoll()}>Create poll</Button></div><div className="mt-3 space-y-3">{polls.map((poll:any)=><div key={poll.id} className="rounded-lg border border-[#222] bg-black/40 p-3"><p className="text-sm font-medium">{poll.question}{poll.anonymous ? " · anonymous" : ""}</p><div className="mt-2 space-y-1">{poll.options?.map((option:any)=><button key={option.id} onClick={() => void post({ action:"vote", pollId:poll.id, optionId:option.id }).then(refreshTab).catch((e)=>toast.error(e.message))} className={cn("flex w-full justify-between rounded-md border px-2 py-1.5 text-xs", poll.myVotes?.includes(option.id) ? "border-white bg-white text-black" : "border-[#222] hover:border-[#444]")}><span>{option.label}</span><span>{option.count}</span></button>)}</div></div>)}</div></div>}
        {tab === "events" && <div><h3 className="text-sm font-semibold">Channel events</h3><div className="mt-2 space-y-2 rounded-lg border border-[#222] bg-black/30 p-3"><Input value={eventTitle} onChange={(e)=>setEventTitle(e.target.value)} placeholder="Event title" /><Textarea value={eventDescription} onChange={(e)=>setEventDescription(e.target.value)} placeholder="Description" rows={2} /><Input type="datetime-local" value={eventAt} onChange={(e)=>setEventAt(e.target.value)} /><Button size="sm" onClick={() => void createEvent()}>Create event</Button></div><div className="mt-3 space-y-2">{events.map((event:any)=><div key={event.id} className="rounded-lg border border-[#222] bg-black/40 p-3"><p className="text-sm font-medium">{event.title}</p><p className="text-xs text-[#777]">{new Date(event.startsAt).toLocaleString()} · {event.description}</p><div className="mt-2 flex gap-1">{["going","maybe","not-going"].map((status)=><Button key={status} size="sm" variant={event.myRsvp === status ? "default" : "outline"} onClick={() => void post({ action:"rsvp", eventId:event.id, status }).then(refreshTab).catch((e)=>toast.error(e.message))}>{status}</Button>)}</div></div>)}</div></div>}
        {tab === "message" && selectedMessage && <div className="space-y-4"><div className="rounded-lg border border-[#222] bg-black/40 p-3"><p className="text-xs font-medium">{selectedMessage.displayName || selectedMessage.username}</p><p className="mt-1 whitespace-pre-wrap text-sm">{selectedMessage.content}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void setPreference({ catchUpMessageId: selectedMessage.id }).then(()=>toast.success("Catch-up marker saved")).catch((e)=>toast.error(e.message))}>Catch me up from here</Button><Button size="sm" variant="outline" onClick={() => void onSaveQuote(selectedMessage)}>Save to quote collection</Button></div></div><section><h3 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" />Edit history</h3><div className="mt-2 space-y-1">{editHistory.length ? editHistory.map((row:any)=><div key={row.id} className="rounded-md border border-[#222] p-2 text-xs"><p>{row.content}</p><p className="mt-1 text-[10px] text-[#666]">{new Date(row.editedAt).toLocaleString()}</p></div>) : <p className="text-xs text-[#666]">No previous revisions.</p>}</div></section><section><div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><ListTree className="h-4 w-4" />Thread</h3><Button size="sm" variant="outline" onClick={() => onReplyInThread(selectedMessage)}>Reply in thread</Button></div><div className="mt-2 space-y-1">{thread.root && <button onClick={()=>onJumpToMessage(thread.root.id)} className="w-full rounded-md border border-[#222] p-2 text-left text-xs">Root · {thread.root.content}</button>}{thread.replies?.map((row:any)=><button key={row.id} onClick={()=>onJumpToMessage(row.id)} className="w-full rounded-md border border-[#222] p-2 text-left text-xs">{row.username}: {row.content}</button>)}</div></section><section><h3 className="flex items-center gap-2 text-sm font-semibold"><Languages className="h-4 w-4" />Translate</h3><div className="mt-2 flex gap-2"><Input value={translationLanguage} onChange={(e)=>setTranslationLanguage(e.target.value)} placeholder="Language" /><Button onClick={() => void post({ action:"translate", messageId:selectedMessage.id, language:translationLanguage }).then((x)=>setTranslation(x.translation || "")).catch((e)=>toast.error(e.message))}>Translate</Button></div>{translation && <p className="mt-2 rounded-lg border border-[#222] bg-black/40 p-3 text-sm">{translation}</p>}</section></div>}
      </div>
    </div>
  </div>
}


function SpoilerReveal({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setRevealed((value) => !value)}
      aria-pressed={revealed}
      className={cn(
        "mx-0.5 inline rounded px-1 py-0.5 text-sm transition-colors",
        revealed ? "bg-white/10 text-[var(--synnical-text)]" : "bg-[#242424] text-transparent shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] hover:bg-[#303030]",
      )}
      title={revealed ? "Hide spoiler" : "Reveal spoiler"}
    >
      <span className={revealed ? "" : "select-none blur-[4px]"}>{text}</span>
    </button>
  )
}

function EpisodeSpoilerReveal({ message, children }: { message: ChatMessage; children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  const expires = message.spoilerUntil ? new Date(message.spoilerUntil).getTime() : 0
  const active = Boolean(message.spoilerMediaId && (!expires || expires > Date.now()))
  if (!active || revealed) {
    return <div>{revealed && <button type="button" onClick={() => setRevealed(false)} className="mb-1 text-[10px] font-medium text-amber-300 hover:underline">Hide episode spoiler again</button>}{children}</div>
  }
  const label = message.spoilerMediaType === "tv" ? `${message.spoilerTitle || "TV episode"} · S${message.spoilerSeason || "?"} E${message.spoilerEpisode || "?"}` : (message.spoilerTitle || "Movie")
  return (
    <button type="button" onClick={() => setRevealed(true)} className="block w-full rounded-md border border-amber-400/25 bg-amber-400/8 px-3 py-3 text-left hover:bg-amber-400/12">
      <span className="flex items-center gap-2 text-xs font-semibold text-amber-200"><Clapperboard className="h-4 w-4" />Episode spoiler hidden</span>
      <span className="mt-1 block text-[11px] text-amber-100/70">{label}</span>
      <span className="mt-2 block text-[10px] text-amber-100/55">Click to reveal{message.spoilerUntil ? ` · expires ${new Date(message.spoilerUntil).toLocaleDateString()}` : ""}</span>
    </button>
  )
}

type InlinePollData = {
  id: string
  question: string
  anonymous?: boolean
  multiple?: boolean
  closesAt?: string | null
  options?: { id: string; label: string; count: number }[]
  myVotes?: string[]
}

function InlinePoll({ messageId }: { messageId: string }) {
  const [poll, setPoll] = useState<InlinePollData | null>(null)
  const [loading, setLoading] = useState(true)
  const [voting, setVoting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ action: "poll-message", messageId })
      const response = await fetch(`/api/features/chat?${qs}`, { credentials: "include", cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || "Poll unavailable")
      setPoll(body.poll || null)
    } catch { setPoll(null) } finally { setLoading(false) }
  }, [messageId])

  useEffect(() => { void load() }, [load])

  const vote = useCallback(async (optionId: string) => {
    if (!poll || voting) return
    setVoting(optionId)
    try {
      const response = await fetch("/api/features/chat", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "vote", pollId: poll.id, optionId }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || "Could not vote")
      setPoll(body.poll || poll)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not vote") }
    finally { setVoting(null) }
  }, [poll, voting])

  if (loading) return <div className="mt-1 rounded-lg border border-[var(--synnical-border)] bg-white/[.025] p-3 text-xs text-[var(--synnical-muted)]">Loading poll…</div>
  if (!poll) return <div className="mt-1 rounded-lg border border-[var(--synnical-border)] bg-white/[.025] p-3 text-xs text-[var(--synnical-muted)]">Poll unavailable</div>
  const total = (poll.options || []).reduce((sum, option) => sum + Number(option.count || 0), 0)
  return <div className="mt-1 max-w-xl rounded-xl border border-[var(--synnical-border)] bg-white/[.025] p-3">
    <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--synnical-text)]">{poll.question}</p><p className="mt-0.5 text-[10px] text-[var(--synnical-muted)]">{poll.multiple ? "Choose one or more" : "Choose one"}{poll.anonymous ? " · anonymous" : ""} · {total} vote{total === 1 ? "" : "s"}</p></div><span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-bold text-[var(--synnical-muted)]">POLL</span></div>
    <div className="mt-3 space-y-1.5">{(poll.options || []).map((option) => { const selected = poll.myVotes?.includes(option.id); const pct = total > 0 ? Math.round((option.count / total) * 100) : 0; return <button key={option.id} type="button" disabled={Boolean(voting)} onClick={() => void vote(option.id)} className={cn("relative flex w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-xs transition", selected ? "border-[var(--synnical-accent)] text-white" : "border-[var(--synnical-border)] text-[var(--synnical-text)] hover:border-[var(--synnical-accent)]/50")}>
      <span className="absolute inset-y-0 left-0 bg-[var(--synnical-accent)]/12" style={{ width: `${pct}%` }} />
      <span className="relative min-w-0 flex-1 truncate">{option.label}</span><span className="relative ml-3 text-[var(--synnical-muted)]">{option.count} · {pct}%</span>
    </button> })}</div>
  </div>
}

type MessageRowProps = {
  m: ChatMessage
  currentUser: SafeUser
  editing: boolean
  editContent: string
  onEditContentChange: (v: string) => void
  onStartEdit: (m: ChatMessage) => void
  onCancelEdit: () => void
  onSaveEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
  onReply: (m: ChatMessage) => void
  onJumpToReply: (messageId: string) => void
  onQuote: (m: ChatMessage) => void
  onReport: (m: ChatMessage) => void
  onOpenDM: (userId: string, name: string) => void
  onMention: (name: string) => void
  onToggleReaction: (m: ChatMessage, emoji: string) => void
  onFeatureTools: (m: ChatMessage) => void
  onToggleSaved: (m: ChatMessage) => void
}

const MessageRow = React.memo(function MessageRow({
  m, currentUser, editing, editContent, onEditContentChange,
  onStartEdit, onCancelEdit, onSaveEdit, onDelete, onReply, onJumpToReply, onQuote, onReport, onOpenDM, onMention, onToggleReaction, onFeatureTools, onToggleSaved,
}: MessageRowProps) {
  // Must be called before any conditional return — rules of hooks.
  const viewProfile = useViewProfile()

  const own = m.userId === currentUser.id
  const role = (m.role || "MEMBER") as Role
  const name = m.displayName || m.username
  const mentioned = messageNotification(m, currentUser.id)

  const markdownComponents: Components = {
    a: ({ node: _node, ...props }) => {
      // If autoEmbed is disabled, render links as plain text
      if (!readSetting("chat.autoEmbed", true)) {
        return <span className="text-[var(--synnical-muted)]">{props.href}</span>
      }
      return (
        <a {...props} target="_blank" rel="noreferrer" className="text-[var(--synnical-accent)] underline hover:text-[var(--synnical-accent)]" />
      )
    },
    p: ({ node: _node, children }) => (
      <p className="text-sm text-[var(--synnical-text)]/90 break-words whitespace-pre-wrap leading-relaxed">
        {processMentions(children, onMention)}
      </p>
    ),
    strong: ({ node: _node, children }) => (
      <strong className="font-semibold text-[var(--synnical-text)]">{processMentions(children, onMention)}</strong>
    ),
    em: ({ node: _node, children }) => (
      <em className="italic">{processMentions(children, onMention)}</em>
    ),
    del: ({ node: _node, children }) => (
      <del className="line-through opacity-70">{processMentions(children, onMention)}</del>
    ),
    code: ({ node: _node, ...props }) => (
      <code {...props} className="bg-[var(--synnical-surface-2)] px-1 py-0.5 rounded text-xs font-mono text-[var(--synnical-accent)]" />
    ),
    pre: ({ node: _node, ...props }) => (
      <pre {...props} className="bg-[var(--synnical-surface-2)] p-2 rounded text-xs font-mono overflow-x-auto my-1" />
    ),
    ul: ({ node: _node, ...props }) => <ul {...props} className="list-disc pl-4 text-sm" />,
    ol: ({ node: _node, ...props }) => <ol {...props} className="list-decimal pl-4 text-sm" />,
  }

  if (m.deleted) {
    if (!readSetting("chat.showDeleted", false)) return null
    return (
      <div className="flex gap-2.5 opacity-50">
        <div className="h-8 w-8 shrink-0" />
        <p className="text-xs italic text-[var(--synnical-muted)] pt-2">Message deleted</p>
      </div>
    )
  }

  const handleAvatarClick = () => {
    if (own || !m.userId) return
    onOpenDM(m.userId, name)
  }

  return (
    <div id={`message-${m.id}`} style={{ contentVisibility: "auto", containIntrinsicSize: "88px" }} className={cn("message-group group flex gap-2.5 rounded-lg border-l-2 border-transparent px-2 py-1", m.failedLocal && "border-red-400/60 bg-red-400/5", mentioned && "border-amber-300 bg-amber-300/10 ring-1 ring-inset ring-amber-200/10")}>
      {/* Clicking an avatar opens that person's profile card, the way Discord
          does it. Double-click still opens a DM. */}
      {readSetting("chat.showAvatars", true) && (
      <button
        type="button"
        onClick={() => { if (m.userId) viewProfile(m.userId) }}
        onDoubleClick={handleAvatarClick}
        disabled={!m.userId}
        className={cn("mt-0.5 shrink-0 rounded-full", m.userId ? "cursor-pointer hover:ring-2 hover:ring-[var(--synnical-accent)]/40 transition" : "cursor-default")}
        title={m.userId ? `View ${name}'s profile` : undefined}
        aria-label={m.userId ? `View ${name}'s profile` : "Avatar"}
      >
        <AvatarWithDeco src={m.pfpUrl} name={name} role={role} avatarDeco={m.avatarDeco} isGif={m.pfpIsGif} size="sm" />
      </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={() => { if (m.userId) viewProfile(m.userId) }}
            disabled={!m.userId}
            className={cn(m.userId ? "cursor-pointer hover:underline" : "cursor-default")}
            title={m.userId ? `View ${name}'s profile` : undefined}
          >
            <DisplayName name={name} role={role} className="text-sm font-semibold" />
          </button>
          {readSetting("chat.showRoleBadges", true) && <RoleBadge role={role} tags={m.tags} />}
          {m.isBot && <span className="rounded border border-cyan-300/40 bg-cyan-300/10 px-1 py-0.5 text-[9px] font-bold tracking-wide text-cyan-200">BOT</span>}
          {readSetting("chat.showTimestamps", true) && (
            <span className="text-[10px] text-[var(--synnical-muted)]">
              {new Date(m.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                hour12: !readSetting("chat.24hTime", false),
              })}
            </span>
          )}
          {m.edited && readSetting("chat.editHistory", true) && <span className="text-[10px] text-[var(--synnical-muted)] italic">(edited)</span>}
          {m.failedLocal && <span className="text-[10px] font-medium text-red-300">Not sent</span>}
          {!m.pendingLocal && !m.failedLocal && <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <EmojiReactionPicker onSelect={(emoji) => onToggleReaction(m, emoji)} />
            <button
              type="button"
              onClick={() => onReply(m)}
              className="text-[var(--synnical-muted)] hover:text-[var(--synnical-accent)] p-1"
              aria-label="Reply to message"
              title="Reply"
            >
              <Reply className="h-3 w-3" />
            </button>
            {!own && m.userId && (
              <button
                type="button"
                onClick={() => onReport(m)}
                className="text-[var(--synnical-muted)] hover:text-amber-400 p-1"
                aria-label="Report message"
                title="Report unsafe content"
              >
                <Flag className="h-3 w-3" />
              </button>
            )}
            <button type="button" onClick={() => onToggleSaved(m)} className="p-1 text-[var(--synnical-muted)] hover:text-amber-300" aria-label="Bookmark message" title="Bookmark"><Star className="h-3 w-3" /></button>
            <button type="button" onClick={() => onFeatureTools(m)} className="p-1 text-[var(--synnical-muted)] hover:text-[var(--synnical-accent)]" aria-label="Message tools" title="Thread, edit history, translate"><SlidersHorizontal className="h-3 w-3" /></button>
            <button
              type="button"
              onClick={() => onQuote(m)}
              className="text-[var(--synnical-muted)] hover:text-[var(--synnical-accent)] p-1"
              aria-label="Quote message"
              title="Quote in message"
            >
              <Quote className="h-3 w-3" />
            </button>
            {own && !editing && (
              <button
                type="button"
                onClick={() => onStartEdit(m)}
                className="text-[var(--synnical-muted)] hover:text-[var(--synnical-accent)] p-1"
                aria-label="Edit message"
                title="Edit"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {canDeleteMessage(currentUser.role, currentUser.id, role, m.userId) && (
              <button
                type="button"
                onClick={() => onDelete(m)}
                className="text-[var(--synnical-muted)] hover:text-[#ef4444] p-1"
                aria-label="Delete message"
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>}
        </div>
        {editing ? (
          <div className="flex gap-1.5 mt-0.5">
            <Input
              value={editContent}
              onChange={(e) => onEditContentChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onSaveEdit({ ...m, content: editContent }) }
                if (e.key === "Escape") { onCancelEdit() }
              }}
              className="h-7 text-sm flex-1"
              autoFocus
            />
            <Button size="sm" className="h-7 px-2 bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black" onClick={() => onSaveEdit({ ...m, content: editContent })}>Save</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCancelEdit}>Cancel</Button>
          </div>
        ) : (
          <div className="space-y-1">
            {m.replyToId && (
              <button
                type="button"
                onClick={() => onJumpToReply(m.replyToId!)}
                className="flex max-w-full items-start gap-2 border-l-2 border-[var(--synnical-accent)]/55 bg-white/[.025] px-2 py-1 text-left hover:bg-white/[.045]"
                title="Jump to original message"
              >
                <Reply className="mt-0.5 h-3 w-3 shrink-0 text-[var(--synnical-accent)]" />
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-semibold text-[var(--synnical-accent)]">{m.replyToName || "Original message"}</span>
                  <span className="block truncate text-[11px] text-[var(--synnical-muted)]">{m.replyToContent || "Message"}</span>
                </span>
              </button>
            )}
            <EpisodeSpoilerReveal message={m}>
            {m.messageType === "poll" ? <InlinePoll messageId={m.id} /> : m.content ? (
              <div className={cn("prose-sm max-w-none", readSetting("chat.compactEmoji", false) && "compact-emoji")}>
                {m.content.split(/(\|\|[\s\S]*?\|\|)/g).filter(Boolean).map((part, index) => {
                  const spoiler = part.startsWith("||") && part.endsWith("||") && part.length >= 4
                  if (spoiler) return <SpoilerReveal key={`${m.id}:spoiler:${index}`} text={part.slice(2, -2)} />
                  return <ReactMarkdown key={`${m.id}:markdown:${index}`} remarkPlugins={[remarkGfm]} components={markdownComponents}>{part}</ReactMarkdown>
                })}
              </div>
            ) : null}
            {m.voiceUrl && <VoiceMessage url={m.voiceUrl} transcript={m.voiceTranscript} />}
            {m.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.imageUrl}
                data-image-viewer={m.imageUrl} role="button" tabIndex={0} aria-label="Open image"
                alt="Image message"
                className="mt-1 block min-h-24 max-h-80 max-w-full rounded-sm border border-[var(--synnical-border)] bg-[#080808] object-contain"
                loading="lazy"
                decoding="async"
              />
            )}
            {m.gifUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.gifUrl}
                data-image-viewer={m.gifUrl} role="button" tabIndex={0} aria-label="Open GIF"
                alt="GIF message"
                className="mt-1 block min-h-24 max-h-64 max-w-full rounded-sm border border-[var(--synnical-border)] bg-[#080808] object-contain"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            )}
            </EpisodeSpoilerReveal>
            {(m.reactions?.length || 0) > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {m.reactions!.map((reaction) => (
                  <button key={reaction.emoji} type="button" onClick={() => onToggleReaction(m, reaction.emoji)} className={cn("flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors", reaction.reacted ? "border-[var(--synnical-accent)] bg-[var(--synnical-accent)]/16 text-white" : "border-[var(--synnical-border)] bg-white/[.025] text-[var(--synnical-muted)] hover:border-[var(--synnical-accent)]/50") } aria-label={`${reaction.reacted ? "Remove" : "Add"} ${reaction.emoji} reaction`}><span>{reaction.emoji}</span><span className="text-[10px] font-semibold">{reaction.count}</span></button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
