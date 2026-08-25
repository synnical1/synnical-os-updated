"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

function RemoteBrandIcon({ src, fallback, className }: { src: string; fallback: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span aria-hidden="true" className={cn("grid place-items-center rounded bg-white/10 text-[0.6em] font-black leading-none", className)}>{fallback}</span>
  return <img aria-hidden="true" src={src} onError={() => setFailed(true)} className={cn("object-contain", className)} alt="" referrerPolicy="no-referrer" />
}

export function YouTubeIcon({ className }: { className?: string }) {
  return <RemoteBrandIcon src="https://cdn.simpleicons.org/youtube/FF0000" fallback="▶" className={className} />
}

export function GeForceNowIcon({ className }: { className?: string }) {
  return <RemoteBrandIcon src="https://play.geforcenow.com/favicon.ico" fallback="GFN" className={className} />
}
