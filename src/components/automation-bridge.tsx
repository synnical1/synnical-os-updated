"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { useBrowser } from "@/hooks/use-browser"
import { isThemeId } from "@/lib/themes"
import { readSetting, writeSetting } from "@/lib/settings-runtime"

const SAFE_SETTING_PREFIXES = ["a11y.", "perf.", "layout.", "notifications."]

type ClientJob = { id: string; actionType: string; action: Record<string, unknown> }

async function post(payload: Record<string, unknown>) {
  const res = await fetch("/api/features/automations", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
  return res.ok ? res.json() : null
}

export function AutomationBridge() {
  const { user } = useAuth()
  const busy = useRef(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const execute = async (job: ClientJob): Promise<{ ok: boolean; summary: string; undo?: Record<string, unknown> }> => {
      const action = job.action || {}
      if (job.actionType === "apply_undo") {
        const actionType = typeof action.actionType === "string" ? action.actionType : ""
        const nested = action.action && typeof action.action === "object" ? action.action as Record<string, unknown> : {}
        return execute({ ...job, actionType, action: nested })
      }
      if (job.actionType === "open_panel") {
        const panel = typeof action.panel === "string" ? action.panel : "chat"
        const previous = document.documentElement.dataset.synnicalPanel || "browser"
        window.dispatchEvent(new CustomEvent("synnical-open-panel", { detail: { panel } }))
        return { ok: true, summary: `Opened ${panel}`, undo: { actionType: "open_panel", action: { panel: previous } } }
      }
      if (job.actionType === "mute_music") {
        const mute = action.mute !== false
        window.dispatchEvent(new CustomEvent("synnical-music-mute", { detail: { mute } }))
        return { ok: true, summary: mute ? "Muted Synnical music" : "Unmuted Synnical music" }
      }
      if (job.actionType === "set_theme") {
        const theme = typeof action.theme === "string" ? action.theme : "blood"
        if (!isThemeId(theme)) return { ok: false, summary: "Unsupported theme" }
        const previous = useBrowser.getState().theme
        useBrowser.getState().setTheme(theme)
        return { ok: true, summary: `Switched theme to ${theme}`, undo: { actionType: "set_theme", action: { theme: previous } } }
      }
      if (job.actionType === "set_setting") {
        const key = typeof action.key === "string" ? action.key : ""
        if (!SAFE_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix))) return { ok: false, summary: "Setting blocked by automation sandbox" }
        const previous = readSetting<unknown>(key, null)
        writeSetting(key, action.value)
        return { ok: true, summary: `Changed ${key}`, undo: { actionType: "set_setting", action: { key, value: previous } } }
      }
      if (job.actionType === "notify") {
        const title = typeof action.title === "string" ? action.title : "Synnical automation"
        const body = typeof action.body === "string" ? action.body : "Routine completed"
        toast(title, { description: body })
        window.dispatchEvent(new CustomEvent("synnical-os-notify", { detail: { title, body } }))
        return { ok: true, summary: title }
      }
      return { ok: false, summary: "Unsupported client automation action" }
    }

    const claim = async () => {
      if (cancelled || busy.current) return
      busy.current = true
      try {
        const body = await post({ action: "claim-client-actions" })
        const jobs = Array.isArray(body?.jobs) ? body.jobs as ClientJob[] : []
        for (const job of jobs) {
          if (cancelled) break
          const result: { ok: boolean; summary: string; undo?: Record<string, unknown> } = await execute(job).catch(() => ({ ok: false, summary: "Client action failed" }))
          await post({ action: "complete-client-action", id: job.id, ok: result.ok, summary: result.summary, undo: result.undo || {} }).catch(() => null)
        }
      } finally { busy.current = false }
    }

    void claim()
    const timer = window.setInterval(() => void claim(), 10000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    const handler = (event: Event) => {
      const panel = (event as CustomEvent<{ panel?: unknown }>).detail?.panel
      if (typeof panel === "string") void post({ action: "trigger", triggerType: "panel_open", payload: { panel } }).catch(() => null)
    }
    window.addEventListener("synnical-panel-changed", handler)
    return () => window.removeEventListener("synnical-panel-changed", handler)
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    let last = ""
    let cancelled = false
    const refresh = async () => {
      try {
        const res = await fetch("/api/features/presence", { credentials: "include", cache: "no-store" })
        if (!res.ok || cancelled) return
        const body = await res.json()
        const encoded = JSON.stringify(body?.config || {})
        if (encoded && encoded !== last) {
          last = encoded
          window.dispatchEvent(new CustomEvent("synnical-presence-config-changed", { detail: { config: body.config } }))
        }
      } catch {}
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [user?.id])

  return null
}
