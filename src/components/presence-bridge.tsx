"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import { useAuth } from "@/hooks/use-auth"
import { DEFAULT_PRESENCE_CONFIG, normalizePresenceConfig, normalizeRichPresenceActivity, presenceSection, type PresenceConfig, type RichPresenceActivity } from "@/lib/presence"

const AFK_AFTER_MS = 5 * 60 * 1000

type NetworkInformationLike = EventTarget & {
  effectiveType?: string
  downlink?: number
  rtt?: number
}

type ActivitySource = {
  activity: RichPresenceActivity
  updatedAt: number
}

function deviceType(): "desktop" | "mobile" | "tablet" | "unknown" {
  if (typeof navigator === "undefined") return "unknown"
  const ua = navigator.userAgent || ""
  if (/iPad|Tablet|Silk/i.test(ua)) return "tablet"
  if (/Android|iPhone|iPod|Mobile/i.test(ua)) return "mobile"
  return "desktop"
}

function networkQuality(): "good" | "fair" | "poor" | "unknown" {
  if (typeof navigator === "undefined") return "unknown"
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  if (!connection) return "unknown"
  const effective = String(connection.effectiveType || "")
  const rtt = Number(connection.rtt || 0)
  if (effective === "slow-2g" || effective === "2g" || rtt >= 500) return "poor"
  if (effective === "3g" || rtt >= 220) return "fair"
  if (effective === "4g" || (rtt > 0 && rtt < 220)) return "good"
  return "unknown"
}

export function PresenceBridge() {
  const { user } = useAuth()
  const socketRef = useRef<Socket | null>(null)
  const configRef = useRef<PresenceConfig>(DEFAULT_PRESENCE_CONFIG)
  const panelRef = useRef("browser")
  const activitySourcesRef = useRef(new Map<string, ActivitySource>())
  const afkRef = useRef(false)
  const lastActivityScheduleRef = useRef(0)
  const afkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const [, setRevision] = useState(0)

  const emitPresence = useCallback(() => {
    const socket = socketRef.current
    if (!socket?.connected) return
    const config = normalizePresenceConfig(configRef.current)
    configRef.current = config
    socket.emit("presence-update", {
      mode: config.mode,
      modeExpiresAt: config.modeExpiresAt,
      afk: afkRef.current,
      afkMessage: config.afkMessage,
      currentSection: config.shareSection ? presenceSection(panelRef.current) : null,
      deviceType: config.shareDevice ? deviceType() : null,
      networkQuality: config.shareNetworkQuality ? networkQuality() : null,
      showOnlineDuration: config.showOnlineDuration,
      activity: (() => {
        const rows = [...activitySourcesRef.current.values()]
        rows.sort((a, b) => b.updatedAt - a.updatedAt)
        return rows[0]?.activity || null
      })(),
    })
  }, [])

  const scheduleExpiry = useCallback(() => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current)
    expiryTimerRef.current = null
    const expiresAt = configRef.current.modeExpiresAt ? new Date(configRef.current.modeExpiresAt).getTime() : 0
    if (!expiresAt || expiresAt <= Date.now()) return
    expiryTimerRef.current = setTimeout(() => {
      configRef.current = { ...configRef.current, mode: "online", modeExpiresAt: null }
      setRevision((value) => value + 1)
      window.dispatchEvent(new CustomEvent("synnical-presence-config-changed", { detail: { config: configRef.current } }))
      emitPresence()
    }, Math.min(2_147_000_000, Math.max(50, expiresAt - Date.now() + 50)))
  }, [emitPresence])

  const scheduleAfk = useCallback(() => {
    if (afkTimerRef.current) clearTimeout(afkTimerRef.current)
    afkTimerRef.current = setTimeout(() => {
      if (afkRef.current) return
      afkRef.current = true
      emitPresence()
    }, AFK_AFTER_MS)
  }, [emitPresence])

  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect()
      socketRef.current = null
      return
    }

    let cancelled = false
    void fetch("/api/features/presence", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.error || "Could not load presence")
        if (cancelled) return
        configRef.current = normalizePresenceConfig(body.config)
        scheduleExpiry()
        emitPresence()
      })
      .catch(() => {})

    const socket = io({
      path: process.env.NEXT_PUBLIC_SOCKET_URL || "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
    socketRef.current = socket
    socket.on("connect", emitPresence)

    return () => {
      cancelled = true
      socket.off("connect", emitPresence)
      socket.disconnect()
      if (socketRef.current === socket) socketRef.current = null
    }
  }, [user?.id, emitPresence, scheduleExpiry])

  useEffect(() => {
    if (!user || typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(`synnical-presence:${user.id}`)
    channelRef.current = channel
    channel.onmessage = (event: MessageEvent<{ config?: unknown }>) => {
      if (!event.data?.config) return
      configRef.current = normalizePresenceConfig(event.data.config)
      scheduleExpiry()
      emitPresence()
    }
    return () => {
      channel.close()
      if (channelRef.current === channel) channelRef.current = null
    }
  }, [user?.id, emitPresence, scheduleExpiry])

  useEffect(() => {
    const panel = document.documentElement.dataset.synnicalPanel
    if (panel) panelRef.current = panel

    const onPanel = (event: Event) => {
      const panelName = (event as CustomEvent<{ panel?: unknown }>).detail?.panel
      if (typeof panelName !== "string") return
      panelRef.current = presenceSection(panelName) || "browser"
      emitPresence()
    }
    const onConfig = (event: Event) => {
      const next = (event as CustomEvent<{ config?: unknown }>).detail?.config
      configRef.current = normalizePresenceConfig(next)
      scheduleExpiry()
      channelRef.current?.postMessage({ config: configRef.current })
      emitPresence()
    }
    window.addEventListener("synnical-panel-changed", onPanel)
    window.addEventListener("synnical-presence-config-changed", onConfig)
    return () => {
      window.removeEventListener("synnical-panel-changed", onPanel)
      window.removeEventListener("synnical-presence-config-changed", onConfig)
    }
  }, [emitPresence, scheduleExpiry])

  useEffect(() => {
    const onRichPresence = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: unknown; activity?: unknown }>).detail
      const source = typeof detail?.source === "string" ? detail.source.slice(0, 80) : "unknown"
      const activity = normalizeRichPresenceActivity(detail?.activity)
      if (activity) activitySourcesRef.current.set(source, { activity, updatedAt: Date.now() })
      else activitySourcesRef.current.delete(source)
      emitPresence()
    }
    window.addEventListener("synnical-rich-presence", onRichPresence)
    return () => window.removeEventListener("synnical-rich-presence", onRichPresence)
  }, [emitPresence])

  useEffect(() => {
    const markActive = () => {
      const wasAfk = afkRef.current
      afkRef.current = false
      const now = Date.now()
      if (wasAfk || now - lastActivityScheduleRef.current > 2_000) {
        lastActivityScheduleRef.current = now
        scheduleAfk()
      }
      if (wasAfk) emitPresence()
    }
    const events: Array<keyof WindowEventMap> = ["keydown", "pointerdown", "touchstart", "focus"]
    for (const eventName of events) window.addEventListener(eventName, markActive, { passive: true })
    scheduleAfk()
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, markActive)
      if (afkTimerRef.current) clearTimeout(afkTimerRef.current)
    }
  }, [emitPresence, scheduleAfk])

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
    if (!connection?.addEventListener) return
    const update = () => emitPresence()
    connection.addEventListener("change", update)
    return () => connection.removeEventListener("change", update)
  }, [emitPresence])

  useEffect(() => () => {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current)
  }, [])

  return null
}
