"use client"

import { Construction, Sparkles } from "lucide-react"

export function UnderConstructionPanel({ appName, eyebrow, description }: { appName: string; eyebrow: string; description: string }) {
  return (
    <section className="synnical-under-construction flex h-full min-h-0 items-center justify-center overflow-y-auto px-5 py-10 text-center">
      <div className="w-full max-w-xl rounded-[2rem] border p-8 shadow-2xl sm:p-12">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl"><Construction className="h-7 w-7" aria-hidden="true" /></span>
        <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.24em]">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">{appName} is under construction</h1>
        <p className="mx-auto mt-5 max-w-md text-sm leading-6">{description}</p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />We’ll open this when a reliable provider is ready.</div>
      </div>
    </section>
  )
}
