"use client"

import { Button } from "@/components/ui/button"
import { Settings, Crown, Clock, ShieldCheck, MonitorUp } from "lucide-react"
import { useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import type { Panel } from "@/components/app-shell"
import { AvatarWithDeco, DisplayName } from "@/components/role-ui"
import { cn } from "@/lib/utils"
import { readSetting } from "@/lib/settings-runtime"

const PANEL_LABELS: Partial<Record<Panel, string>> = {
  discover: "Search & System Health",
  browser: "Browser",
  games: "Games",
  chat: "Chat",
  friends: "Friends",
  moderation: "Moderation",
  "temp-mail": "Temp Mail",
  movies: "Movies",
  music: "Music",
  ai: "AI Assistant",
  youtube: "YouTube",
  "geforce-now": "GeForce NOW",
  spaces: "Spaces",
  calls: "Calls",
  automations: "Automations",
  market: "Marketplace",
  creator: "Creator Studio",
  developer: "Developer",
  lab: "Synnical Lab",
  shop: "Shop",
  profile: "Profile",
  settings: "Settings",
  auth: "Log in",
}

export function TopBar({ panel, onPanel, onDesktop }: { panel: Panel; onPanel: (p: Panel) => void; onDesktop?: () => void }) {
  const { user } = useAuth()
  const [clock, setClock] = useState("")
  const topBarHeight = readSetting("layout.topBarHeight", 56)
  const topBarSticky = readSetting("layout.topBarSticky", true)
  const showClock = readSetting("appearance.showClock", true)

  useEffect(() => {
    if (!showClock) return
    const update = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
    update()
    const timer = setInterval(update, 30_000)
    return () => clearInterval(timer)
  }, [showClock])

  return (
    <header
      className={cn(
        "synnical-topbar relative z-20 shrink-0 border-b border-[#202020] bg-black flex items-center gap-3 px-3",
        topBarSticky ? "sticky top-0" : "relative",
      )}
      style={{ height: `${Math.min(topBarHeight, 52)}px` }}
    >
      <button onClick={() => onPanel("browser")} className="flex h-9 items-center gap-2 border-r border-[#222] pr-4 text-left">
        <img src="/brand/rose.png" alt="" className="h-7 w-7 object-cover" />
        <span className="hidden text-sm font-semibold tracking-[0.02em] text-white sm:block">Synnical</span>
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-[#a0a0a0]">{PANEL_LABELS[panel] || "Synnical"}</p>
      </div>

      {showClock && clock && (
        <div className="hidden h-8 items-center gap-1.5 border-l border-[#222] px-3 text-xs text-[#858585] sm:flex">
          <Clock className="h-3.5 w-3.5" />
          <span>{clock}</span>
        </div>
      )}

      {onDesktop ? <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDesktop} aria-label="Open Synnical desktop" title="Desktop mode"><MonitorUp className="h-4 w-4" /></Button> : null}

      <Button variant={panel === "settings" ? "default" : "ghost"} size="icon" className="h-8 w-8" onClick={() => onPanel(user ? "settings" : "auth")} aria-label={user ? "Settings" : "Log in"}>
        <Settings className="h-4 w-4" />
      </Button>

      {user ? (
        <button
          onClick={() => onPanel("profile")}
          className={cn(
            "flex h-9 items-center gap-2 border border-[#262626] bg-[#080808] pl-1 pr-2 text-white transition-colors hover:bg-[#111]",
            panel === "profile" && "border-white",
          )}
        >
          <AvatarWithDeco src={user.pfpUrl} name={user.displayName} role={user.role} avatarDeco={user.avatarDeco} isGif={user.pfpIsGif} size="xs" />
          <DisplayName name={user.displayName} role={user.role} className="hidden max-w-[110px] truncate text-xs font-medium sm:block" />
          {user.role === "OWNER" && <Crown className="hidden h-3.5 w-3.5 text-amber-400 sm:block" />}
          {user.role === "HEAD_ADMIN" && <ShieldCheck className="hidden h-3.5 w-3.5 text-orange-300 sm:block" />}
        </button>
      ) : (
        <Button variant="outline" size="sm" className="h-8" onClick={() => onPanel("auth")}>Log in</Button>
      )}
    </header>
  )
}
