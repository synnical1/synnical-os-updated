"use client"
import { io, type Socket } from "socket.io-client"
import { useSyncExternalStore } from "react"
import { api, type ChatMessage } from "./api"
import { messageNotification } from "./chat-mentions"
import { readSetting } from "./settings-runtime"

type UnreadState = { unread: Record<string, number>; mentions: Record<string, boolean> }
const EMPTY: UnreadState = { unread: {}, mentions: {} }
let state = EMPTY
let socket: Socket | null = null
let accountId: string | null = null
let readingChannel: string | null = null
const subscribers = new Set<() => void>()
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn) } }
const snapshot = () => state
export function useChatUnread() { return useSyncExternalStore(subscribe, snapshot, () => EMPTY) }
function publish(next: UnreadState) {
  state = next
  subscribers.forEach(fn => fn())
  window.dispatchEvent(new CustomEvent("synnical-chat-unread", { detail: { total: Object.values(state.unread).reduce((sum, n) => sum + n, 0), mention: Object.values(state.mentions).some(Boolean) } }))
}
export function setReadingChannel(channelId: string | null) {
  readingChannel = channelId
  if (channelId && (state.unread[channelId] || state.mentions[channelId])) publish({ unread: { ...state.unread, [channelId]: 0 }, mentions: { ...state.mentions, [channelId]: false } })
}
export function getChatSocket(userId: string): Socket {
  if (socket && accountId === userId) return socket
  socket?.disconnect()
  accountId = userId
  socket = io({ path: process.env.NEXT_PUBLIC_SOCKET_URL || "/socket.io", transports: ["websocket", "polling"], withCredentials: true, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 })
  return socket
}
/** One connection and notification owner for the whole signed-in desktop. */
export function startChatRealtime(userId: string, refreshAccount: () => Promise<void>) {
  const connection = getChatSocket(userId)
  publish(EMPTY)
  const seen = new Set<string>()
  let disposed = false
  let revision = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let rooms = new Set<string>()
  let prefs: Record<string, { notificationLevel?: string; priority?: boolean }> = {}
  const restore = async () => {
    const version = revision
    try {
      const [channels, dms, preferences, unread] = await Promise.all([api.listChannels(), api.listDMs(), fetch("/api/features/chat?action=preferences", { cache: "no-store" }).then(r => r.ok ? r.json() : null), fetch("/api/chat/unread", { cache: "no-store" }).then(r => r.ok ? r.json() : null)])
      if (disposed) return
      const nextRooms = new Set([...channels.channels.map(row => row.id), ...dms.dms.map(row => row.id), ...dms.groups.map(row => row.id)])
      for (const room of rooms) if (!nextRooms.has(room)) connection.emit("leave-channel", { channelId: room })
      for (const channelId of nextRooms) connection.emit("join-channel", { channelId, history: false })
      rooms = nextRooms
      prefs = Object.fromEntries((preferences?.preferences || []).map((row: { channelId: string }) => [row.channelId, row]))
      // A response begun before a live message must not overwrite its increment.
      if (unread && version === revision) {
        publish({ unread: unread.unread, mentions: unread.mentions })
        setReadingChannel(readingChannel)
      } else if (unread) {
        clearTimeout(retry)
        retry = setTimeout(() => { if (!disposed) void restore() }, 500)
      }
    } catch { /* Connection/reconnect retries restore the persisted counts. */ }
  }
  const receive = (message: ChatMessage) => {
    if (seen.has(message.id)) return
    seen.add(message.id)
    if (seen.size > 2000) seen.delete(seen.values().next().value!)
    revision++
    if (message.userId === userId) return
    const mentioned = messageNotification(message, userId)
    const visible = readingChannel === message.channelId && !document.hidden
    if (!visible) publish({ unread: { ...state.unread, [message.channelId]: Math.min(999, (state.unread[message.channelId] || 0) + 1) }, mentions: { ...state.mentions, [message.channelId]: Boolean(state.mentions[message.channelId] || mentioned) } })
    if (!mentioned || prefs[message.channelId]?.notificationLevel === "mute") return
    const title = `${message.displayName || message.username} mentioned you`
    const body = message.content.slice(0, 120)
    window.dispatchEvent(new CustomEvent("synnical-os-notify", { detail: { title, body, panel: "chat", priority: prefs[message.channelId]?.priority ? "priority" : "normal" } }))
    if (!visible && readSetting("notifications.desktop", false) && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification(title, { body, tag: `synnical-mention-${message.id}` }) } catch { /* Browser policy can reject a permitted notification. */ }
    }
  }
  const changed = (data: { userId: string }) => {
    window.dispatchEvent(new CustomEvent("synnical-moderation-updated", { detail: data }))
    if (data.userId === userId) void refreshAccount()
    void restore()
  }
  const reconnect = () => { rooms = new Set(); void restore() }
  const disconnected = (reason: string) => { if (reason === "io server disconnect") void refreshAccount() }
  const preferencesChanged = () => { void restore() }
  connection.on("connect", reconnect)
  connection.on("message", receive)
  connection.on("moderation-updated", changed)
  connection.on("channels-updated", preferencesChanged)
  connection.on("dm-created", preferencesChanged)
  connection.on("disconnect", disconnected)
  window.addEventListener("synnical-chat-preferences-changed", preferencesChanged)
  if (connection.connected) void restore()
  return () => {
    disposed = true
    clearTimeout(retry)
    window.removeEventListener("synnical-chat-preferences-changed", preferencesChanged)
    connection.off("connect", reconnect); connection.off("message", receive); connection.off("moderation-updated", changed); connection.off("channels-updated", preferencesChanged); connection.off("dm-created", preferencesChanged); connection.off("disconnect", disconnected)
    connection.disconnect()
    if (socket === connection) { socket = null; accountId = null; readingChannel = null; publish(EMPTY) }
  }
}
