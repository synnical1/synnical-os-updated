// Frontend API helpers for Synnical

import type { ChannelAudience } from "@/lib/channel-permissions"

export type Role = "OWNER" | "HEAD_ADMIN" | "ADMIN" | "MOD" | "MEMBER"

export type SafeUser = {
  id: string
  username: string
  displayName: string
  bio: string
  status: string
  statusExpiresAt?: string | null
  pfpUrl: string | null
  bannerUrl: string | null
  pfpIsGif: boolean
  bannerIsGif: boolean
  avatarDeco: string | null
  profileEffect: string | null
  profileThemePrimary: string
  profileThemeAccent: string
  profileThemeStyle: "solid" | "gradient"
  role: Role
  tags: string[]
  muted: boolean
  mutedUntil: string | null
  banned?: boolean
  warnCount?: number
  coins?: number
  securitySetupRequired: boolean
}

export type FriendUser = SafeUser & {
  mutualCount: number
  birthday?: string | null
  friendMeta: { nickname: string; note: string; closeFriend: boolean; favorite: boolean; label: string }
  bondSummary?: { level: number; xp: number; duoName: string; title: string; lastInteractionAt: string | null } | null
}

export type Channel = {
  id: string
  name: string
  isDM?: boolean
  isAnnouncement?: boolean
  allowedRoles?: Role[]
  audience?: ChannelAudience
  _count?: { messages: number }
}

export type ChatMessage = {
  mentionedUserIds?: string[]
  id: string
  /** Correlates an immediate local row with the durable server broadcast. */
  clientNonce?: string | null
  pendingLocal?: boolean
  failedLocal?: boolean
  channelId: string
  userId?: string | null
  username: string
  displayName?: string | null
  pfpUrl?: string | null
  role?: Role
  tags?: string[]
  pfpIsGif?: boolean
  avatarDeco?: string | null
  content: string
  deleted?: boolean
  edited?: boolean
  gifUrl?: string | null
  imageUrl?: string | null
  voiceUrl?: string | null
  voiceTranscript?: string | null
  messageType?: string
  threadRootId?: string | null
  replyToId?: string | null
  replyToName?: string | null
  replyToContent?: string | null
  spoilerMediaType?: "movie" | "tv" | null
  spoilerMediaId?: string | null
  spoilerTitle?: string | null
  spoilerSeason?: number | null
  spoilerEpisode?: number | null
  spoilerUntil?: string | null
  createdAt: string
  isBot?: boolean
  reactions?: { emoji: string; count: number; reacted: boolean }[]
}

export type DM = {
  id: string
  other: SafeUser
  lastMessage: ChatMessage | null
}


function emitTaskbarProgress(panel: string, progress: number | null, active: boolean) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("synnical-taskbar-progress", { detail: { panel, progress, active } }))
}

function svgClientRequestHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    if (window.self !== window.top && new URLSearchParams(window.location.search).get("synnicalClient") === "svg") {
      return { "X-Synnical-Client": "svg" }
    }
  } catch {}
  return {}
}

async function jsonFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...svgClientRequestHeaders(), ...(opts?.headers || {}) },
    ...opts,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any).error || "Request failed")
  return data as T
}

