import { Monitor } from "lucide-react"

export default function LinuxVmPage() {
  return (
    <main className="grid h-dvh w-dvw place-items-center overflow-hidden bg-[#090b0f] p-6 text-white">
      <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-sky-400/25 bg-sky-400/10">
          <Monitor className="h-8 w-8 text-sky-300" />
        </div>
        <p className="mt-6 text-[10px] font-semibold uppercase tracking-[.28em] text-white/40">Synn VM</p>
        <h1 className="mt-2 text-3xl font-semibold">Coming Soon</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/50">
          The Synn VM runtime is intentionally unavailable until the production integration is ready.
        </p>
      </section>
    </main>
  )
}
