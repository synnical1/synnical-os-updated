"use client"

import { useEffect, useState } from "react"
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from "react-image-crop"
import "react-image-crop/dist/ReactCrop.css"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Crop as CropIcon, Loader2, ZoomIn } from "lucide-react"

function defaultCrop(aspect: number, width = 100, height = 100): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: aspect >= 1 ? 90 : 50 }, aspect, width, height),
    width,
    height,
  )
}

function isGif(file: File | null | undefined) {
  return Boolean(file && (file.type.toLowerCase() === "image/gif" || /\.gif$/i.test(file.name)))
}

export function ImageCropperV2({
  open,
  src,
  sourceFile = null,
  cropMode = "pfp",
  aspect,
  circular,
  title,
  onConfirm,
  onCancel,
}: {
  open: boolean
  src: string | null
  sourceFile?: File | null
  cropMode?: "pfp" | "banner"
  aspect: number
  circular?: boolean
  title: string
  onConfirm: (blob: Blob) => void
  onCancel: () => void
}) {
  const [crop, setCrop] = useState<Crop>(() => defaultCrop(aspect))
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setCrop(defaultCrop(aspect))
    setImgEl(null)
    setBusy(false)
    setZoom(1)
    setError("")
  }, [open, aspect, src])

  const normalizedCrop = () => {
    if (!crop.width || !crop.height) return null
    if (crop.unit === "%") {
      return { x: crop.x / 100, y: crop.y / 100, width: crop.width / 100, height: crop.height / 100 }
    }
    if (!imgEl?.width || !imgEl.height) return null
    return { x: crop.x / imgEl.width, y: crop.y / imgEl.height, width: crop.width / imgEl.width, height: crop.height / imgEl.height }
  }

  const produceStaticBlob = async (): Promise<Blob | null> => {
    if (!imgEl) return null
    const normalized = normalizedCrop()
    if (!normalized) return null

    const left = Math.max(0, Math.round(normalized.x * imgEl.naturalWidth))
    const top = Math.max(0, Math.round(normalized.y * imgEl.naturalHeight))
    const width = Math.max(1, Math.min(imgEl.naturalWidth - left, Math.round(normalized.width * imgEl.naturalWidth)))
    const height = Math.max(1, Math.min(imgEl.naturalHeight - top, Math.round(normalized.height * imgEl.naturalHeight)))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    if (circular) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2)
      ctx.clip()
    }
    ctx.drawImage(imgEl, left, top, width, height, 0, 0, width, height)
    if (circular) ctx.restore()

    return new Promise((resolve) => canvas.toBlob(resolve, "image/png", .92))
  }

  const produceAnimatedGif = async (): Promise<Blob> => {
    if (!sourceFile) throw new Error("The original GIF is unavailable.")
    const normalized = normalizedCrop()
    if (!normalized) throw new Error("Choose a crop area first.")
    const form = new FormData()
    form.append("file", sourceFile, sourceFile.name || "animation.gif")
    form.append("type", cropMode)
    form.append("crop", JSON.stringify(normalized))
    const response = await fetch("/api/profile/crop-gif", { method: "POST", body: form, credentials: "include" })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(typeof body?.error === "string" ? body.error : "GIF crop failed")
    }
    const blob = await response.blob()
    if (blob.type !== "image/gif") throw new Error("The cropped animation was not returned as a GIF.")
    return blob
  }

  const confirm = async () => {
    setBusy(true)
    setError("")
    try {
      const blob = isGif(sourceFile) ? await produceAnimatedGif() : await produceStaticBlob()
      if (!blob) throw new Error("Could not crop this image.")
      onConfirm(blob)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not crop this image.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent className="max-w-2xl border-[var(--synnical-glass-border)] bg-[var(--synnical-glass-strong)] text-[var(--synnical-text)] shadow-[var(--synnical-shadow)] backdrop-blur-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CropIcon className="h-4 w-4 text-[var(--synnical-accent)]" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[58vh] overflow-auto rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-2">
          {src ? (
            <ReactCrop
              crop={crop}
              onChange={(_pixels, percent) => setCrop(percent)}
              onComplete={(_pixels, percent) => setCrop(percent)}
              aspect={aspect}
              circularCrop={circular}
              keepSelection
            >
              <img
                src={src}
                alt="To crop"
                onLoad={(event) => setImgEl(event.currentTarget)}
                style={{
                  display: "block",
                  height: "auto",
                  maxHeight: zoom === 1 ? "50vh" : "none",
                  maxWidth: zoom === 1 ? "100%" : "none",
                  width: zoom > 1 ? `${Math.round(zoom * 100)}%` : "auto",
                }}
              />
            </ReactCrop>
          ) : (
            <div className="grid h-40 place-items-center text-sm text-[var(--synnical-muted)]">No image</div>
          )}
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface)] px-3 py-2">
          <ZoomIn className="h-4 w-4 shrink-0 text-[var(--synnical-muted)]" />
          <input
            aria-label="Crop zoom"
            type="range"
            min="1"
            max="2.5"
            step=".05"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="min-w-0 flex-1 accent-[var(--synnical-accent)]"
          />
          <span className="w-12 text-right text-xs text-[var(--synnical-muted)]">{Math.round(zoom * 100)}%</span>
        </div>

        {isGif(sourceFile) ? <p className="text-xs text-[var(--synnical-muted)]">Animated preview stays live. Crop and zoom are applied to every frame on save.</p> : null}
        {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={confirm} disabled={busy || !crop.width || !crop.height}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Crop &amp; Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ImageCropperV2
