"use client"

import { BrowserPanel } from "@/components/browser-panel"

export function GeForceNowPanel() {
  return <BrowserPanel initialUrl="https://play.geforcenow.com/" embedded immersiveGame embeddedLabel="GeForce NOW" />
}
