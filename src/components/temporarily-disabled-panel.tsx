"use client"

import { ShieldCheck } from "lucide-react"

export function TemporarilyDisabledPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center overflow-y-auto bg-[var(--synnical-bg)] p-6">
      <section className="w-full max-w-xl rounded-2xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-7 text-center shadow-xl sm:p-10">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] text-amber-300">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--synnical-muted)]">Temporary service restriction</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-[var(--synnical-text)]">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--synnical-muted)]">
          This service has been temporarily suspended while we review and strengthen Synnical’s safety, safeguarding and moderation measures.
        </p>
        <p className="mx-auto mt-3 max-w-md text-xs leading-5 text-[var(--synnical-muted)]/75">
          Access will be restored only once the necessary protections are in place and the service can operate safely.
        </p>
      </section>
    </div>
  )
}
