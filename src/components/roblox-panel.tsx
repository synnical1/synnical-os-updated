"use client"
import { useState, type FormEvent } from "react"
import { ArrowUpRight, Gamepad2, ShieldCheck, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const ROBLOX_PLAYER_URL = "https://roblox.synnical.co.uk/roblox-player/index.html"

function gameTarget(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (/^[1-9]\d{0,18}$/.test(raw)) return `?placeId=${raw}`
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!/(^|\.)roblox\.com$/i.test(url.hostname)) return null
    const match = url.pathname.match(/\/games\/([1-9]\d{0,18})(?:\/|$)/i)
    if (!match) return null
    const params = new URLSearchParams({ placeId: match[1] })
    const serverId = url.searchParams.get("gameInstanceId")
    if (serverId && /^[A-Za-z0-9-]{1,64}$/.test(serverId)) params.set("gameInstanceId", serverId)
    return `?${params.toString()}`
  } catch { return null }
}

export function RobloxPanel() {
  const [gameLink, setGameLink] = useState("")
  const [error, setError] = useState("")
  function openPlayer(target = "") {
    const url = new URL(ROBLOX_PLAYER_URL)
    if (target) url.search = target
    window.open(url.toString(), "_blank", "noopener,noreferrer")
    setError("")
  }
  function joinGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = gameTarget(gameLink)
    if (!target) { setError("Enter a Roblox game URL or a valid place ID."); return }
    openPlayer(target)
  }
  return (
    <main className="h-full min-h-0 overflow-y-auto p-5 text-white sm:p-7">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#101a30] via-[#10131d] to-[#08090d] p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#2878ff]/15 blur-3xl" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70"><Sparkles className="h-3.5 w-3.5 text-blue-300" /> Synnical gaming</div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Roblox</h1>
              <p className="max-w-lg text-sm leading-6 text-white/65 sm:text-base">Explore experiences and launch Roblox in its own dedicated player window.</p>
              <Button onClick={() => openPlayer()} size="lg" className="gap-2"><Gamepad2 className="h-4 w-4" /> Open Roblox <ArrowUpRight className="h-4 w-4" /></Button>
            </div>
            <div className="hidden shrink-0 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] p-8 sm:flex"><Gamepad2 className="h-24 w-24 text-blue-300" strokeWidth={1.2} /></div>
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl bg-blue-500/10 p-2 text-blue-300"><ArrowUpRight className="h-5 w-5" /></div>
            <div><h2 className="font-medium">Jump straight into an experience</h2><p className="text-sm text-white/55">Paste a Roblox game link or enter its place ID.</p></div>
          </div>
          <form onSubmit={joinGame} className="flex flex-col gap-3 sm:flex-row">
            <Input value={gameLink} onChange={event => setGameLink(event.target.value)} placeholder="Roblox game URL or place ID" aria-label="Roblox game URL or place ID" className="min-w-0 flex-1 border-white/10 bg-black/25 text-white placeholder:text-white/35" />
            <Button type="submit" className="shrink-0 gap-2">Play experience <ArrowUpRight className="h-4 w-4" /></Button>
          </form>
          {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
        </section>
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-emerald-300" /> Separate account storage</div><p className="text-sm leading-5 text-white/55">Roblox sign-in stays on the dedicated player origin. Synnical never asks you to paste your session cookie into chat or settings.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><Gamepad2 className="h-4 w-4 text-blue-300" /> Runs on your device</div><p className="text-sm leading-5 text-white/55">The game client runs locally in your browser. Roblox game traffic does not pass through Synnical's cloud-gaming service.</p></div>
        </section>
        <p className="text-xs leading-5 text-white/40">Roblox is a third-party service. Its modified browser client may carry account-warning or compatibility risks. Only sign in on the dedicated player page.</p>
      </div>
    </main>
  )
}
