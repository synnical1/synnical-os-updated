"use client"

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((data as any).error || `Request failed (${response.status})`)
  return data as T
}

function post<T>(url: string, body: Record<string, unknown>) {
  return request<T>(url, { method: "POST", body: JSON.stringify(body) })
}

export const featureApi = {
  chat: {
    preferences: () => request<any>("/api/features/chat?action=preferences"),
    setPreference: (channelId: string, patch: Record<string, unknown>) => post<any>("/api/features/chat", { action: "set-preference", channelId, ...patch }),
    saved: () => request<any>("/api/features/chat?action=saved"),
    toggleSave: (messageId: string) => post<any>("/api/features/chat", { action: "toggle-save", messageId }),
    schedule: (payload: Record<string, unknown>) => post<any>("/api/features/chat", { action: "schedule", ...payload }),
    scheduled: () => request<any>("/api/features/chat?action=scheduled"),
    cancelScheduled: (id: string) => post<any>("/api/features/chat", { action: "cancel-scheduled", id }),
    edits: (messageId: string) => request<any>(`/api/features/chat?action=edits&messageId=${encodeURIComponent(messageId)}`),
    thread: (messageId: string) => request<any>(`/api/features/chat?action=thread&messageId=${encodeURIComponent(messageId)}`),
    search: (channelId: string, params: Record<string, string>) => request<any>(`/api/features/chat?action=search&channelId=${encodeURIComponent(channelId)}&${new URLSearchParams(params)}`),
    gallery: (channelId: string) => request<any>(`/api/features/chat?action=gallery&channelId=${encodeURIComponent(channelId)}`),
    polls: (channelId: string) => request<any>(`/api/features/chat?action=polls&channelId=${encodeURIComponent(channelId)}`),
    createPoll: (payload: Record<string, unknown>) => post<any>("/api/features/chat", { action: "create-poll", ...payload }),
    vote: (pollId: string, optionId: string) => post<any>("/api/features/chat", { action: "vote", pollId, optionId }),
    events: (channelId: string) => request<any>(`/api/features/chat?action=events&channelId=${encodeURIComponent(channelId)}`),
    createEvent: (payload: Record<string, unknown>) => post<any>("/api/features/chat", { action: "create-event", ...payload }),
    rsvp: (eventId: string, status: string) => post<any>("/api/features/chat", { action: "rsvp", eventId, status }),
    translate: (messageId: string, language: string) => post<any>("/api/features/chat", { action: "translate", messageId, language }),
    slowMode: (channelId: string, seconds: number) => post<any>("/api/features/chat", { action: "set-slowmode", channelId, seconds }),
  },
  profile: {
    me: () => request<any>("/api/features/profile"),
    user: (userId: string) => request<any>(`/api/features/profile?userId=${encodeURIComponent(userId)}`),
    update: (patch: Record<string, unknown>) => post<any>("/api/features/profile", { action: "update-profile", ...patch }),
    friendMeta: (friendId: string, patch: Record<string, unknown>) => post<any>("/api/features/profile", { action: "friend-meta", friendId, ...patch }),
    addLink: (label: string, url: string) => post<any>("/api/features/profile", { action: "add-link", label, url }),
    verifyLink: (linkId: string) => post<any>("/api/features/profile", { action: "verify-link", linkId }),
    deleteLink: (linkId: string) => post<any>("/api/features/profile", { action: "delete-link", linkId }),
    showcase: (kind: string, refId: string, label: string, position = 0) => post<any>("/api/features/profile", { action: "showcase", kind, refId, label, position }),
    deleteShowcase: (id: string) => post<any>("/api/features/profile", { action: "delete-showcase", id }),
    cosmetic: (action: string, payload: Record<string, unknown>) => post<any>("/api/features/profile", { action, ...payload }),
  },
  friends: {
    bond: (friendId: string) => request<any>(`/api/features/friends?friendId=${encodeURIComponent(friendId)}`),
    action: (action: string, friendId: string, payload: Record<string, unknown> = {}) => post<any>("/api/features/friends", { action, friendId, ...payload }),
  },
  economy: {
    state: () => request<any>("/api/features/economy"),
    wishlist: (itemType: string, itemId: string, price: number) => post<any>("/api/features/economy", { action: "toggle-wishlist", itemType, itemId, price }),
    promo: (code: string) => post<any>("/api/features/economy", { action: "redeem-promo", code }),
    createPromo: (payload: Record<string, unknown>) => post<any>("/api/features/economy", { action: "create-promo", ...payload }),
  },
  games: {
    state: () => request<any>("/api/features/games"),
    action: (action: string, payload: Record<string, unknown>) => post<any>("/api/features/games", { action, ...payload }),
  },
  browser: {
    state: () => request<any>("/api/features/browser"),
    action: (action: string, payload: Record<string, unknown>) => post<any>("/api/features/browser", { action, ...payload }),
  },
  media: {
    state: () => request<any>("/api/features/media"),
    action: (action: string, payload: Record<string, unknown>) => post<any>("/api/features/media", { action, ...payload }),
  },
  mediaProfiles: {
    state: () => request<any>("/api/features/media/profiles"),
    action: (action: string, payload: Record<string, unknown>) => post<any>("/api/features/media/profiles", { action, ...payload }),
  },
  music: {
    state: () => request<any>("/api/features/music"),
    action: (action: string, payload: Record<string, unknown>) => post<any>("/api/features/music", { action, ...payload }),
  },
  search: (q: string) => request<any>(`/api/features/search?q=${encodeURIComponent(q)}`),
  health: () => request<any>("/api/features/health"),
  bot: {
    state: () => request<any>("/api/features/bot"),
    action: (action: string, payload: Record<string, unknown>) => post<any>("/api/features/bot", { action, ...payload }),
  },
}
