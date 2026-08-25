"use client"

import { useEffect } from "react"
import { readSetting, writeSetting } from "@/lib/settings-runtime"
import { isKnownAdUrl } from "@/lib/ad-shield"

const SETTINGS_PREFIX = "synnical:settings:"
const LEGACY_AD_HOSTS = ["septierpranker.com", "llvpn.com"]

function configuredAdUrl(): URL | null {
  const raw = process.env.NEXT_PUBLIC_AD_SCRIPT_URL?.trim()
  const allowedHosts = (process.env.NEXT_PUBLIC_AD_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  if (!raw || allowedHosts.length === 0) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname.toLowerCase())) return null
    return url
  } catch {
    return null
  }
}

function purgeAds(): void {
  if (typeof document === "undefined") return
  const configuredHost = configuredAdUrl()?.hostname
  const blockedHosts = [...LEGACY_AD_HOSTS, ...(configuredHost ? [configuredHost] : [])]

  document.querySelectorAll("[data-synnical-ad]").forEach((element) => element.remove())
  document.querySelectorAll("script[src], iframe[src]").forEach((element) => {
    const src = element.getAttribute("src") || ""
    if (blockedHosts.some((host) => src.includes(host)) || isKnownAdUrl(src)) element.remove()
  })
}

export function AdInjector() {
  useEffect(() => {
    const migrationKey = SETTINGS_PREFIX + "migration.ads-shield-v8"
    try {
      if (localStorage.getItem(migrationKey) !== "true") {
        writeSetting("ads.enabled", true)
        localStorage.setItem(migrationKey, "true")
      }
    } catch {}
    purgeAds()
    const originalOpen = window.open.bind(window)
    const guardedOpen: typeof window.open = (url?: string | URL, target?: string, features?: string) => {
      const value = url == null ? "" : String(url)
      if (readSetting("ads.enabled", true) && isKnownAdUrl(value)) return null
      return originalOpen(url as string | URL | undefined, target, features)
    }
    try { window.open = guardedOpen } catch {}

    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor) return
      if (readSetting("ads.enabled", true) && isKnownAdUrl(anchor.href)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    const onSettingChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.key === "ads.enabled") purgeAds()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SETTINGS_PREFIX + "ads.enabled") return
      purgeAds()
    }
    let purgeFrame = 0
    const schedulePurge = () => {
      if (purgeFrame) return
      purgeFrame = window.requestAnimationFrame(() => {
        purgeFrame = 0
        purgeAds()
      })
    }
    const observer = new MutationObserver(() => {
      if (readSetting("ads.enabled", true)) schedulePurge()
    })
    try { observer.observe(document.documentElement, { childList: true, subtree: true }) } catch {}

    window.addEventListener("synnical-setting-changed", onSettingChanged)
    window.addEventListener("storage", onStorage)
    window.addEventListener("click", onClick, true)
    return () => {
      try { window.open = originalOpen } catch {}
      if (purgeFrame) window.cancelAnimationFrame(purgeFrame)
      observer.disconnect()
      window.removeEventListener("synnical-setting-changed", onSettingChanged)
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("click", onClick, true)
    }
  }, [])

  return null
}
