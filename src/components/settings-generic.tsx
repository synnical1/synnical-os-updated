"use client"

import { useEffect } from "react"
import {
  SETTINGS_PREFIX,
  applyAllSettings,
  applySettingChange,
  readSetting,
} from "@/lib/settings-runtime"

/**
 * Global settings bridge.
 *
 * Synnical used to ship two generated catalogs containing hundreds of settings
 * that were never exposed by the current Settings UI and, worse, could still
 * mutate CSS if stale localStorage keys survived from an older build. The
 * consolidated release applies only runtime settings with real consumers.
 */
export function SettingsApplier() {
  useEffect(() => {
    // applyAllSettings([]) intentionally applies only the explicit special
    // runtime settings (accessibility, message density and performance flags).
    applyAllSettings([])

    const onSettingChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: string | number | boolean }>).detail
      if (!detail?.key || detail.value === undefined) return
      applySettingChange(detail.key, detail.value)
    }

    const onStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(SETTINGS_PREFIX)) return
      const key = event.key.slice(SETTINGS_PREFIX.length)
      const fallback = typeof event.oldValue === "string" ? event.oldValue : ""
      applySettingChange(key, readSetting(key, fallback))
    }

    const connection = (navigator as Navigator & { connection?: EventTarget }).connection
    const onConnectionChanged = () => applySettingChange("perf.autoScale", readSetting("perf.autoScale", false))

    window.addEventListener("synnical-setting-changed", onSettingChanged)
    window.addEventListener("storage", onStorage)
    connection?.addEventListener?.("change", onConnectionChanged)
    return () => {
      window.removeEventListener("synnical-setting-changed", onSettingChanged)
      window.removeEventListener("storage", onStorage)
      connection?.removeEventListener?.("change", onConnectionChanged)
    }
  }, [])

  return null
}
