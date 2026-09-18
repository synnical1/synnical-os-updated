"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Minus, Plus, RotateCcw, X } from "lucide-react"
export function ImageViewer() {
  const [source, setSource] = useState<string | null>(null)
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const previousFocus = useRef<HTMLElement | null>(null)
  const zoom = useCallback((factor: number) => setTransform(value => ({ ...value, scale: Math.min(8, Math.max(1, value.scale * factor)), ...(value.scale * factor <= 1 ? { x: 0, y: 0 } : {}) })), [])
  useEffect(() => {
    const open = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-image-viewer]") : null
      const src = target?.getAttribute("data-image-viewer")
      if (!src) return
      if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      previousFocus.current = document.activeElement as HTMLElement
      setTransform({ scale: 1, x: 0, y: 0 }); setSource(src)
    }
    document.addEventListener("click", open)
    document.addEventListener("keydown", open)
    return () => { document.removeEventListener("click", open); document.removeEventListener("keydown", open) }
  }, [])
  useEffect(() => {
    const element = viewport
    if (!element) return
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1/1.1) }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [viewport, zoom])
  return <Dialog.Root open={Boolean(source)} onOpenChange={open => { if (!open) { setSource(null); pointers.current.clear() } }}><Dialog.Portal><Dialog.Overlay style={{ background: "rgba(0,0,0,.92)" }} className="fixed inset-0 z-[100000]" /><Dialog.Content aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); previousFocus.current?.focus() }} style={{ color: "white" }} className="fixed inset-0 z-[100001] flex flex-col outline-none text-white"><Dialog.Title className="sr-only">Image viewer</Dialog.Title><div style={{ background: "rgba(0,0,0,.5)" }} className="flex shrink-0 items-center justify-end gap-3 p-3"><button aria-label="Zoom out" onClick={() => zoom(1/1.25)} disabled={transform.scale <= 1}><Minus /></button><span className="min-w-16 text-center" aria-live="polite">{Math.round(transform.scale*100)}%</span><button aria-label="Zoom in" onClick={() => zoom(1.25)} disabled={transform.scale >= 8}><Plus /></button><button aria-label="Reset zoom" onClick={() => setTransform({ scale: 1, x: 0, y: 0 })}><RotateCcw /></button><Dialog.Close aria-label="Close image viewer"><X /></Dialog.Close></div><div className="flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden" ref={setViewport} onDoubleClick={() => setTransform({ scale: 1, x: 0, y: 0 })} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }) }} onPointerUp={event => pointers.current.delete(event.pointerId)} onPointerCancel={event => pointers.current.delete(event.pointerId)} onPointerMove={event => {
    const old = pointers.current.get(event.pointerId); if (!old) return
    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
    const next = { x: event.clientX, y: event.clientY }
    if (other) { const before = Math.hypot(old.x-other.x, old.y-other.y); if (before > 0) zoom(Math.hypot(next.x-other.x,next.y-other.y)/before) }
    else setTransform(value => value.scale > 1 ? { ...value, x: value.x+next.x-old.x, y: value.y+next.y-old.y } : value)
    pointers.current.set(event.pointerId,next)
  }}>{source && <img draggable={false} src={source} alt="Full-size uploaded image" className="max-h-full max-w-full select-none object-contain" style={{ transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`, cursor: transform.scale > 1 ? "grab" : "zoom-in" }} />}</div></Dialog.Content></Dialog.Portal></Dialog.Root>
}
