/**
 * Unified settings runtime.
 *
 * Only settings with a real CSS/runtime consumer are applied to <html>.
 * The previous implementation rewrote ~1,500 attributes and scanned the
 * entire root class list on every slider input, which caused long main-thread
 * stalls on lower-end devices.
 */

export const SETTINGS_PREFIX = "synnical:settings:"
const SETTINGS_OWNER_KEY = "synnical:settings-account-owner:v1"

type SyncedSetting = string | number | boolean

let accountSettingsUserId = ""
let accountSettingsHydrating = false
let accountSettingsTimer: number | null = null
let pendingAccountSettings: Record<string, SyncedSetting> = {}

function localRuntimeSettings(): Record<string, SyncedSetting> {
  if (typeof window === "undefined") return {}
  const settings: Record<string, SyncedSetting> = {}
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const storageKey = localStorage.key(index)
      if (!storageKey?.startsWith(SETTINGS_PREFIX)) continue
      const key = storageKey.slice(SETTINGS_PREFIX.length)
      const raw = localStorage.getItem(storageKey)
      if (!key || raw === null) continue
      try {
        const value = JSON.parse(raw)
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") settings[key] = value
      } catch {
        settings[key] = raw
      }
    }
  } catch {}
  return settings
}

async function flushAccountSettings() {
  if (!accountSettingsUserId || !Object.keys(pendingAccountSettings).length) return
  const userId = accountSettingsUserId
  const settings = pendingAccountSettings
  pendingAccountSettings = {}
  try {
    await fetch("/api/features/settings", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    })
  } catch {
    if (accountSettingsUserId === userId) pendingAccountSettings = { ...settings, ...pendingAccountSettings }
  }
}

function queueAccountSetting(key: string, value: unknown) {
  if (!accountSettingsUserId || accountSettingsHydrating) return
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return
  pendingAccountSettings[key] = value
  if (accountSettingsTimer !== null) window.clearTimeout(accountSettingsTimer)
  accountSettingsTimer = window.setTimeout(() => {
    accountSettingsTimer = null
    void flushAccountSettings()
  }, 400)
}

export async function startAccountSettingsSync(userId: string): Promise<void> {
  if (typeof window === "undefined" || !userId) return
  accountSettingsUserId = userId
  const local = localRuntimeSettings()
  let owner = ""
  try { owner = localStorage.getItem(SETTINGS_OWNER_KEY) || "" } catch {}

  try {
    const response = await fetch("/api/features/settings", { credentials: "include", cache: "no-store" })
    if (!response.ok || accountSettingsUserId !== userId) return
    const body = await response.json().catch(() => ({}))
    const remote = body?.settings && typeof body.settings === "object" ? body.settings as Record<string, unknown> : {}
    const remoteEntries = Object.entries(remote).filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean") as Array<[string, SyncedSetting]>

    accountSettingsHydrating = true
    if (owner && owner !== userId) {
      for (const key of Object.keys(local)) localStorage.removeItem(SETTINGS_PREFIX + key)
    }
    for (const [key, value] of remoteEntries) {
      localStorage.setItem(SETTINGS_PREFIX + key, JSON.stringify(value))
      window.dispatchEvent(new CustomEvent("synnical-setting-changed", { detail: { key, value } }))
    }
    localStorage.setItem(SETTINGS_OWNER_KEY, userId)
    accountSettingsHydrating = false

    // The first account used on an existing installation adopts its current
    // local preferences. Later accounts never inherit another user's values.
    const canSeedLocal = !owner || owner === userId
    const missing = canSeedLocal
      ? Object.fromEntries(Object.entries(local).filter(([key]) => !(key in remote)))
      : {}
    if (Object.keys(missing).length) {
      pendingAccountSettings = { ...pendingAccountSettings, ...missing }
      await flushAccountSettings()
    }
  } catch {
    accountSettingsHydrating = false
  }
}

