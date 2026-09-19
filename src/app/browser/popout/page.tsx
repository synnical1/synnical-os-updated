"use client"

import { useEffect, useState } from "react"
import { BrowserPanel } from "@/components/browser-panel"
import { Loader2 } from "lucide-react"

function safeInitialUrl(raw: string | null) {
  if (!raw) return ""
  try {
    const url = new URL(raw)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : ""
  } catch {
    return ""
  }
}

export default function BrowserPopoutPage() {
  const [initialUrl, setInitialUrl] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setInitialUrl(safeInitialUrl(params.get("url")))
  }, [])

  if (initialUrl === null) {
    return <main className="grid min-h-screen place-items-center bg-[var(--synnical-bg)] text-[var(--synnical-text)]"><Loader2 className="h-6 w-6 animate-spin text-[var(--synnical-accent)]" /></main>
  }

  if (!initialUrl) {
    return <main className="grid min-h-screen place-items-center bg-[var(--synnical-bg)] px-6 text-center text-sm text-[var(--synnical-muted)]">That Browser pop-out URL is invalid.</main>
  }

  return <main className="h-screen min-h-0 overflow-hidden bg-[var(--synnical-bg)]"><BrowserPanel initialUrl={initialUrl} /></main>
}
