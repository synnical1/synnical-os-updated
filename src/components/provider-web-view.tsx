"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { type MediaProviderId, type MediaProviderStatus, mediaProviders, providerUrl } from "@/lib/media-providers"

type Props = { provider: MediaProviderId; path?: string; appName: string; onBack?: () => void }

const messages = {
  redirected: "The provider tried to leave its approved domain. Synnical blocked that redirect before it could show an ad or unrelated page.",
  "frame-blocked": "The provider does not currently permit secure embedded playback.",
  unreachable: "The provider could not be reached right now.",
} as const

export function ProviderWebView({ provider, path = "/", appName, onBack }: Props) {
  const [status, setStatus] = useState<MediaProviderStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [revision, setRevision] = useState(0)
  const src = useMemo(() => providerUrl(provider, path), [path, provider])

  useEffect(() => {
    const controller = new AbortController()
    setChecking(true)
    fetch(`/api/media/providers/${provider}`, { credentials: "include", signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Provider check failed")))
      .then((next: MediaProviderStatus) => setStatus(next))
      .catch(() => setStatus({ id: provider, label: mediaProviders[provider].label, available: false, embeddable: false, reason: "unreachable" }))
      .finally(() => setChecking(false))
    return () => controller.abort()
  }, [provider, revision])

  const blocked = status && (!status.available || !status.embeddable || !src)
  return <section className="flex h-full min-h-0 flex-col overflow-hidden bg-black text-white">
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-black/90 px-4 backdrop-blur">
      {onBack ? <button type="button" onClick={onBack} className="rounded-lg p-2 text-white/65 hover:bg-white/10 hover:text-white" aria-label={`Back to ${appName}`}><ArrowLeft className="h-4 w-4" /></button> : null}
      <div className="min-w-0 flex-1"><strong className="block truncate text-sm">{appName}</strong><span className="text-[11px] text-white/45">Authorised provider session</span></div>
      <span className="hidden items-center gap-1.5 text-[11px] text-emerald-200/80 sm:flex"><ShieldCheck className="h-3.5 w-3.5" /> Isolated viewer</span>
      <button type="button" onClick={() => setRevision(value => value + 1)} className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/75 hover:bg-white/10"><RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Retry</button>
    </header>
    <div className="relative min-h-0 flex-1 bg-[#080808]">
      {checking ? <div className="grid h-full place-items-center text-center"><div><Loader2 className="mx-auto h-7 w-7 animate-spin text-white/55" /><p className="mt-3 text-sm text-white/55">Checking the authorised provider…</p></div></div> : null}
      {blocked ? <div role="alert" className="grid h-full place-items-center px-5 text-center"><div className="max-w-md"><AlertTriangle className="mx-auto h-9 w-9 text-amber-200/80" /><h2 className="mt-4 text-lg font-semibold">Provider blocked for safety</h2><p className="mt-2 text-sm leading-6 text-white/55">{messages[status.reason]}</p><p className="mt-4 text-xs text-white/35">No popup or third-party redirect was opened.</p></div></div> : null}
      {!checking && !blocked && src ? <iframe key={`${src}:${revision}`} src={src} title={`${appName} provider viewer`} className="h-full min-h-[420px] w-full border-0 bg-black" sandbox="allow-scripts allow-forms allow-same-origin allow-presentation" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> : null}
    </div>
    <footer className="shrink-0 border-t border-white/10 bg-black px-4 py-2 text-center text-[11px] text-white/40">Synnical blocks provider popups and prevents provider navigation from taking over this window.</footer>
  </section>
}