export function stopAccountSettingsSync(): void {
  accountSettingsUserId = ""
  pendingAccountSettings = {}
  if (typeof window !== "undefined" && accountSettingsTimer !== null) window.clearTimeout(accountSettingsTimer)
  accountSettingsTimer = null
}

export type RuntimeSettingDef = {
  key: string
  type?: string
  fallback: string | number | boolean
  unit?: string
  cssVar?: string
}

export type RuntimeSettingSection = {
  id: string
  settings: RuntimeSettingDef[]
}

const BOOLEAN_CLASS_BY_KEY: Record<string, string> = {
  "chat.spoilerBlur": "synnical-chat-spoiler-blur",
  "chat.messageGrouping": "synnical-chat-message-grouping",
  "chat.dateSeparators": "synnical-chat-date-separators",
  "chat.inlineMedia": "synnical-chat-inline-media",
  "chat.pinnedIndicator": "synnical-chat-pinned-indicator",
  "chat.threadIndicator": "synnical-chat-thread-indicator",
  "chat.joinLeaveMessages": "synnical-chat-join-leave-messages",
  "emoji.animated": "synnical-emoji-animated",
}

const PERF_TOGGLES: Record<string, { cls: string; addWhenEnabled: boolean; fallback: boolean }> = {
  "perf.bgThrottle": { cls: "no-bg-throttle", addWhenEnabled: false, fallback: true },
  "perf.reduceData": { cls: "reduce-data", addWhenEnabled: true, fallback: false },
  "perf.lazyLoad": { cls: "no-lazy-load", addWhenEnabled: false, fallback: true },
  "perf.prefetch": { cls: "no-prefetch", addWhenEnabled: false, fallback: true },
  "perf.webgl": { cls: "no-webgl", addWhenEnabled: false, fallback: true },
  "perf.canvas": { cls: "no-canvas-accel", addWhenEnabled: false, fallback: true },
  "perf.dnsPrefetch": { cls: "no-dns-prefetch", addWhenEnabled: false, fallback: true },
  "perf.swCache": { cls: "no-sw-cache", addWhenEnabled: false, fallback: true },
}

export function readSetting<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(SETTINGS_PREFIX + key)
    if (raw === null) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      if (typeof fallback === "boolean") return (raw === "true") as T
      if (typeof fallback === "number") return Number(raw) as T
      return raw as T
    }
  } catch {
    return fallback
  }
}

export function writeSetting<T>(key: string, value: T): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(SETTINGS_PREFIX + key, JSON.stringify(value))
    window.dispatchEvent(new CustomEvent("synnical-setting-changed", { detail: { key, value } }))
    queueAccountSetting(key, value)
  } catch {
    /* Ignore quota/privacy errors. */
  }
}

import { useState, useEffect, useCallback } from "react"

export function useSetting<T extends string | number | boolean>(
  key: string,
  fallback: T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readSetting<T>(key, fallback))

  useEffect(() => {
    setValue(readSetting<T>(key, fallback))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.key === key) setValue(readSetting<T>(key, fallback))
    }
    window.addEventListener("synnical-setting-changed", handler)
    return () => window.removeEventListener("synnical-setting-changed", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = useCallback((v: T) => {
    setValue(v)
    writeSetting(key, v)
  }, [key])

  return [value, update]
}

function formatCssValue(def: RuntimeSettingDef, value: string | number | boolean): string {
  // Percentage-backed variables are unitless numbers used inside calc(... / 100).
  // Length/time variables need their CSS units.
  if (typeof value === "number" && def.unit) {
    const unit = def.unit.trim()
    if (unit && unit !== "%") return `${value}${unit}`
  }
  return String(value)
}

function applyDefinition(root: HTMLElement, def: RuntimeSettingDef, value: string | number | boolean) {
  if (def.cssVar) root.style.setProperty(def.cssVar, formatCssValue(def, value))

  const className = BOOLEAN_CLASS_BY_KEY[def.key]
  if (className) root.classList.toggle(className, value === true)
}


