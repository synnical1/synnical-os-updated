"use client"
import { useEffect, useRef } from "react"
export function MusicBackground() {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const motion = matchMedia("(prefers-reduced-motion: reduce)")
    let visible = false
    const update = () => {
      if (visible && !document.hidden && !motion.matches) void video.play().catch(() => {})
      else video.pause()
    }
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting || false; update() })
    observer.observe(video)
    document.addEventListener("visibilitychange", update)
    motion.addEventListener("change", update)
    return () => { video.pause(); observer.disconnect(); document.removeEventListener("visibilitychange", update); motion.removeEventListener("change", update) }
  }, [])
  return <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"><video ref={ref} src="/brand/music/live-background.mp4" autoPlay muted loop playsInline preload="metadata" className="h-full w-full object-cover opacity-70" /><div className="synnical-music-backdrop absolute inset-0" /></div>
}
