"use client"

import { UnderConstructionPanel } from "@/components/under-construction-panel"

/**
 * Keeps SynnFlix and Synnime independent of catalogue/player vendors until an
 * authorised provider is selected. No third-party site is proxied or embedded.
 */
export function SynnFlixUnavailablePanel({ appName = "SynnFlix" }: { appName?: string } = {}) {
  const subject = appName === "Synnime" ? "anime" : "films and series"
  return (
    <UnderConstructionPanel
      appName={appName}
      eyebrow={subject}
      description={"We’re lining up a dependable, properly authorised provider before bringing " + subject + " back online."}
    />
  )
}