function adaptiveLowEndDetected(): boolean {
  if (typeof navigator === "undefined") return false
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; saveData?: boolean } }
  const cores = Number(nav.hardwareConcurrency || 0)
  const memory = Number(nav.deviceMemory || 0)
  const effective = String(nav.connection?.effectiveType || "")
  return Boolean(nav.connection?.saveData) || effective === "slow-2g" || effective === "2g" || effective === "3g" || (cores > 0 && cores <= 4) || (memory > 0 && memory <= 4)
}

function applyPerformanceMode(root: HTMLElement) {
  const manual = readSetting("perf.mode", false)
  const automatic = readSetting("perf.autoScale", false) && adaptiveLowEndDetected()
  root.classList.toggle("synnical-perf-mode", manual || automatic)
  root.dataset.synnicalAutoPerf = automatic ? "on" : "off"
}

function applySpecialSetting(root: HTMLElement, key: string, value: string | number | boolean) {
  if (key === "privacy.tabCloak") {
    // The browser tab identity is intentionally fixed. Keeping this here also
    // migrates older saved "off" values without requiring users to clear
    // localStorage.
    document.title = "Google Classroom"
    let icon = document.querySelector<HTMLLinkElement>('link[data-synnical-tab-icon="true"]')
    if (!icon) {
      icon = document.createElement("link")
      icon.rel = "icon"
      icon.dataset.synnicalTabIcon = "true"
      document.head.appendChild(icon)
    }
    icon.href = "/brand/google-classroom.png"
    icon.type = "image/png"
    return
  }

  if (key === "a11y.reduceMotion") {
    root.classList.toggle("reduce-motion", value === true)
    return
  }

  if (key === "a11y.reducedMotionAll") {
    const enabled = value === true
    if (enabled) root.style.setProperty("--synnical-all-transitions", "none")
    else root.style.removeProperty("--synnical-all-transitions")
    root.classList.toggle("synnical-reduced-motion", enabled)
    return
  }

  if (key === "a11y.highContrast") {
    root.classList.toggle("synnical-high-contrast", value === true)
    return
  }

  if (key === "a11y.highLegibility") {
    root.classList.toggle("synnical-high-legibility", value === true)
    return
  }

  if (key === "a11y.dyslexiaFriendly") {
    root.classList.toggle("synnical-dyslexia-friendly", value === true)
    return
  }

  if (key === "a11y.largePointer") {
    root.classList.toggle("synnical-large-pointer", value === true)
    return
  }

  if (key === "a11y.simplifiedUi") {
    root.classList.toggle("synnical-simplified-ui", value === true)
    return
  }

  if (key === "a11y.interfaceDensity") {
    root.classList.remove("synnical-ui-comfortable", "synnical-ui-compact", "synnical-ui-minimal")
    const density = ["comfortable", "compact", "minimal"].includes(String(value)) ? String(value) : "comfortable"
    root.classList.add(`synnical-ui-${density}`)
    return
  }

  if (key === "a11y.lineSpacing") {
    const percent = Math.max(120, Math.min(220, Number(value) || 150))
    root.style.setProperty("--synnical-line-spacing", String(percent / 100))
    root.classList.add("synnical-custom-line-spacing")
    return
  }

  if (key === "a11y.messageSpacing") {
    root.style.setProperty("--synnical-message-spacing", `${Math.max(0, Math.min(20, Number(value) || 0))}px`)
    return
  }

  if (key === "a11y.focusThickness") {
    root.style.setProperty("--synnical-focus-thickness", `${Math.max(1, Math.min(6, Number(value) || 2))}px`)
    return
  }

  if (key === "a11y.interfaceZoom") {
    root.style.setProperty("--synnical-interface-zoom", String(Math.max(80, Math.min(125, Number(value) || 100)) / 100))
    return
  }

  if (key === "chat.msgDensity") {
    root.classList.remove("synnical-density-cozy", "synnical-density-compact", "synnical-density-ultra-compact")
    const density = ["cozy", "compact", "ultra-compact"].includes(String(value)) ? String(value) : "cozy"
    root.classList.add(`synnical-density-${density}`)
    return
  }

  if (key === "a11y.fontScale") {
    root.style.setProperty("--synnical-font-scale", `${Number(value) || 100}%`)
    return
  }

  const perfToggle = PERF_TOGGLES[key]
  if (perfToggle) {
    const enabled = value === true
    root.classList.toggle(perfToggle.cls, perfToggle.addWhenEnabled ? enabled : !enabled)
    return
  }

  if (key === "perf.mode" || key === "perf.autoScale") {
    applyPerformanceMode(root)
    return
  }

  if (key === "perf.cacheSize") {
    root.setAttribute("data-perf-cache-size", String(value))
    return
  }

  if (key === "perf.maxConn") root.setAttribute("data-perf-max-conn", String(value))
}

