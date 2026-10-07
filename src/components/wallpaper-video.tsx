"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { DEFAULT_OS_WALLPAPER, DEFAULT_OS_WALLPAPER_POSTER, type WallpaperFit } from "@/lib/os-settings"
import { syncWallpaperPlayback } from "@/lib/wallpaper-playback"

/** One stable video per visible surface; static poster on reduced motion/error. */
export function WallpaperVideo({ src, className, style, paused = false, fit = "fill" }: {
  src: string; className?: string; style?: CSSProperties; paused?: boolean; fit?: WallpaperFit
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [animate, setAnimate] = useState(false)
  const [failedSrc, setFailedSrc] = useState("")
  const poster = src === DEFAULT_OS_WALLPAPER ? DEFAULT_OS_WALLPAPER_POSTER : undefined
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setAnimate(!media.matches && !document.documentElement.classList.contains("reduce-motion"))
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    media.addEventListener("change", update)
    update()
    return () => { media.removeEventListener("change", update); observer.disconnect() }
  }, [])
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const update = () => {
      syncWallpaperPlayback(video, { reduceMotion: !animate, userPaused: paused, hidden: document.hidden })
    }
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    document.addEventListener("visibilitychange", update)
    update()
    return () => { document.removeEventListener("visibilitychange", update); observer.disconnect(); video.pause() }
  }, [src, animate, paused])
  const objectFit = fit === "fit" ? "contain" : fit === "stretch" ? "fill" : fit === "center" ? "none" : "cover"
  if ((!animate && poster) || failedSrc === src) return <div aria-hidden="true" className={className} style={{ ...style, backgroundImage: poster ? `url("${poster}")` : undefined, backgroundSize: fit === "fit" ? "contain" : fit === "stretch" ? "100% 100%" : fit === "center" || fit === "tile" ? "auto" : "cover", backgroundRepeat: fit === "tile" ? "repeat" : "no-repeat", backgroundPosition: "center" }} />
  return <video ref={ref} aria-hidden="true" className={className} src={src} poster={poster} style={{ ...style, objectFit }}
    autoPlay={animate} muted loop playsInline preload="metadata" onError={() => setFailedSrc(src)} />
}
