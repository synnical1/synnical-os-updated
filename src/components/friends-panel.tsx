"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { io, type Socket } from "socket.io-client"
import { api, type SafeUser, type FriendUser, type DM, type ChatMessage, type Role } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Users, UserPlus, Send, Check, X, MessageSquare, ArrowLeft, Loader2, ShieldAlert, Ban, Flag, Star, Heart, Cake, Pencil, HeartHandshake } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { DisplayName, RoleBadge, AvatarWithDeco } from "@/components/role-ui"
import { readSetting } from "@/lib/settings-runtime"
import { featureApi } from "@/lib/feature-api"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { presenceSectionLabel, publicPresenceLabel, type PublicPresence } from "@/lib/presence"
import { FriendshipSocialDialog } from "@/components/friendship-social-dialog"

type FriendPresence = PublicPresence & { userId: string }

export function FriendsPanel() {
  const { user, setUser } = useAuth()
  const [tab, setTab] = useState<"friends" | "requests" | "add">("friends")
  const [friends, setFriends] = useState<FriendUser[]>([])
  const [incoming, setIncoming] = useState<SafeUser[]>([])
  const [outgoing, setOutgoing] = useState<SafeUser[]>([])
  const [dms, setDms] = useState<DM[]>([])
  const [addUsername, setAddUsername] = useState("")
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [editingFriend, setEditingFriend] = useState<FriendUser | null>(null)
  const [friendNickname, setFriendNickname] = useState("")
  const [friendNote, setFriendNote] = useState("")
  const [friendLabel, setFriendLabel] = useState("")
  const [socialFriend, setSocialFriend] = useState<FriendUser | null>(null)
  const [friendMetaBusy, setFriendMetaBusy] = useState(false)
  const [onlinePresence, setOnlinePresence] = useState<Record<string, FriendPresence>>({})

  const birthdayIsToday = (value?: string | null) => {
    if (!value) return false
    const match = value.match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/)
    if (!match) return false
    const now = new Date()
    return Number(match[1]) === now.getMonth() + 1 && Number(match[2]) === now.getDate()
  }

  const updateFriendMeta = async (friend: FriendUser, patch: Partial<FriendUser["friendMeta"]>) => {
    setFriendMetaBusy(true)
    try {
      const next = { ...friend.friendMeta, ...patch }
      await featureApi.profile.friendMeta(friend.id, next)
      setFriends((prev) => prev.map((item) => item.id === friend.id ? { ...item, friendMeta: next } : item))
      if (editingFriend?.id === friend.id) setEditingFriend({ ...friend, friendMeta: next })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update friend")
    } finally {
      setFriendMetaBusy(false)
    }
  }

  const openFriendEditor = (friend: FriendUser) => {
    setEditingFriend(friend)
    setFriendNickname(friend.friendMeta.nickname)
    setFriendNote(friend.friendMeta.note)
    setFriendLabel(friend.friendMeta.label)
  }

  const saveFriendEditor = async () => {
    if (!editingFriend) return
    await updateFriendMeta(editingFriend, { nickname: friendNickname.trim().slice(0, 64), note: friendNote.trim().slice(0, 500), label: friendLabel.trim().slice(0, 32) })
    setEditingFriend(null)
  }

  const loadAll = useCallback(async () => {
    try {
      const [f, d] = await Promise.all([api.listFriends(), api.listDMs()])
      setFriends(f.friends); setIncoming(f.incoming); setOutgoing(f.outgoing)
      setDms(d.dms)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (!user) { setOnlinePresence({}); return }
    const socket = io({
      path: process.env.NEXT_PUBLIC_SOCKET_URL || "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
    })
    const receive = (payload: { users?: FriendPresence[] }) => {
      const users = Array.isArray(payload?.users) ? payload.users : []
      const next: Record<string, FriendPresence> = {}
      for (const entry of users) if (entry?.userId) next[entry.userId] = entry
      setOnlinePresence(next)
    }
    socket.on("connect", () => socket.emit("who-is-online"))
    socket.on("online-users", receive)
    socket.on("connect_error", () => setOnlinePresence({}))
    return () => { socket.off("online-users", receive); socket.disconnect() }
  }, [user?.id])

  const sendRequest = async () => {
    const u = addUsername.trim()
    if (!u) return
    try {
      await api.sendFriendRequest(u)
      toast.success(`Friend request sent to @${u}`)
      setAddUsername("")
      loadAll()
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
  }

  const acceptReq = async (id: string) => {
    try { await api.acceptFriendRequest(id); toast.success("Friend added"); loadAll() }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
  }
  const declineReq = async (id: string) => {
    try {
      const result = await api.declineFriendRequest(id)
      const until = result.blockedUntil ? new Date(result.blockedUntil).toLocaleString() : "3 days"
      toast.success(`Request declined. They cannot message you until ${until}.`)
      loadAll()
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
  }
  const removeFriend = async (id: string) => {
    try { await api.removeFriend(id); toast.success("Friend removed"); loadAll() }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
  }

  const openDM = async (u: SafeUser) => {
    try {
      const { id } = await api.createDM(u.id)
      setDmChannelId(id)
      setDmOther(u)
      setTab("friends")
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
  }

  const [dmChannelId, setDmChannelId] = useState<string | null>(null)
  const [dmOther, setDmOther] = useState<SafeUser | null>(null)

  if (!user) return null

  if (dmChannelId && dmOther) {
    return <DMConversation channelId={dmChannelId} other={dmOther} onBack={() => { setDmChannelId(null); setDmOther(null); loadAll() }} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 shrink-0 px-4 flex items-center gap-2 border-b border-[var(--synnical-border)]">
        <Users className="h-4 w-4 text-[var(--synnical-accent)]" />
        <span className="font-semibold">Friends</span>
        <div className="flex-1" />
        <div className="flex gap-1">
          <Button variant={tab === "friends" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setTab("friends")}>Friends</Button>
          <Button variant={tab === "requests" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs relative" onClick={() => setTab("requests")}>
            Requests {incoming.length > 0 && <span className="ml-1 bg-[var(--synnical-accent)] text-black text-[9px] px-1.5 rounded-full">{incoming.length}</span>}
          </Button>
          <Button variant={tab === "add" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setTab("add")}><UserPlus className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll">
        {loading ? <div className="p-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--synnical-muted)]" /></div> :
          tab === "add" ? (
            <div className="p-4 max-w-md">
              <h3 className="text-sm font-semibold mb-2">Add a friend</h3>
              {!readSetting("friends.allowRequests", true) ? (
                <p className="text-xs text-[var(--synnical-muted)] py-4">Not accepting friend requests right now.</p>
              ) : (
                <>
                  <p className="text-xs text-[var(--synnical-muted)] mb-3">Enter their username to send a friend request.</p>
                  {readSetting("friends.autoAccept", false) && (
                    <p className="text-xs text-emerald-400 mb-2">Auto-accept is ON — incoming requests will be accepted automatically.</p>
                  )}
                  <div className="flex gap-2">
                    <Input value={addUsername} onChange={(e) => setAddUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendRequest()} placeholder="username" autoFocus />
                    <Button onClick={sendRequest} disabled={!addUsername.trim() || friends.length >= readSetting("friends.maxFriends", 1000)} className="bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black">Send</Button>
                  </div>
                  {friends.length >= readSetting("friends.maxFriends", 1000) && (
                    <p className="text-xs text-amber-400 mt-2">Friend limit reached ({friends.length} / {readSetting("friends.maxFriends", 1000)}).</p>
                  )}
                </>
              )}
              {outgoing.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-semibold uppercase text-[var(--synnical-muted)] mb-2">Pending requests sent</p>
                  {outgoing.map((u) => (
                    <div key={u.id} className="flex items-center gap-2 py-2">
                      <AvatarWithDeco src={u.pfpUrl} name={u.displayName} role={u.role} avatarDeco={u.avatarDeco} size="sm" />
                      <div className="flex-1 min-w-0"><DisplayName name={u.displayName} role={u.role} className="text-sm" /><p className="text-xs text-[var(--synnical-muted)]">@{u.username}</p></div>
                      <span className="text-xs text-[var(--synnical-muted)]">Pending</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : tab === "requests" ? (
            <div className="p-4">
              {incoming.length === 0 ? <p className="text-sm text-[var(--synnical-muted)] text-center py-8">No incoming requests</p> :
                incoming.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 py-2 border-b border-[var(--synnical-border)] last:border-0">
                    <AvatarWithDeco src={u.pfpUrl} name={u.displayName} role={u.role} avatarDeco={u.avatarDeco} size="sm" />
                    <div className="flex-1 min-w-0"><DisplayName name={u.displayName} role={u.role} className="text-sm" /><p className="text-xs text-[var(--synnical-muted)]">@{u.username}</p></div>
                    <Button size="sm" className="h-7 bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black" onClick={() => acceptReq(u.id)}><Check className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => declineReq(u.id)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ))
              }
            </div>
          ) : (
            <div className="p-2">
              {friends.length === 0 && dms.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="h-10 w-10 mx-auto mb-2 text-[var(--synnical-muted)]/40" />
                  <p className="text-sm text-[var(--synnical-muted)]">No friends yet. Click + to add one.</p>
                </div>
              ) : (
                <>
                  {/* Search bar */}
                  {readSetting("friends.searchEnabled", true) && friends.length > 0 && (
                    <div className="px-2 pb-2">
                      <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search friends…" className="h-8 text-sm" />
                    </div>
                  )}
                  {/* Settings indicators */}
                  <div className="flex flex-wrap gap-1 px-2 pb-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--synnical-surface-2)] text-[var(--synnical-muted)]">{friends.length} / {readSetting("friends.maxFriends", 1000)}</span>
                    {readSetting("friends.showOnline", true) && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Online only</span>}
                    {readSetting("friends.notifications", true) && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--synnical-surface-2)] text-[var(--synnical-muted)]">Notifs on</span>}
                  </div>
                  {dms.length > 0 && (
                    <div className="mb-2">
                      <p className="text-xs font-semibold uppercase text-[var(--synnical-muted)] px-2 py-1">Direct Messages</p>
                      {dms.map((dm) => (
                        <button key={dm.id} onClick={() => { setDmChannelId(dm.id); setDmOther(dm.other) }} className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-[var(--synnical-surface-2)] text-left">
                          <div className="relative"><AvatarWithDeco src={dm.other.pfpUrl} name={dm.other.displayName} role={dm.other.role} avatarDeco={dm.other.avatarDeco} size="sm" /></div>
                          <div className="flex-1 min-w-0"><DisplayName name={dm.other.displayName} role={dm.other.role} className="text-sm" />{dm.lastMessage && <p className="text-xs text-[var(--synnical-muted)] truncate">{dm.lastMessage.content}</p>}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs font-semibold uppercase text-[var(--synnical-muted)] px-2 py-1">All Friends — {(() => {
                    const showOnline = readSetting("friends.showOnline", true)
                    const sortBy = readSetting<string>("friends.sortBy", "name")
                    let list = friends
                    // Filter by search
                    if (searchQuery.trim()) {
                      const q = searchQuery.toLowerCase()
                      list = list.filter((u) => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
                    }
                    // Filter online only
                    if (showOnline) list = list.filter((u) => Boolean(onlinePresence[u.id]))
                    // Sort
                    list = [...list].sort((a, b) => {
                      if (sortBy === "status") {
                        const aLabel = onlinePresence[a.id] ? publicPresenceLabel(onlinePresence[a.id].presenceMode, onlinePresence[a.id].afk, onlinePresence[a.id].presenceModeExpiresAt) : "Offline"
                        const bLabel = onlinePresence[b.id] ? publicPresenceLabel(onlinePresence[b.id].presenceMode, onlinePresence[b.id].afk, onlinePresence[b.id].presenceModeExpiresAt) : "Offline"
                        return aLabel.localeCompare(bLabel)
                      }
                      if (sortBy === "activity") return String(presenceSectionLabel(onlinePresence[a.id]?.currentSection) || "").localeCompare(String(presenceSectionLabel(onlinePresence[b.id]?.currentSection) || ""))
                      return a.displayName.localeCompare(b.displayName)
                    })
                    return list.length
                  })()}</p>
                  {(() => {
                    const showOnline = readSetting("friends.showOnline", true)
                    const sortBy = readSetting<string>("friends.sortBy", "name")
                    const showActivity = readSetting("friends.showActivity", true)
                    const showMutual = readSetting("friends.showMutual", true)
                    let list = friends
                    if (searchQuery.trim()) {
                      const q = searchQuery.toLowerCase()
                      list = list.filter((u) => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
                    }
                    if (showOnline) list = list.filter((u) => Boolean(onlinePresence[u.id]))
                    list = [...list].sort((a, b) => {
                      if (sortBy === "status") {
                        const aLabel = onlinePresence[a.id] ? publicPresenceLabel(onlinePresence[a.id].presenceMode, onlinePresence[a.id].afk, onlinePresence[a.id].presenceModeExpiresAt) : "Offline"
                        const bLabel = onlinePresence[b.id] ? publicPresenceLabel(onlinePresence[b.id].presenceMode, onlinePresence[b.id].afk, onlinePresence[b.id].presenceModeExpiresAt) : "Offline"
                        return aLabel.localeCompare(bLabel)
                      }
                      if (sortBy === "activity") return String(presenceSectionLabel(onlinePresence[a.id]?.currentSection) || "").localeCompare(String(presenceSectionLabel(onlinePresence[b.id]?.currentSection) || ""))
                      return a.displayName.localeCompare(b.displayName)
                    })
                    return list.map((u) => (
                    <div key={u.id} className="group flex items-center gap-2 px-2 py-2 rounded-md hover:bg-[var(--synnical-surface-2)]">
                      <AvatarWithDeco src={u.pfpUrl} name={u.displayName} role={u.role} avatarDeco={u.avatarDeco} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {u.friendMeta.favorite && <Star className="h-3 w-3 fill-current text-amber-400" aria-label="Favourite friend" />}
                          {u.friendMeta.closeFriend && <Heart className="h-3 w-3 fill-current text-rose-400" aria-label="Close friend" />}
                          <DisplayName name={u.friendMeta.nickname || u.displayName} role={u.role} className="text-sm" /><RoleBadge role={u.role} tags={u.tags} />
                          {birthdayIsToday(u.birthday) && <Cake className="h-3 w-3 text-pink-400" aria-label="Birthday today" />}
                          {u.bondSummary && <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-300">Duo Lv {u.bondSummary.level}</span>}
                          {u.friendMeta.label && <span className="rounded-full bg-[var(--synnical-surface-2)] px-1.5 py-0.5 text-[9px] text-[var(--synnical-muted)]">{u.friendMeta.label}</span>}
                        </div>
                        <p className="text-xs text-[var(--synnical-muted)] truncate">
                          {showActivity
                            ? onlinePresence[u.id]
                              ? [publicPresenceLabel(onlinePresence[u.id].presenceMode, onlinePresence[u.id].afk, onlinePresence[u.id].presenceModeExpiresAt), presenceSectionLabel(onlinePresence[u.id].currentSection)].filter(Boolean).join(" · ")
                              : "Offline"
                            : "@" + u.username}
                        </p>
                        {showActivity && u.status && <p className="text-[10px] text-[var(--synnical-muted)]/70 truncate">{u.status}</p>}
                        {u.friendMeta.nickname && <p className="text-[10px] text-[var(--synnical-muted)]/70 truncate">{u.displayName} · @{u.username}</p>}
                        {showMutual && <p className="text-[10px] text-[var(--synnical-muted)]/60">{u.mutualCount} mutual friend{u.mutualCount === 1 ? "" : "s"}</p>}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => updateFriendMeta(u, { favorite: !u.friendMeta.favorite })} disabled={friendMetaBusy} aria-label={u.friendMeta.favorite ? "Remove favourite" : "Favourite friend"}><Star className={cn("h-3.5 w-3.5", u.friendMeta.favorite && "fill-current text-amber-400")} /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => updateFriendMeta(u, { closeFriend: !u.friendMeta.closeFriend })} disabled={friendMetaBusy} aria-label={u.friendMeta.closeFriend ? "Remove close friend" : "Mark close friend"}><Heart className={cn("h-3.5 w-3.5", u.friendMeta.closeFriend && "fill-current text-rose-400")} /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSocialFriend(u)} aria-label="Open friendship duo card"><HeartHandshake className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openFriendEditor(u)} aria-label="Friend note, label and nickname"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openDM(u)} aria-label="Message"><MessageSquare className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-[#ef4444]" onClick={() => removeFriend(u.id)} aria-label="Remove friend"><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    ))
                  })()}
                </>
              )}
            </div>
          )
        }
      </div>

      <Dialog open={Boolean(editingFriend)} onOpenChange={(open) => { if (!open) setEditingFriend(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Friend details</DialogTitle></DialogHeader>
          {editingFriend && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="friend-nickname">Private nickname</Label>
                <Input id="friend-nickname" value={friendNickname} onChange={(e) => setFriendNickname(e.target.value)} maxLength={64} placeholder={editingFriend.displayName} />
              </div>
              <div>
                <Label htmlFor="friend-label">Friendship label</Label>
                <Input id="friend-label" value={friendLabel} onChange={(e) => setFriendLabel(e.target.value)} maxLength={32} placeholder="OG, duo, rival…" />
                <p className="mt-1 text-[10px] text-[var(--synnical-muted)]">Your label for this friendship. Only you control it.</p>
              </div>
              <div>
                <Label htmlFor="friend-note">Private note</Label>
                <textarea id="friend-note" value={friendNote} onChange={(e) => setFriendNote(e.target.value)} maxLength={500} rows={5} className="w-full rounded-md border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-2 text-sm outline-none" placeholder="Only you can see this note." />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant={editingFriend.friendMeta.favorite ? "secondary" : "outline"} onClick={() => updateFriendMeta(editingFriend, { favorite: !editingFriend.friendMeta.favorite })} disabled={friendMetaBusy}><Star className={cn("mr-2 h-4 w-4", editingFriend.friendMeta.favorite && "fill-current")} />Favourite</Button>
                <Button type="button" variant={editingFriend.friendMeta.closeFriend ? "secondary" : "outline"} onClick={() => updateFriendMeta(editingFriend, { closeFriend: !editingFriend.friendMeta.closeFriend })} disabled={friendMetaBusy}><Heart className={cn("mr-2 h-4 w-4", editingFriend.friendMeta.closeFriend && "fill-current")} />Close Friend</Button>
              </div>
              <Button onClick={saveFriendEditor} disabled={friendMetaBusy} className="w-full bg-[var(--synnical-accent)] text-black">{friendMetaBusy ? "Saving…" : "Save private details"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <FriendshipSocialDialog friend={socialFriend} open={Boolean(socialFriend)} onOpenChange={(open) => { if (!open) { setSocialFriend(null); void loadAll() } }} />
    </div>
  )
}

function DMConversation({ channelId, other, onBack }: { channelId: string; other: SafeUser; onBack: () => void }) {
  const { user } = useAuth()
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [safetyNotice, setSafetyNotice] = useState<{ code: string; summary: string; tactics: string[]; messageId: string | null } | null>(null)
  const [safetyBusy, setSafetyBusy] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Same-origin socket. NEXT_PUBLIC_SOCKET_URL is a PATH, so it belongs in
    // `path` — passing it as the URL made socket.io treat it as a namespace and
    // the handshake failed with "Invalid namespace".
    const s = io({
      path: process.env.NEXT_PUBLIC_SOCKET_URL || "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
    socketRef.current = s
    s.on("connect", () => setConnected(true))
    s.on("disconnect", () => setConnected(false))
    s.on("connect_error", (err) => {
      setConnected(false)
      console.error("[socket] connect_error:", err.message)
    })
    s.on("mute-error", (d: { message: string }) => toast.error(d.message))
    return () => { s.disconnect() }
  }, [])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !connected) return
    socket.emit("join-channel", { channelId })
    socket.on("message-history", (data: { channelId: string; messages: ChatMessage[] }) => {
      if (data.channelId === channelId) setMessages(data.messages)
    })
    socket.on("message", (msg: ChatMessage) => {
      if (msg.channelId === channelId) setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])
    })
    socket.on("message-deleted", (data: { id: string }) => {
      setMessages((prev) => prev.map((m) => m.id === data.id ? { ...m, deleted: true, content: "" } : m))
    })
    return () => {
      socket.emit("leave-channel", { channelId })
      socket.off("message-history"); socket.off("message"); socket.off("message-deleted")
    }
  }, [connected, channelId])

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages])

  useEffect(() => {
    let active = true
    api.getDmSafety(channelId).then((result) => {
      if (active) setSafetyNotice(result.notice)
    }).catch(() => {
      if (active) setSafetyNotice(null)
    })
    return () => { active = false }
  }, [channelId, messages.length])

  const blockFromSafetyNotice = async () => {
    setSafetyBusy("block")
    try {
      await api.blockUser(other.id)
      toast.success(`@${other.username} blocked`)
      onBack()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not block user")
    } finally {
      setSafetyBusy("")
    }
  }

  const reportFromSafetyNotice = async () => {
    if (!safetyNotice?.messageId) return toast.error("No triggering message is available to report")
    const childSignal = safetyNotice.tactics.includes("age or school probing") || safetyNotice.tactics.includes("image solicitation")
    const category = childSignal ? "CHILD_SAFETY" : "SCAM_MANIPULATION"
    setSafetyBusy("report")
    try {
      await api.reportMessage(
        safetyNotice.messageId,
        category,
        `DM safety warning detected: ${safetyNotice.tactics.join(", ")}. Please review the captured message and surrounding conversation.`,
      )
      toast.success(childSignal ? "Child-safety report sent with priority" : "Safety report sent")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send report")
    } finally {
      setSafetyBusy("")
    }
  }

  const send = () => {
    const text = draft.trim()
    const socket = socketRef.current
    if (!text || !socket || !connected) return
    socket.emit("send-message", { channelId, content: text })
    setDraft("")
  }

  if (!user) return null

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 shrink-0 px-3 flex items-center gap-2 border-b border-[var(--synnical-border)]">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}><ArrowLeft className="h-4 w-4" />Back</Button>
        <AvatarWithDeco src={other.pfpUrl} name={other.displayName} role={other.role} avatarDeco={other.avatarDeco} size="xs" />
        <DisplayName name={other.displayName} role={other.role} className="font-semibold" />
        <RoleBadge role={other.role} tags={other.tags} />
        <span className={cn("ml-2 h-2 w-2 rounded-full", connected ? "bg-[var(--synnical-accent)]" : "bg-red-500")} />
      </div>
      {safetyNotice && (
        <div className="m-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-100">Safety notice</p>
              <p className="mt-1 text-xs leading-5 text-amber-100/80">{safetyNotice.summary}</p>
              <div className="mt-2 flex flex-wrap gap-1">{safetyNotice.tactics.map((tactic) => <span key={tactic} className="rounded-full border border-amber-300/25 bg-[#070707] px-2 py-0.5 text-[10px] text-amber-100">{tactic}</span>)}</div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => void blockFromSafetyNotice()} disabled={Boolean(safetyBusy)}>
                  {safetyBusy === "block" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Block
                </Button>
                <Button size="sm" onClick={() => void reportFromSafetyNotice()} disabled={Boolean(safetyBusy) || !safetyNotice.messageId}>
                  {safetyBusy === "report" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />} Report
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scroll px-4 py-4 space-y-3">
        {messages.length === 0 && <div className="h-full flex flex-col items-center justify-center text-[var(--synnical-muted)]"><MessageSquare className="h-8 w-8 mb-2 opacity-40" /><p className="text-sm">Start of your DM with {other.displayName}</p></div>}
        {messages.map((m) => {
          const own = m.userId === user.id
          const role = (m.role || "MEMBER") as Role
          return (
            <div key={m.id} className={cn("flex gap-2.5", own && "flex-row-reverse")}>
              <AvatarWithDeco src={m.pfpUrl} name={m.displayName || m.username} role={own ? user.role : role} avatarDeco={own ? user.avatarDeco : m.avatarDeco} size="sm" className="mt-0.5" />
              <div className={cn("max-w-[70%]", own && "text-right")}>
                <p className="text-[10px] text-[var(--synnical-muted)] mb-0.5">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                {m.deleted ? <p className="text-xs italic text-[var(--synnical-muted)]">Message deleted</p> : (
                  <p className={cn("text-sm rounded-lg px-3 py-1.5 inline-block", own ? "bg-[var(--synnical-accent)] text-black" : "bg-[var(--synnical-surface-2)] text-[var(--synnical-text)]")}>{m.content}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="shrink-0 p-3 border-t border-[var(--synnical-border)]">
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }} placeholder={`Message ${other.displayName}`} disabled={!connected} className="flex-1" />
          <Button onClick={send} disabled={!connected || !draft.trim()} className="bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black" size="icon" aria-label="Send"><Send className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  )
}
