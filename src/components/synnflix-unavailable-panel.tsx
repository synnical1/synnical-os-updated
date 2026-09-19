"use client"

import { UnderConstructionPanel } from "@/components/under-construction-panel"

/**
 * Kept separate from the former provider client so opening SynnFlix does not
 * download, initialize, or expose an unavailable catalogue/player.
 */
export function SynnFlixUnavailablePanel() {
  return <UnderConstructionPanel appName="SynnFlix" eyebrow="Films and series" description="We’re lining up a dependable, properly authorised provider before bringing movies and shows back online." />
}
