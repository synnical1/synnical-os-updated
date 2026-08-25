"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { getProfileEffect, PROFILE_EFFECTS } from "@/lib/profile-effect-catalog"
import { cn } from "@/lib/utils"

/**
 * Fallback geometry used only while a remote Discord collectible is loading or
 * when no profile effect is selected.  Once the image is available the card
 * adopts the collectible's real intrinsic aspect ratio instead of stretching
 * the media to a fixed Synnical box.
 */
export const PROFILE_EFFECT_FALLBACK_WIDTH = 340
export const PROFILE_EFFECT_FALLBACK_HEIGHT = 440
// Legacy exports retained for older cumulative code/tests. They are no longer
// used as a hard-coded effect canvas.
export const PROFILE_EFFECT_CARD_WIDTH = PROFILE_EFFECT_FALLBACK_WIDTH
export const PROFILE_EFFECT_CARD_HEIGHT = PROFILE_EFFECT_FALLBACK_HEIGHT
export const PROFILE_EFFECT_MIN_HEIGHT = PROFILE_EFFECT_FALLBACK_HEIGHT
export const PROFILE_EFFECT_VIEWPORT_HEIGHT = PROFILE_EFFECT_FALLBACK_HEIGHT

export type ProfileEffectGeometry = {
  width: number
  height: number
  aspectRatio: number
  intrinsic: boolean
}

const FALLBACK_GEOMETRY: ProfileEffectGeometry = {
  width: PROFILE_EFFECT_FALLBACK_WIDTH,
  height: PROFILE_EFFECT_FALLBACK_HEIGHT,
  aspectRatio: PROFILE_EFFECT_FALLBACK_WIDTH / PROFILE_EFFECT_FALLBACK_HEIGHT,
  intrinsic: false,
}

const geometryCache = new Map<string, ProfileEffectGeometry>()

function safeGeometry(width: number, height: number): ProfileEffectGeometry {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return FALLBACK_GEOMETRY
  return { width, height, aspectRatio: width / height, intrinsic: true }
}

export function useProfileEffectGeometry(effect?: string | null): ProfileEffectGeometry {
  const item = getProfileEffect(effect)
  const cacheKey = item?.mediaUrl || ""
  const [geometry, setGeometry] = useState<ProfileEffectGeometry>(() => cacheKey ? geometryCache.get(cacheKey) || FALLBACK_GEOMETRY : FALLBACK_GEOMETRY)

  useEffect(() => {
    if (!item) {
      setGeometry(FALLBACK_GEOMETRY)
      return
    }
    const cached = geometryCache.get(item.mediaUrl)
    if (cached) {
      setGeometry(cached)
      return
    }

    let cancelled = false
    const image = new Image()
    image.referrerPolicy = "no-referrer"
    image.onload = () => {
      if (cancelled) return
      const next = safeGeometry(image.naturalWidth, image.naturalHeight)
      geometryCache.set(item.mediaUrl, next)
      setGeometry(next)
    }
    image.onerror = () => {
      if (!cancelled) setGeometry(FALLBACK_GEOMETRY)
    }
    image.src = item.mediaUrl
    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
    }
  }, [cacheKey, item])

  return geometry
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return reduced
}

export function ProfileEffectLayer({ effect, className }: { effect?: string | null; className?: string }) {
  const item = getProfileEffect(effect)
  const reducedMotion = useReducedMotion()
  if (!item || reducedMotion) return null

  const imageStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    objectPosition: "center",
    pointerEvents: "none",
    userSelect: "none",
  }

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-[22px]", className)}
    >
      {/* The parent card uses this image's real intrinsic ratio, so contain is
          lossless here: no crop, no stretch, no thin-strip letterboxing. */}
      <img
        src={item.mediaUrl}
        alt=""
        draggable={false}
        decoding="async"
        referrerPolicy="no-referrer"
        style={imageStyle}
      />
    </div>
  )
}

export function ProfileEffectThumbnail({ effect, className }: { effect: string; className?: string }) {
  const item = getProfileEffect(effect)
  const geometry = useProfileEffectGeometry(effect)
  if (!item) return null
  return (
    <div
      className={cn("relative w-full overflow-hidden bg-black", className)}
      style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }}
    >
      <img src={item.mediaUrl} alt="" draggable={false} referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-contain" />
    </div>
  )
}

export const EFFECT_IDS = ["none", ...PROFILE_EFFECTS.map((item) => item.id)]

export function ProfileEffect({ effect }: { effect: string }) {
  return <ProfileEffectLayer effect={effect} />
}

export function profileEffectGeometryLabel(geometry: ProfileEffectGeometry) {
  return geometry.intrinsic ? `${geometry.width}×${geometry.height}` : "loading native canvas…"
}
