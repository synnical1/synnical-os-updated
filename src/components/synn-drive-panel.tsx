"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Cloud, ExternalLink, FlaskConical, HardDrive } from "lucide-react"

const providers = [
  { id: "terabox", name: "TeraBox", storage: "Experimental", state: "Testing", note: "Cloud connector test." },
  { id: "local", name: "Synn Drive", storage: "Experimental", state: "Preview", note: "Files app preview." },
]

export function SynnDrivePanel() {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    try { setConnected(window.localStorage.getItem("synn-drive.terabox.connected") === "true") } catch {}
  }, [])

  const markConnected = () => {
    try { window.localStorage.setItem("synn-drive.terabox.connected", "true") } catch {}
    setConnected(true)
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#090a0d] text-white">
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-[1.25fr_.75fr]">
        <section className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-sky-400/12">
              <HardDrive className="h-5 w-5 text-sky-200" />
            </span>
            <div>
              <h1 className="text-xl font-semibold">Synn Drive</h1>
              <p className="text-sm text-white/45">Experimental storage preview.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-black/25 p-3">
              <FlaskConical className="mb-2 h-4 w-4 text-emerald-200" />
              <div className="text-xs text-white/35">Status</div>
              <div className="mt-1 text-sm font-medium">Experimental</div>
            </div>
            <div className="rounded-md bg-black/25 p-3">
              <Cloud className="mb-2 h-4 w-4 text-sky-200" />
              <div className="text-xs text-white/35">Connector</div>
              <div className="mt-1 text-sm font-medium">TeraBox</div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {providers.map((provider) => (
              <div key={provider.name} className={`grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-[1fr_120px_100px] ${provider.id === "terabox" ? "border-sky-300/30 bg-sky-300/8" : "border-white/10 bg-black/20"}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <Cloud className="h-4 w-4 text-white/45" />
                    {provider.name}
                    {provider.id === "terabox" && connected ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-white/45">{provider.note}</p>
                </div>
                <div className="text-white/60">{provider.storage}</div>
                <div className={provider.id === "terabox" ? "text-sky-200" : "text-emerald-200"}>{provider.id === "terabox" && connected ? "Connected" : provider.state}</div>
              </div>
            ))}
          </div>
        </section>

        <aside className="rounded-md border border-white/10 bg-[#101217] p-4">
          <div className="mb-3 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-sky-200" />
            <h2 className="text-sm font-semibold">Experimental</h2>
          </div>
          <p className="text-sm leading-6 text-white/55">Synn Drive cloud sync is being tested. Nothing here is required for the OS to run.</p>
          <div className="mt-4 grid gap-2">
            <a
              href="https://www.terabox.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-black hover:bg-sky-100"
            >
              <ExternalLink className="h-4 w-4" />
              Open TeraBox
            </a>
            <button
              type="button"
              onClick={markConnected}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white hover:bg-white/[0.08]"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark TeraBox Connected
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
