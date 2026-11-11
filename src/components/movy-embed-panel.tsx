"use client"

const MOVY_HOME = "https://www.movy.sx/"
const MOVY_ANIME = "https://www.movy.sx/browse/anime"

/**
 * Full-bleed in-app web surface. This is a direct iframe, not a proxy:
 * Movy's own browser security policy remains in force.
 */
export function MovyEmbedPanel({ mode = "movies" }: { mode?: "movies" | "anime" }) {
  const src = mode === "anime" ? MOVY_ANIME : MOVY_HOME

  return (
    <main className="relative h-full min-h-[560px] w-full overflow-hidden bg-background">
      <iframe
        key={src}
        title={mode === "anime" ? "Synnime" : "SynnFlix"}
        src={src}
        className="absolute inset-0 h-full w-full border-0 bg-background"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        loading="eager"
      />
    </main>
  )
}
