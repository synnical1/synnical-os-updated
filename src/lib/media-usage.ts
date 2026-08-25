"use client"

export type SynnicalMediaUsageDetail = {
  source: string
  microphone?: boolean
  camera?: boolean
  screen?: boolean
}

/**
 * Reports media capture that Synnical itself owns. This deliberately does not
 * claim to inspect capture performed by other browser tabs or native apps.
 */
export function announceMediaUsage(source: string, usage: Omit<SynnicalMediaUsageDetail, "source">) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<SynnicalMediaUsageDetail>("synnical-media-usage", {
    detail: { source: source.slice(0, 40), ...usage },
  }))
}
