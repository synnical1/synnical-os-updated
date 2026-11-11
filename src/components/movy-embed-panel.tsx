"use client"

import { useEffect, useRef } from "react"
import { useScramjetController, useScramjetFrame } from "@/hooks/use-scramjet"

const MOVY_HOME = "https://www.movy.sx/"
const MOVY_ANIME = "https://www.movy.sx/browse/anime"

/**
 * Native Synnical app surface backed by the same Scramjet runtime as Browser.
 * The iframe is only the rendering surface; upstream navigation and
 * subresource requests are handled by Synnical's registered proxy worker.
 */
export function MovyEmbedPanel({ mode = "movies" }: { mode?: "movies" | "anime" }) {
  const src = mode === "anime" ? MOVY_ANIME : MOVY_HOME
  const iframeRef = useRef<HTMLIFrameElement>(null!)
  const proxy = useScramjetController()
  const controller = proxy.status === "ready" ? proxy.controller : null
  const { navigate } = useScramjetFrame(controller, iframeRef)

  useEffect(() => {
    if (proxy.status === "ready") navigate(src)
  }, [proxy.status, navigate, src])

  return (
    <main className="relative h-full min-h-[560px] w-full overflow-hidden bg-background">
      <iframe
        ref={iframeRef}
        title={mode === "anime" ? "Synnime" : "SynnFlix"}
        className="absolute inset-0 h-full w-full border-0 bg-background"
        referrerPolicy="no-referrer"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        loading="eager"
      />
      {proxy.status === "loading" || proxy.status === "idle" ? (
        <div className="absolute inset-0 grid place-items-center bg-background text-sm text-muted-foreground" role="status">
          Starting Synnical browser…
        </div>
      ) : null}
      {proxy.status === "error" ? (
        <div className="absolute inset-0 grid place-items-center bg-background p-6 text-center">
          <div className="max-w-md space-y-3">
            <p className="font-medium">Synnical browser couldn't start</p>
            <p className="text-sm text-muted-foreground">{proxy.error}</p>
            <button type="button" onClick={proxy.retry} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">Retry</button>
          </div>
        </div>
      ) : null}
    </main>
  )
}