export const api = {
  me: () => jsonFetch<{ user: SafeUser | null }>("/api/auth/me"),
  register: (username: string, password: string, securityQuestion: string, securityAnswer: string) =>
    jsonFetch<{ user: SafeUser }>("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password, securityQuestion, securityAnswer }) }),
  login: (username: string, password: string, recoveryCode?: string) =>
    jsonFetch<{ user: SafeUser }>("/api/auth/login", { method: "POST", body: JSON.stringify(recoveryCode ? { username, recoveryCode } : { username, password }) }),
  logout: () => jsonFetch<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  listChannels: () => jsonFetch<{ channels: Channel[] }>("/api/chat/channels"),
  listChatUsers: () => jsonFetch<{ users: SafeUser[] }>("/api/chat/users"),
  createChannel: (name: string, audience: ChannelAudience) =>
    jsonFetch<{ channel: Channel }>("/api/chat/channels", { method: "POST", body: JSON.stringify({ name, audience }) }),
  deleteChannel: (id: string) =>
    jsonFetch<{ ok: true; id: string; audience: ChannelAudience }>("/api/chat/channels", { method: "DELETE", body: JSON.stringify({ id }) }),
  getMessages: (channelId: string) =>
    jsonFetch<{ messages: ChatMessage[] }>(`/api/chat/messages?channelId=${channelId}`),
  reportMessage: (messageId: string, category: string, reason: string) =>
    jsonFetch<{ ok: true; code: string; reportId: string; childSafetyPriority: boolean }>("/api/reports", { method: "POST", body: JSON.stringify({ messageId, category, reason }) }),
  listReports: (status = "OPEN") =>
    jsonFetch<{ reports: any[] }>(`/api/reports?status=${encodeURIComponent(status)}`),
  resolveReport: (reportId: string, status: "RESOLVED" | "DISMISSED") =>
    jsonFetch<{ ok: true; reportId: string; status: string }>("/api/reports", { method: "PATCH", body: JSON.stringify({ reportId, status }) }),

  updateProfile: (body: { displayName?: string; bio?: string; username?: string }) =>
    jsonFetch<{ user: SafeUser }>("/api/profile/update", { method: "PATCH", body: JSON.stringify(body) }),
  setProfileTheme: (body: { primary: string; accent: string; style: "solid" | "gradient" }) =>
    jsonFetch<{ user: SafeUser }>("/api/profile/theme", { method: "PATCH", body: JSON.stringify(body) }),
  setStatus: (status: string) =>
    jsonFetch<{ user: SafeUser }>("/api/profile/status", { method: "PATCH", body: JSON.stringify({ status }) }),
  setDeco: (avatarDeco?: string | null) =>
    jsonFetch<{ user: SafeUser }>("/api/profile/deco", { method: "PATCH", body: JSON.stringify({ avatarDeco }) }),
  setProfileEffect: (profileEffect?: string | null) =>
    jsonFetch<{ user: SafeUser }>("/api/profile/deco", { method: "PATCH", body: JSON.stringify({ profileEffect }) }),
  uploadVoice: (blob: Blob) => {
    const form = new FormData()
    form.append("file", blob, "voice.webm")
    emitTaskbarProgress("chat", null, true)
    return fetch("/api/voice/upload", { method: "POST", body: form, credentials: "include" }).then(async (r) => {
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || "Upload failed")
      return data as { url: string; transcript?: string }
    }).finally(() => emitTaskbarProgress("chat", 100, false))
  },

  uploadChatImage: (file: Blob) => {
    const form = new FormData()
    const mime = file.type || "image/png"
    const ext = mime === "image/gif" ? "gif" : mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : "png"
    const filename = file instanceof File && file.name ? file.name : `chat-image-${Date.now()}.${ext}`
    form.append("file", file, filename)
    emitTaskbarProgress("chat", null, true)
    return fetch("/api/chat/image/upload", { method: "POST", body: form, credentials: "include" }).then(async (r) => {
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || "Upload failed")
      return data as { url: string; mime?: string; animated?: boolean }
    }).finally(() => emitTaskbarProgress("chat", 100, false))
  },

  uploadImage: (type: "pfp" | "banner", file: Blob) => {
    const form = new FormData()
    form.append("type", type)
    // Always provide a filename. When file is a Blob (from canvas.toBlob),
    // the browser would otherwise send "blob" as the filename, which some
    // servers reject. Determine extension from the MIME type.
    const mime = file.type || "image/png"
    const ext = mime === "image/gif" ? "gif" : mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : "png"
    const filename = file instanceof File && file.name ? file.name : `${type}-${Date.now()}.${ext}`
    form.append("file", file, filename)
    emitTaskbarProgress("profile", null, true)
    return fetch("/api/profile/upload", { method: "POST", body: form, credentials: "include" }).then(async (r) => {
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || "Upload failed")
      return data as
        | { pending: true; approval: { id: string; status: "pending" }; url?: never; user: SafeUser }
        | { pending?: false; approval?: never; url: string; user: SafeUser }
    }).finally(() => emitTaskbarProgress("profile", 100, false))
  },

  verifyOwner: (password: string) =>
    jsonFetch<{ ok: true; user: SafeUser }>("/api/owner/verify", { method: "POST", body: JSON.stringify({ password }) }),

  // roles + moderation
  listUsers: (params?: { q?: string; role?: string; status?: string; page?: number; pageSize?: number; excludeSelf?: boolean }) => {
    const query = new URLSearchParams()
    if (params?.q) query.set("q", params.q)
    if (params?.role) query.set("role", params.role)
    if (params?.status) query.set("status", params.status)
    if (params?.page) query.set("page", String(params.page))
    if (params?.pageSize) query.set("pageSize", String(params.pageSize))
    if (params?.excludeSelf) query.set("excludeSelf", "1")
    const queryString = query.toString()
    const suffix = queryString ? `?${queryString}` : ""
    return jsonFetch<{ users: SafeUser[]; total: number; page: number; pageSize: number; hasMore: boolean }>(`/api/roles/users${suffix}`)
  },
  assignRole: (userId: string, role: Role) =>
    jsonFetch<{ user: SafeUser }>("/api/roles/assign", { method: "POST", body: JSON.stringify({ userId, role }) }),
  removeAccount: (userId: string, action: "delete" | "ban") =>
    jsonFetch<{ ok: true; releasedUsername: string }>("/api/moderation/accounts", { method: "DELETE", body: JSON.stringify({ userId, action }) }),
  muteUser: (userId: string, durationMin?: number) =>
    jsonFetch<{ ok: true }>("/api/moderation/mute", { method: "POST", body: JSON.stringify({ userId, durationMin }) }),
  unmuteUser: (userId: string) =>
    jsonFetch<{ ok: true }>("/api/moderation/unmute", { method: "POST", body: JSON.stringify({ userId }) }),
  deleteMessage: (id: string) =>
    jsonFetch<{ ok: true; id: string; channelId: string }>(`/api/messages/${id}`, { method: "DELETE" }),
  editMessage: (id: string, content: string) =>
    jsonFetch<{ ok: true }>(`/api/messages/edit`, { method: "PATCH", body: JSON.stringify({ id, content }) }),

  // friends + DMs
  listFriends: () => jsonFetch<{ friends: FriendUser[]; incoming: SafeUser[]; outgoing: SafeUser[] }>("/api/friends/list"),
  sendFriendRequest: (username: string) =>
    jsonFetch<{ ok: true }>("/api/friends/request", { method: "POST", body: JSON.stringify({ username }) }),
  acceptFriendRequest: (requesterId: string) =>
    jsonFetch<{ ok: true }>("/api/friends/accept", { method: "POST", body: JSON.stringify({ requesterId }) }),
  declineFriendRequest: (requesterId: string) =>
    jsonFetch<{ ok: true; blockedUntil: string }>("/api/friends/decline", { method: "POST", body: JSON.stringify({ requesterId }) }),
  removeFriend: (userId: string) =>
    jsonFetch<{ ok: true }>("/api/friends/remove", { method: "POST", body: JSON.stringify({ userId }) }),
  listDMs: () => jsonFetch<{ dms: DM[]; groups: any[] }>("/api/dms/list"),
  createDM: (userId: string) =>
    jsonFetch<{ id: string; other: SafeUser }>("/api/dms/list", { method: "POST", body: JSON.stringify({ userId }) }),
  createGroup: (name: string, memberIds: string[]) =>
    jsonFetch<{ id: string; name: string; members: SafeUser[] }>("/api/channels/group", { method: "POST", body: JSON.stringify({ name, memberIds }) }),

  // infractions + account stats
  listInfractions: (type?: string) =>
    jsonFetch<{ infractions: any[] }>(`/api/infractions/list${type ? `?type=${type}` : ""}`),
  warnUser: (userId: string, reason: string) =>
    jsonFetch(`/api/infractions/create`, { method: "POST", body: JSON.stringify({ userId, type: "WARN", reason }) }),
  deleteInfraction: (id: string) =>
    jsonFetch(`/api/infractions/delete`, { method: "DELETE", body: JSON.stringify({ id }) }),
  getAccountStats: () => jsonFetch(`/api/account/stats`),

  // tags
  assignTag: (userId: string, tag: string) =>
    jsonFetch<{ user: SafeUser }>("/api/roles/assign", { method: "POST", body: JSON.stringify({ userId, tag, action: "addTag" }) }),
  removeTag: (userId: string, tag: string) =>
    jsonFetch<{ user: SafeUser }>("/api/roles/assign", { method: "POST", body: JSON.stringify({ userId, tag, action: "removeTag" }) }),
  listTags: () =>
    jsonFetch<{ tags: string[] }>("/api/roles/users"),

  // blocks
  toggleBlock: (userId: string) =>
    jsonFetch(`/api/blocks/toggle`, { method: "POST", body: JSON.stringify({ userId, mode: "toggle" }) }),
  blockUser: (userId: string) =>
    jsonFetch(`/api/blocks/toggle`, { method: "POST", body: JSON.stringify({ userId, mode: "block" }) }),
  unblockUser: (userId: string) =>
    jsonFetch(`/api/blocks/toggle`, { method: "POST", body: JSON.stringify({ userId, mode: "unblock" }) }),
  getDmSafety: (channelId: string) =>
    jsonFetch<{ notice: { code: string; summary: string; tactics: string[]; messageId: string | null } | null }>(`/api/dms/safety?channelId=${encodeURIComponent(channelId)}`),
  listBlocks: () => jsonFetch(`/api/blocks/list`),

  // quotes
  saveQuote: (authorName: string, content: string, authorPfp?: string) =>
    jsonFetch(`/api/quotes/save`, { method: "POST", body: JSON.stringify({ authorName, content, authorPfp }) }),
  listQuotes: () => jsonFetch(`/api/quotes/list`),
  deleteQuote: (id: string) =>
    jsonFetch(`/api/quotes/delete`, { method: "DELETE", body: JSON.stringify({ id }) }),

  // shop / economy
  getShop: () => jsonFetch<{ catalog: any[]; inventory: any[]; coins: number; staffDecorationAccess: boolean; staffProfileEffectAccess: boolean; lastDailyClaim: string | null; user?: SafeUser }>(`/api/shop/list`),
  buyItem: (itemType: string, itemId: string) =>
    jsonFetch<{ success: boolean; message: string; coins?: number }>(`/api/shop/buy`, { method: "POST", body: JSON.stringify({ itemType, itemId }) }),
  claimDaily: () =>
    jsonFetch<{ success: boolean; message: string; coins?: number; nextClaim?: string }>(`/api/shop/daily`, { method: "POST" }),
  refundItem: (itemType: string, itemId: string) =>
    jsonFetch<{ success: boolean; message: string; coins?: number }>(`/api/shop/refund`, { method: "POST", body: JSON.stringify({ itemType, itemId }) }),
  getTransactions: () => jsonFetch<{ transactions: any[] }>(`/api/shop/transactions`),
  giftShop: (gift:
    | { kind: "coins"; recipientId: string; amount: number }
    | { kind: "item"; recipientId: string; itemType: "avatar_deco" | "profile_effect"; itemId: string }
  ) => jsonFetch<{ success: true; message: string; coins: number; charged?: number }>(`/api/shop/gift`, { method: "POST", body: JSON.stringify(gift) }),
}
