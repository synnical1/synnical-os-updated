"use client"

import { ExternalLink } from "lucide-react"

const MOVY_HOME = "https://www.movy.sx/"
const MOVY_ANIME = "https://www.movy.sx/browse/anime"

export function MovyEmbedPanel({ mode = "movies" }: { mode?: "movies" | "anime" }) {
  const animeMode = mode === "anime"
  const appName = animeMode ? "Synnime" : "SynnFlix"
  const src = animeMode ? MOVY_ANIME : MOVY_HOME

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {animeMode ? "Anime" : "Movies & series"}
          </p>
          <h1 className="truncate text-xl font-semibold tracking-tight">{appName}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Content and playback provided by Movy.
          </p>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium transition hover:bg-muted"
        >
          Open Movy separately
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </header>

      <div className="relative min-h-[420px] flex-1 bg-black">
        <iframe
          key={src}
          title={animeMode ? "Movy anime catalogue" : "Movy movies and TV catalogue"}
          src={src}
          className="absolute inset-0 h-full w-full border-0 bg-black"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          loading="eager"
        />
      </div>
    </section>
  )
}
