"use client"

import { MediaCatalogPanel } from "@/components/media-catalog-panel"

export function SynnimePanel({ onNavigate }: { onNavigate?: (panel: "movies" | "synnime") => void }) {
  return <MediaCatalogPanel mode="anime" onNavigate={onNavigate} />
}
