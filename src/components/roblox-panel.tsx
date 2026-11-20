"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RobloxIcon } from "@/components/brand-app-icons"

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
  } catch {
    return null
  }
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
    if (!target) {
      setError("Enter a Roblox experience link or a valid place ID.")
      return
    }
    openPlayer(target)
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-5 py-7 sm:px-8 sm:py-9">
        <header className="flex items-center gap-3 border-b border-border pb-5">
          <RobloxIcon className="h-8 w-8 shrink-0" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Roblox</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Play experiences on your device</p>
          </div>
        </header>

        <section className="flex flex-col justify-between gap-7 rounded-2xl bg-[#111111] px-6 py-7 text-white sm:flex-row sm:items-end sm:px-8 sm:py-9">
          <div className="max-w-xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-white/55">ROBLOX PLAYER</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Ready to play?</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/65">
              Open Roblox in a new tab. Your Roblox session stays separate from your Synnical account.
            </p>
            <Button onClick={() => openPlayer()} size="lg" className="mt-6">
              Launch Roblox
            </Button>
          </div>
          <div className="hidden items-center justify-center pb-1 sm:flex">
            <RobloxIcon className="h-24 w-24 text-white/90" />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card px-5 py-5 sm:px-6 sm:py-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold">Join an experience</h2>
            <p className="mt-1 text-sm text-muted-foreground">Paste a Roblox game link or enter its place ID.</p>
          </div>
          <form onSubmit={joinGame} className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={gameLink}
              onChange={event => setGameLink(event.target.value)}
              placeholder="roblox.com/games/… or place ID"
              aria-label="Roblox game link or place ID"
              aria-invalid={Boolean(error)}
              className="h-11 min-w-0 flex-1 border-border bg-background text-foreground placeholder:text-muted-foreground"
            />
            <Button type="submit" className="h-11 shrink-0 px-5">
              Join experience
            </Button>
          </form>
          {error ? <p role="alert" className="mt-3 text-sm text-red-500">{error}</p> : null}
        </section>

        <section className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2 sm:gap-10">
          <div>
            <h3 className="text-sm font-semibold">Separate Roblox session</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              Sign-in and Roblox session data stay on the dedicated player site. Never share your Roblox session cookie with anyone.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Runs on this device</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              The player renders locally in your browser. Synnical does not stream the game from a cloud gaming server.
            </p>
          </div>
        </section>

        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
          Roblox is a third-party service. This browser-based client is not the official Roblox desktop app and may have compatibility or account-support limitations.
        </p>
      </div>
    </main>
  )
}
