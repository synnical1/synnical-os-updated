const VM_URL = process.env.NEXT_PUBLIC_SYNN_VM_URL?.trim() || ""

export default function LinuxVmPage() {
  return (
    <main className="flex h-dvh w-dvw overflow-hidden bg-black text-white">
      {VM_URL ? (
        <iframe
          src={VM_URL}
          title="Synn VM"
          className="h-full w-full border-0 bg-black"
          allow="clipboard-read; clipboard-write; fullscreen; gamepad; microphone; camera"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <section className="flex h-full w-full items-center justify-center p-6">
          <div className="max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">Synn VM</p>
            <h1 className="mt-2 text-2xl font-semibold">VM launcher is not configured</h1>
            <p className="mt-3 text-sm leading-6 text-white/55">
              The panel is wired, but the actual VM endpoint is not present in this build.
              Set `NEXT_PUBLIC_SYNN_VM_URL` to a live desktop or VM URL and the panel will load it here.
            </p>
          </div>
        </section>
      )}
    </main>
  )
}
