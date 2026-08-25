"use client"

import { useAuth } from "@/hooks/use-auth"
import { AppShell } from "@/components/app-shell"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

type BootStage = "checking" | "playing" | "done"
const DEFAULT_WALLPAPER = "/brand/wallpapers/synnical-static-ink-wallpaper.png"

function WallpaperBackdrop() {
  return <img className="pointer-events-none absolute inset-0 h-full w-full object-cover" src={DEFAULT_WALLPAPER} alt="" />
}

function SynnicalBoot() {
  return (
    <div
      className="synnical-boot relative overflow-hidden"
      role="status"
      aria-label="Starting Synnical"
    >
      <WallpaperBackdrop />
      <div className="absolute inset-0 bg-black/20" aria-hidden="true" />
      <div className="synnical-boot-aura" aria-hidden="true" />
      <div className="synnical-boot-mark" aria-hidden="true">
        <span className="synnical-boot-orbit synnical-boot-orbit-one" />
        <span className="synnical-boot-orbit synnical-boot-orbit-two" />
        <img src="/logo.svg" alt="" />
      </div>
      <div className="synnical-boot-wordmark" aria-hidden="true">SYNNICAL</div>
      <div className="synnical-boot-track" aria-hidden="true"><span /></div>
    </div>
  )
}

export default function Home() {
  const { loading } = useAuth()
  const [bootStage, setBootStage] = useState<BootStage>("checking")

  useEffect(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
    // A document-level `navigate` is a genuine entry into Synnical. Reloads,
    // history restores and client-side panel changes must never replay boot.
    if (navigation?.type !== "navigate") {
      setBootStage("done")
      return
    }
    setBootStage("playing")
    const timer = window.setTimeout(() => setBootStage("done"), 1500)
    return () => window.clearTimeout(timer)
  }, [])

  if (bootStage === "checking") return <div className="relative min-h-screen overflow-hidden" aria-hidden="true"><WallpaperBackdrop /><div className="absolute inset-0 bg-black/20" /></div>
  if (bootStage === "playing") return <SynnicalBoot />

  if (loading) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-3 overflow-hidden">
        <WallpaperBackdrop />
        <div className="absolute inset-0 bg-black/20" />
        <Loader2 className="h-7 w-7 animate-spin text-[var(--synnical-accent)]" />
        <p className="text-sm text-[#888888]">Loading Synnical…</p>
      </div>
    )
  }

  // Synnical OS is the direct landing experience. Authentication, mandatory
  // security setup, and account-only apps are handled inside the shared shell.
  return <AppShell />
}
