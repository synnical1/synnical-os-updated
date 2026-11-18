"use client"

export function TemporarilyDisabledPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-start justify-center overflow-y-auto bg-[var(--synnical-bg)] p-5 sm:p-8">
      <section className="w-full max-w-lg rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-5 sm:p-6">
        <h1 className="text-lg font-semibold text-[var(--synnical-text)]">{title} is paused</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--synnical-muted)]">
          We’ve turned Chat off while we improve its safety and moderation tools. We’ll bring it back when those changes are ready.
        </p>
      </section>
    </div>
  )
}
