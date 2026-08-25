"use client"

export function LinuxVmPanel() {
  return (
    <div className="relative h-full w-full min-h-0 min-w-0 overflow-hidden bg-black">
      <iframe
        src="/linux-vm/"
        title="Synn VM"
        className="absolute inset-0 h-full w-full border-0 bg-black"
        allow="clipboard-read; clipboard-write; fullscreen; gamepad; microphone; camera"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        scrolling="no"
      />
    </div>
  )
}
