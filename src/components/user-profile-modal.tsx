"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { Loader2, MessageSquare, CalendarDays, AlertCircle, Link2, Music, Gamepad2, Trophy, ExternalLink, UserPlus } from "lucide-react"
import { io } from "socket.io-client"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { AvatarWithDeco, DisplayName, RoleBadge, TagsDisplay } from "@/components/role-ui"
import { ProfileCardFrame } from "@/components/profile-card-preview"
import { profileThemeTextColor } from "@/lib/profile-theme"
import { api, type SafeUser } from "@/lib/api"
import { getPlatform, type Connection } from "@/lib/connections"
import { readSetting } from "@/lib/settings-runtime"
import { onlineDurationLabel, presenceSectionLabel, publicPresenceLabel, type PublicPresence } from "@/lib/presence"
import { cn } from "@/lib/utils"

type ProfileUser = SafeUser

type ProfilePayload = {
  user: ProfileUser
  stats: { messageCount: number; joinedAt: string | null }
  isSelf: boolean
  privateProfile?: boolean
  privacy?: Record<string, boolean>
  connections: Connection[]
  persona?: { id: string; name: string; mood?: string; accent?: string } | null
  identityExtras?: Array<{ id: string; kind: string; title: string; data?: Record<string, unknown>; updatedAt?: string }>
  visitorBoard?: Array<{ id: string; kind: string; text: string; author?: { id: string; username: string; displayName: string; pfpUrl?: string | null } | null; createdAt: string }>
}

type OnlineEntry = PublicPresence & { userId?: unknown }

type FeatureProfilePayload = {
  profile?: {
    pronouns?: string; birthday?: string | null; profileAccentGradient?: string; bannerPositionX?: number; bannerPositionY?: number;
    profileMusic?: { provider?: "audius" | "piped" | "invidious"; trackId?: string; title?: string; artist?: string; artwork?: string } | null;
    gameStatus?: string; musicActivity?: { title?: string; artist?: string; isPlaying?: boolean } | null;
  };
  links?: Array<{ id: string; label: string; url: string; domain: string; verifiedAt?: string | null }>;
  showcases?: Array<{ id: string; kind: string; refId: string; label: string }>;
  achievements?: Array<{ achievementId: string; achievement?: { name?: string; description?: string } | null }>;
  visitorCount?: number | null;
}



function ProfileTrackAudio({ track }: { track: NonNullable<NonNullable<FeatureProfilePayload["profile"]>["profileMusic"]> }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const provider = track.provider || "audius"
  const src = provider === "audius"
    ? `/api/music/audius/stream/${encodeURIComponent(track.trackId || "")}`
    : `/api/music/bridge/stream?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(track.trackId || "")}`

  useEffect(() => {
    const audio = ref.current
    if (!audio) return
    const outputVolume = Math.max(0, Math.min(100, Number(readSetting("voice.outputVolume", 100))))
    audio.volume = outputVolume / 100
    const outputDevice = String(readSetting("voice.outputDevice", "default") || "default")
    const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> }
    if (typeof sinkAudio.setSinkId === "function") void sinkAudio.setSinkId(outputDevice === "default" ? "" : outputDevice).catch(() => {})
  }, [src])

  if (!track.trackId) return null
  return <audio ref={ref} controls preload="none" src={src} className="mt-2 h-8 w-full" aria-label={`${track.title || "Profile track"} audio`} />
}

const ViewProfileContext = createContext<(userId: string) => void>(() => {})

export function useViewProfile() {
  return useContext(ViewProfileContext)
}

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const [targetId, setTargetId] = useState<string | null>(null)
  const open = useCallback((userId: string) => { if (userId) setTargetId(userId) }, [])
  return (
    <ViewProfileContext.Provider value={open}>
      {children}
      <UserProfileModal userId={targetId} onClose={() => setTargetId(null)} />
    </ViewProfileContext.Provider>
  )
}

