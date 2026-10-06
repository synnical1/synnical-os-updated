"use client"

import { useAuth } from "@/hooks/use-auth"
import { AppShell } from "@/components/app-shell"
import { SynnicalLogo } from "@/components/synnical-logo"
import { WallpaperVideo } from "@/components/wallpaper-video"
import { DEFAULT_OS_WALLPAPER } from "@/lib/os-settings"
import { Loader2 } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"

type BootStage = "checking" | "playing" | "done"

function BootSurface({ children, className = "", ariaHidden = false }: { children?: ReactNode; className?: string; ariaHidden?: boolean }) {
  return <div className={`synnical-boot-stage ${className}`.trim()} aria-hidden={ariaHidden || undefined}><WallpaperVideo src={DEFAULT_OS_WALLPAPER} className="synnical-boot-wallpaper" />{children}</div>
}

function SynnicalBoot() {
  return (
    <>
      <div className="synnical-boot-aura" aria-hidden="true" />
      <div className="synnical-boot-card" role="status" aria-label="Starting Synnical">
        <SynnicalLogo variant="logo" decorative className="synnical-boot-logo" />
        <div className="synnical-boot-track" aria-hidden="true"><span /></div>
      </div>
    </>
  )
}

export default function Home() {
  const { loading } = useAuth()
  const [bootStage, setBootStage] = useState<BootStage>("checking")

  useEffect(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
    if (navigation?.type !== "navigate") {
      setBootStage("done")
      return
    }
    setBootStage("playing")
    const timer = window.setTimeout(() => setBootStage("done"), 1500)
    return () => window.clearTimeout(timer)
  }, [])

  if (bootStage !== "done") return <BootSurface className={bootStage === "playing" ? "synnical-boot" : ""} ariaHidden={bootStage === "checking"}>
    {bootStage === "playing" ? <SynnicalBoot /> : null}
  </BootSurface>

  if (loading) {
    return (
      <BootSurface className="synnical-auth-loading">
        <div className="synnical-auth-loading-card" role="status" aria-label="Loading Synnical">
          <Loader2 className="h-7 w-7 animate-spin text-[var(--synnical-accent)]" />
          <p className="text-sm">Loading Synnical…</p>
        </div>
      </BootSurface>
    )
  }

  return <AppShell />
}
