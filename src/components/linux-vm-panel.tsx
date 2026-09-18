"use client"

import { Monitor, Sparkles } from "lucide-react"

export function LinuxVmPanel() {
  return (
    <section className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-[var(--synnical-bg)] p-6 text-[var(--synnical-text)]">
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-8 text-center shadow-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,.16),transparent_52%)]" />
        <div className="relative">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-sky-400/30 bg-sky-400/10">
            <Monitor className="h-8 w-8 text-sky-300" />
          </div>
          <p className="mt-6 text-[10px] font-semibold uppercase tracking-[.28em] text-[var(--synnical-muted)]">Synn VM</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Coming Soon</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--synnical-muted)]">
            Synn VM is being prepared as a native Synnical app. The unfinished virtual-machine runtime is intentionally disabled in this build.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] px-4 py-2 text-xs text-[var(--synnical-muted)]">
            <Sparkles className="h-3.5 w-3.5 text-sky-300" />
            No setup required yet
          </div>
        </div>
      </div>
    </section>
  )
}
