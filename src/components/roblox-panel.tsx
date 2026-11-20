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
      <div className="mx-auto flex w-full max-w-5xl flex-col px-5 py-7 sm:px-8 sm:py-9">
        <header className="flex items-center gap-3 border-b border-border pb-6">
          <RobloxIcon className="h-8 w-8 shrink-0" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Roblox</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Launch and join experiences</p>
          </div>
        </header>

        <section className="grid gap-9 border-b border-border py-8 sm:py-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
          <div className="flex flex-col items-start">
            <h2 className="text-2xl font-semibold tracking-tight">Open Roblox</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Start the player in a separate browser tab. Your Roblox sign-in stays separate from your Synnical account.
            </p>
            <Button onClick={() => openPlayer()} size="lg" className="mt-5">
              Open player
            </Button>
          </div>

          <div className="border-t border-border pt-8 sm:pt-0 lg:border-l lg:border-t-0 lg:pl-12">
            <h2 className="text-base font-semibold">Join an experience</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Paste a Roblox game link or enter its place ID.
            </p>
            <form onSubmit={joinGame} className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Input
                value={gameLink}
                onChange={event => setGameLink(event.target.value)}
                placeholder="roblox.com/games/… or place ID"
                aria-label="Roblox game link or place ID"
                aria-invalid={Boolean(error)}
                className="h-11 min-w-0 flex-1 border-border bg-background text-foreground placeholder:text-muted-foreground"
              />
              <Button type="submit" className="h-11 shrink-0 px-5">
                Join
              </Button>
            </form>
            {error ? <p role="alert" className="mt-3 text-sm text-red-500">{error}</p> : null}
          </div>
        </section>

        <footer className="flex flex-col gap-2 pt-5">
          <p className="text-sm leading-6 text-muted-foreground">
            Roblox sign-in and session data stay on the dedicated player site. Never share your Roblox session cookie with anyone.
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            The player runs in your browser. This is not the official Roblox desktop app and may have compatibility or account-support limitations.
          </p>
        </footer>
      </div>
    </main>
  )
}
