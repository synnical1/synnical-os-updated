"use client"

import { MediaCatalogPanel } from "@/components/media-catalog-panel"

export function SynnFlixUnavailablePanel({ onNavigate }: { onNavigate?: (panel: "movies" | "synnime") => void }) {
  return <MediaCatalogPanel mode="movies" onNavigate={onNavigate} />
}