export function applySettingChange(
  key: string,
  value: string | number | boolean,
  def?: RuntimeSettingDef,
) {
  if (typeof window === "undefined") return
  const root = document.documentElement
  if (def) applyDefinition(root, def, value)
  applySpecialSetting(root, key, value)
}

export function applyAllSettings(sections: RuntimeSettingSection[]) {
  if (typeof window === "undefined") return
  const root = document.documentElement

  // Read and apply only definitions that have an actual consumer.
  for (const section of sections) {
    for (const def of section.settings) {
      if (!def.cssVar && !BOOLEAN_CLASS_BY_KEY[def.key]) continue
      applyDefinition(root, def, readSetting(def.key, def.fallback))
    }
  }

  applySpecialSetting(root, "a11y.reduceMotion", readSetting("a11y.reduceMotion", false))
  applySpecialSetting(root, "a11y.reducedMotionAll", readSetting("a11y.reducedMotionAll", false))
  applySpecialSetting(root, "a11y.highContrast", readSetting("a11y.highContrast", false))
  applySpecialSetting(root, "a11y.highLegibility", readSetting("a11y.highLegibility", false))
  applySpecialSetting(root, "a11y.dyslexiaFriendly", readSetting("a11y.dyslexiaFriendly", false))
  applySpecialSetting(root, "a11y.largePointer", readSetting("a11y.largePointer", false))
  applySpecialSetting(root, "a11y.simplifiedUi", readSetting("a11y.simplifiedUi", false))
  applySpecialSetting(root, "a11y.interfaceDensity", readSetting("a11y.interfaceDensity", "comfortable"))
  applySpecialSetting(root, "a11y.lineSpacing", readSetting("a11y.lineSpacing", 150))
  applySpecialSetting(root, "a11y.messageSpacing", readSetting("a11y.messageSpacing", 4))
  applySpecialSetting(root, "a11y.focusThickness", readSetting("a11y.focusThickness", 2))
  applySpecialSetting(root, "a11y.interfaceZoom", readSetting("a11y.interfaceZoom", 100))
  applySpecialSetting(root, "chat.msgDensity", readSetting("chat.msgDensity", "cozy"))
  applySpecialSetting(root, "a11y.fontScale", readSetting("a11y.fontScale", 100))
  applySpecialSetting(root, "privacy.tabCloak", "google-classroom")

  for (const [key, config] of Object.entries(PERF_TOGGLES)) {
    applySpecialSetting(root, key, readSetting(key, config.fallback))
  }
  applySpecialSetting(root, "perf.mode", readSetting("perf.mode", false))
  applySpecialSetting(root, "perf.autoScale", readSetting("perf.autoScale", false))
  applySpecialSetting(root, "perf.cacheSize", readSetting("perf.cacheSize", 256))
  applySpecialSetting(root, "perf.maxConn", readSetting("perf.maxConn", 10))
}
