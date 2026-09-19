"use client"

import { useAuth } from "@/hooks/use-auth"
import { AppShell } from "@/components/app-shell"
import { Loader2 } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"

type BootStage = "checking" | "playing" | "done"

function BootSurface({ children, className = "", ariaHidden = false }: { children?: ReactNode; className?: string; ariaHidden?: boolean }) {
  return <div className={`synnical-boot-stage ${className}`.trim()} aria-hidden={ariaHidden || undefined}>{children}</div>
}

function SynnicalBoot() {
  return (
    <BootSurface className="synnical-boot">
      <div className="synnical-boot-aura" aria-hidden="true" />
      <div className="synnical-boot-card" role="status" aria-label="Starting Synnical">
        <div className="synnical-boot-mark" aria-hidden="true">
          <span className="synnical-boot-orbit synnical-boot-orbit-one" />
          <span className="synnical-boot-orbit synnical-boot-orbit-two" />
          <img src="/logo.svg" alt="" />
        </div>
        <div className="synnical-boot-wordmark" aria-hidden="true">SYNNICAL</div>
        <div className="synnical-boot-track" aria-hidden="true"><span /></div>
      </div>
    </BootSurface>
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

  if (bootStage === "checking") return <BootSurface ariaHidden />
  if (bootStage === "playing") return <SynnicalBoot />

  if (loading) {
    return (
      <div className="synnical-auth-loading">
        <div className="synnical-auth-loading-card" role="status" aria-label="Loading Synnical">
          <Loader2 className="h-7 w-7 animate-spin text-[var(--synnical-accent)]" />
          <p className="text-sm">Loading Synnical…</p>
        </div>
      </div>
    )
  }

  return <AppShell />
}