export function UserProfileModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const [data, setData] = useState<ProfilePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [presenceKnown, setPresenceKnown] = useState(false)
  const [isOnline, setIsOnline] = useState(false)
  const [presenceEntry, setPresenceEntry] = useState<OnlineEntry | null>(null)
  const [featureProfile, setFeatureProfile] = useState<FeatureProfilePayload | null>(null)
  const [friendBusy, setFriendBusy] = useState(false)
  const [friendNotice, setFriendNotice] = useState<string | null>(null)


  useEffect(() => {
    if (!userId) {
      setPresenceKnown(false)
      setIsOnline(false)
      setPresenceEntry(null)
      return
    }
    setPresenceKnown(false)
    setIsOnline(false)
    setPresenceEntry(null)
    const socket = io({
      path: process.env.NEXT_PUBLIC_SOCKET_URL || "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
    })
    const receive = (payload: { users?: OnlineEntry[] }) => {
      const users = Array.isArray(payload?.users) ? payload.users : []
      const entry = users.find((candidate) => candidate?.userId === userId) || null
      setPresenceEntry(entry)
      setIsOnline(Boolean(entry))
      setPresenceKnown(true)
    }
    socket.on("connect", () => socket.emit("who-is-online"))
    socket.on("online-users", receive)
    socket.on("connect_error", () => {
      setIsOnline(false)
      setPresenceEntry(null)
      setPresenceKnown(true)
    })
    return () => { socket.off("online-users", receive); socket.disconnect() }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setData(null)
      setError(null)
      setFriendNotice(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setData(null)
    setFriendNotice(null)
    fetch(`/api/profile/${encodeURIComponent(userId)}`, { signal: controller.signal, credentials: "include" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || "Could not load that profile")
        return body as ProfilePayload
      })
      .then((body) => { if (!cancelled) setData(body) })
      .catch((reason: unknown) => {
        if (cancelled || (reason instanceof Error && reason.name === "AbortError")) return
        setError(reason instanceof Error ? reason.message : "Could not load that profile")
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [userId])

  useEffect(() => {
    if (!userId) { setFeatureProfile(null); return }
    const controller = new AbortController()
    fetch(`/api/features/profile?userId=${encodeURIComponent(userId)}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (res) => res.ok ? res.json() : null)
      .then((body) => { if (!controller.signal.aborted) setFeatureProfile(body) })
      .catch(() => {})
    return () => controller.abort()
  }, [userId])

  const user = data?.user
  const connections = data?.connections || []
  const joined = data?.stats.joinedAt ? new Date(data.stats.joinedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null
  const showOnline = readSetting("profile.showOnline", true)
  const showActivity = readSetting("profile.showActivity", true)
  const showLastSeen = readSetting("profile.showLastSeen", false)
  const showStats = readSetting("profile.showStats", true)
  const showConnections = readSetting("profile.showConnections", true)
  const profileBg = readSetting("profile.background", "")

  const themeText = user ? profileThemeTextColor(user.profileThemePrimary, user.profileThemeAccent) : "#ffffff"
  const themeMuted = themeText === "#111111" ? "rgba(17,17,17,.68)" : "rgba(255,255,255,.68)"
  const themeSurface = themeText === "#111111" ? "rgba(255,255,255,.42)" : "rgba(0,0,0,.28)"
  const themeBorder = themeText === "#111111" ? "rgba(17,17,17,.18)" : "rgba(255,255,255,.16)"

  const leaveProfileBoard = async (kind: "visitor-question" | "visitor-sticker") => {
    if (!userId || data?.isSelf) return
    const label = kind === "visitor-question" ? "Ask a profile question" : "Leave a profile sticker"
    const value = window.prompt(label)?.trim()
    if (!value) return
    const res = await fetch("/api/features/identity", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: kind, targetId: userId, text: value }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setError(body?.error || "Could not update profile wall"); return }
    const refreshed = await fetch(`/api/profile/${encodeURIComponent(userId)}`, { credentials: "include", cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null)
    if (refreshed) setData(refreshed)
  }

  const sendProfileFriendRequest = async () => {
    if (!user || data?.isSelf || friendBusy) return
    setFriendBusy(true)
    setFriendNotice(null)
    try {
      await api.sendFriendRequest(user.username)
      setFriendNotice("Friend request sent")
    } catch (reason) {
      setFriendNotice(reason instanceof Error ? reason.message : "Could not send friend request")
    } finally {
      setFriendBusy(false)
    }
  }

  return (
    <Dialog open={!!userId} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent showCloseButton={false} className="synnical-profile-modal max-w-[372px] border-0 bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">{user ? `${user.displayName}'s profile` : "Profile"}</DialogTitle>
        {loading && <div className="flex h-56 items-center justify-center rounded-[22px] border border-[var(--synnical-glass-border)] bg-[var(--synnical-glass-strong)] shadow-[var(--synnical-shadow)] backdrop-blur-xl"><Loader2 className="h-5 w-5 animate-spin text-[var(--synnical-muted)]" /></div>}
        {error && !loading && <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-[22px] border border-[var(--synnical-glass-border)] bg-[var(--synnical-glass-strong)] px-6 text-center shadow-[var(--synnical-shadow)] backdrop-blur-xl"><AlertCircle className="h-5 w-5 text-red-400" /><p className="text-sm text-[var(--synnical-muted)]">{error}</p></div>}
        {user && !loading && (
          <ProfileCardFrame user={user} className="synnical-profile-card">
            <DialogClose aria-label="Close profile" className="absolute right-3 top-3 z-30 grid h-8 w-8 place-items-center rounded-full border text-sm shadow-sm transition-colors" style={{ background: themeSurface, borderColor: themeBorder, color: themeText }}>×</DialogClose>
            <div className="relative h-[27%] min-h-[92px] max-h-[170px] overflow-hidden bg-black/20">
              {user.bannerUrl && <img data-image-viewer={user.bannerUrl} role="button" tabIndex={0} aria-label="Open uploaded image" src={user.bannerUrl} alt="" className="h-full w-full object-cover" style={{ objectPosition: `${featureProfile?.profile?.bannerPositionX ?? 50}% ${featureProfile?.profile?.bannerPositionY ?? 50}%` }} loading={user.bannerIsGif ? "eager" : "lazy"} decoding={user.bannerIsGif ? "sync" : "async"} />}
              {featureProfile?.profile?.profileAccentGradient && <div className="pointer-events-none absolute inset-0 opacity-25" style={{ background: featureProfile.profile.profileAccentGradient }} />}
            </div>
            <div className="relative px-4 pb-5" style={{ color: themeText }}>
              <div className="-mt-11 mb-3 w-fit"><AvatarWithDeco src={user.pfpUrl} name={user.displayName} role={user.role} avatarDeco={user.avatarDeco} isGif={user.pfpIsGif} size="xl" avatarClassName="border-4 border-black/35" /></div>
              <div className="flex flex-wrap items-center gap-2">
                <DisplayName name={user.displayName} role={user.role} className="text-lg font-semibold" />
                <RoleBadge role={user.role} tags={user.tags} />
                {data.privateProfile && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-medium text-red-200">Limited profile</span>}
                {user.tags?.length ? <TagsDisplay tags={user.tags} className="mt-1 w-full" /> : null}
              </div>
              <p className="text-sm" style={{ color: themeMuted }}>@{user.username}</p>
              {data.persona && <p className="mt-0.5 text-[10px]" style={{ color: themeMuted }}>Persona · {data.persona.name}{data.persona.mood ? ` · ${data.persona.mood}` : ""}</p>}
              {data.privateProfile && <p className="mt-2 rounded-lg border border-white/10 px-3 py-2 text-xs" style={{ color: themeMuted, background: themeSurface }}>This account limits what you can see. Synnical applies these privacy rules on the server.</p>}
              {(featureProfile?.profile?.pronouns || featureProfile?.profile?.birthday) && <p className="mt-1 text-xs" style={{ color: themeMuted }}>{[featureProfile.profile.pronouns, featureProfile.profile.birthday ? `Birthday ${new Date(`${featureProfile.profile.birthday}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""].filter(Boolean).join(" · ")}</p>}
              {showOnline && (
                <span className={cn("mt-1 inline-flex items-center gap-1.5 text-xs", !presenceKnown ? "opacity-60" : isOnline ? "text-emerald-400" : "opacity-60")}>
                  <span className={cn("h-2 w-2 rounded-full", !presenceKnown ? "bg-current opacity-40" : isOnline ? "bg-emerald-500" : "bg-current opacity-40")} />
                  {!presenceKnown ? "Checking status…" : isOnline ? publicPresenceLabel(presenceEntry?.presenceMode, presenceEntry?.afk, presenceEntry?.presenceModeExpiresAt) : "Offline"}
                </span>
              )}
              {showOnline && presenceKnown && isOnline && (presenceEntry?.currentSection || (presenceEntry?.deviceType && presenceEntry.deviceType !== "unknown") || (presenceEntry?.networkQuality && presenceEntry.networkQuality !== "unknown") || presenceEntry?.onlineSince || (presenceEntry?.afk && presenceEntry.afkMessage)) && (
                <p className="mt-1 text-[10px]" style={{ color: themeMuted }}>
                  {[
                    presenceEntry?.afk && presenceEntry.afkMessage ? presenceEntry.afkMessage : null,
                    presenceSectionLabel(presenceEntry?.currentSection),
                    presenceEntry?.deviceType && presenceEntry.deviceType !== "unknown" ? presenceEntry.deviceType.charAt(0).toUpperCase() + presenceEntry.deviceType.slice(1) : null,
                    presenceEntry?.networkQuality && presenceEntry.networkQuality !== "unknown" ? `${presenceEntry.networkQuality.charAt(0).toUpperCase() + presenceEntry.networkQuality.slice(1)} connection` : null,
                    onlineDurationLabel(presenceEntry?.onlineSince),
                  ].filter(Boolean).join(" · ")}
                </p>
              )}
              {showActivity && user.status && <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: themeSurface }}>{user.status}</p>}
              {user.bio && <div className="mt-3"><p className="mb-1 text-[10px] font-semibold uppercase tracking-[.12em]" style={{ color: themeMuted }}>About me</p><p className="whitespace-pre-wrap break-words text-sm leading-5">{user.bio}</p></div>}
              {!!data.identityExtras?.length && <div className="mt-3"><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.12em]" style={{ color: themeMuted }}>Profile cards</p><div className="space-y-1.5">{data.identityExtras.slice(0,8).map((item) => <div key={item.id} className="rounded-lg border px-2.5 py-2" style={{ borderColor: themeBorder, background: themeSurface }}><p className="text-xs font-medium">{item.title}</p><p className="mt-0.5 text-[11px]" style={{ color: themeMuted }}>{item.kind === "profile-riddle" ? "Riddle" : String(item.data?.answer || item.data?.level || item.data?.description || item.kind.replace("profile-", "").replaceAll("-", " "))}</p></div>)}</div></div>}
              {!!data.visitorBoard?.length && <div className="mt-3"><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.12em]" style={{ color: themeMuted }}>Friend wall</p><div className="space-y-1">{data.visitorBoard.slice(0,6).map((item) => <div key={item.id} className="rounded-lg border px-2.5 py-2 text-xs" style={{ borderColor: themeBorder, background: themeSurface }}><span className="font-medium">@{item.author?.username || "friend"}</span><span style={{ color: themeMuted }}> · {item.kind === "profile-question" ? "asked" : "left"}</span><p className="mt-0.5">{item.text}</p></div>)}</div></div>}
              {!data.isSelf && <div className="mt-2 flex flex-wrap items-center gap-1.5"><button onClick={() => void sendProfileFriendRequest()} disabled={friendBusy} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] disabled:opacity-60" style={{ borderColor: themeBorder, background: themeSurface }}><UserPlus className="h-3 w-3" />{friendBusy ? "Sending..." : "Add friend"}</button>{!data.privateProfile ? <><button onClick={() => void leaveProfileBoard("visitor-question")} className="rounded-md border px-2 py-1 text-[10px]" style={{ borderColor: themeBorder, background: themeSurface }}>Ask question</button><button onClick={() => void leaveProfileBoard("visitor-sticker")} className="rounded-md border px-2 py-1 text-[10px]" style={{ borderColor: themeBorder, background: themeSurface }}>Leave sticker</button></> : null}{friendNotice ? <span className="w-full text-[10px]" style={{ color: themeMuted }}>{friendNotice}</span> : null}</div>}
              {showOnline && isOnline && presenceEntry?.activity && <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: themeSurface }}><p className="font-semibold">Rich Presence</p><p>{presenceEntry.activity.kind}: {presenceEntry.activity.name}</p>{presenceEntry.activity.details && <p className="opacity-70">{presenceEntry.activity.details}</p>}</div>}
              {featureProfile?.profile?.gameStatus && <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: themeSurface }}><span className="inline-flex items-center gap-1.5"><Gamepad2 className="h-3.5 w-3.5" />Playing {featureProfile.profile.gameStatus}</span></div>}
              {(featureProfile?.profile?.profileMusic?.title || featureProfile?.profile?.musicActivity?.title) && <div className="mt-3 rounded-lg px-3 py-2" style={{ background: themeSurface }}><p className="text-[10px] font-semibold uppercase tracking-[.12em]" style={{ color: themeMuted }}>Music</p><p className="mt-1 inline-flex items-center gap-1.5 text-xs"><Music className="h-3.5 w-3.5" />{featureProfile.profile.musicActivity?.isPlaying ? "Listening to " : "Profile track · "}{featureProfile.profile.musicActivity?.title || featureProfile.profile.profileMusic?.title}{(featureProfile.profile.musicActivity?.artist || featureProfile.profile.profileMusic?.artist) ? ` · ${featureProfile.profile.musicActivity?.artist || featureProfile.profile.profileMusic?.artist}` : ""}</p>{featureProfile.profile.profileMusic?.trackId && <ProfileTrackAudio track={featureProfile.profile.profileMusic} />}</div>}
              {!!featureProfile?.links?.length && <div className="mt-3"><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.12em]" style={{ color: themeMuted }}>Verified links</p><div className="flex flex-wrap gap-1.5">{featureProfile.links.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs" style={{ borderColor: themeBorder, background: themeSurface }}><Link2 className="h-3 w-3" />{link.label}<ExternalLink className="h-3 w-3 opacity-50" /></a>)}</div></div>}
              {!!featureProfile?.showcases?.length && <div className="mt-3"><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.12em]" style={{ color: themeMuted }}>Showcase</p><div className="flex flex-wrap gap-1.5">{featureProfile.showcases.map((item) => <span key={item.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs" style={{ borderColor: themeBorder, background: themeSurface }}>{item.kind === "achievement" ? <Trophy className="h-3 w-3" /> : item.kind === "game" ? <Gamepad2 className="h-3 w-3" /> : null}{item.label}</span>)}</div></div>}
              {showConnections && connections.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.12em]" style={{ color: themeMuted }}>Connections</p>
                  <div className="flex flex-wrap gap-1.5">
                    {connections.map((connection) => {
                      const platform = getPlatform(connection.platform)
                      return (
                        <div key={connection.id} className="inline-flex items-center gap-1.5 rounded-md border py-1 pl-1 pr-2" style={{ borderColor: themeBorder, background: themeSurface }} title={platform ? `${platform.name}: ${connection.username}` : connection.username}>
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded" style={platform ? { backgroundColor: `#${platform.color}1a` } : undefined}>{platform ? <img src={platform.iconUrl} alt={platform.name} className="h-3.5 w-3.5" /> : null}</div>
                          <span className="max-w-[120px] truncate text-xs">{connection.username}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-3 border-t pt-3 text-xs" style={{ borderColor: themeBorder, color: themeMuted }}>
                {showStats && data.privacy?.stats !== false && <span className="inline-flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" />{data.stats.messageCount.toLocaleString()} messages</span>}
                {showLastSeen && presenceKnown && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{isOnline ? "Active now" : "Currently offline"}</span>}
                {joined && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Joined {joined}</span>}
              </div>
            </div>
          </ProfileCardFrame>
        )}
      </DialogContent>
    </Dialog>
  )
}
