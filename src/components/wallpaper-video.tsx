"use client"

import { useEffect, useRef, type CSSProperties } from "react"
import { syncWallpaperPlayback } from "@/lib/wallpaper-playback"

/** Videos always play while Synnical is visible, regardless of battery/performance settings. */
export function WallpaperVideo({ src, className, style, fit = "fill" }: {
  src: string; className?: string; style?: CSSProperties; fit?: "fill" | "fit" | "stretch" | "center" | "tile"
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const update = () => syncWallpaperPlayback(video, { hidden: document.hidden })
    document.addEventListener("visibilitychange", update)
    update()
    return () => { document.removeEventListener("visibilitychange", update); video.pause() }
  }, [src])
  const objectFit = fit === "fit" ? "contain" : fit === "stretch" ? "fill" : fit === "center" ? "none" : "cover"
  return <video ref={ref} aria-hidden="true" className={className} src={src} style={{ ...style, objectFit }}
    autoPlay muted loop playsInline preload="auto" />
}
