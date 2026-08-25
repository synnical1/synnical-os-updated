"use client"

import { useState, useEffect } from "react"
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop"
import "react-image-crop/dist/ReactCrop.css"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Loader2,
  Crop as CropIcon,
} from "lucide-react"

/**
 * Simple, reliable image cropper.
 *
 * Previous version had zoom/rotate controls that applied CSS transforms to
 * the <img> inside ReactCrop. ReactCrop measures mouse coordinates against
 * the image's layout box — CSS transforms move the visual image away from
 * that box, so the crop handles and dragging were completely misaligned.
 *
 * This version is intentionally simple: just drag to crop. No transforms,
 * no overflow:hidden clipping the handles. It just works.
 */
function defaultCrop(aspect: number, width = 100, height = 100): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: aspect >= 1 ? 90 : 50 }, aspect, width, height),
    width,
    height
  )
}

export function ImageCropperV2({
  open,
  src,
  aspect,
  circular,
  title,
  onConfirm,
  onCancel,
}: {
  open: boolean
  src: string | null
  aspect: number
  circular?: boolean
  title: string
  onConfirm: (blob: Blob) => void
  onCancel: () => void
}) {
  const [crop, setCrop] = useState<Crop>(() => defaultCrop(aspect))
  const [completed, setCompleted] = useState<PixelCrop | null>(null)
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setCrop(defaultCrop(aspect))
      setCompleted(null)
      setImgEl(null)
    }
  }, [open, aspect])

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setImgEl(img)
    // Set initial completed crop from the percentage-based crop
    // so the "Crop & Save" button works without needing to drag first
    if (crop && img.width && img.height) {
      setCompleted({
        unit: "px",
        x: (crop.x / 100) * img.width,
        y: (crop.y / 100) * img.height,
        width: (crop.width / 100) * img.width,
        height: (crop.height / 100) * img.height,
      })
    }
  }

  /**
   * Produce the cropped PNG blob.
   * No zoom/rotate — just a straight pixel crop from the canvas.
   */
  const produceBlob = async (): Promise<Blob | null> => {
    if (!imgEl || !completed) return null
    const img = imgEl
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    const dw = img.width
    const dh = img.height
    if (!nw || !nh || !dw || !dh) return null

    const sx = nw / dw // display → natural scale
    const sy = nh / dh

    const cx = completed.x
    const cy = completed.y
    const cw = completed.width
    const ch = completed.height

    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(cw * sx))
    canvas.height = Math.max(1, Math.round(ch * sy))
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"

    // Optional circular clip (for pfp)
    if (circular) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(
        canvas.width / 2,
        canvas.height / 2,
        Math.min(canvas.width, canvas.height) / 2,
        0,
        2 * Math.PI
      )
      ctx.closePath()
      ctx.clip()
    }

    // Draw just the crop region from the natural image
    ctx.drawImage(
      img,
      cx * sx, cy * sy,    // source x, y (natural px)
      cw * sx, ch * sy,    // source w, h (natural px)
      0, 0,                // dest x, y
      canvas.width,        // dest w
      canvas.height        // dest h
    )

    if (circular) ctx.restore()

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png", 0.92)
    })
  }

  const confirm = async () => {
    setBusy(true)
    try {
      const blob = await produceBlob()
      if (blob) onConfirm(blob)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        className="max-w-xl border-zinc-800/60"
        style={{ backgroundColor: "#0a0a0f" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <CropIcon className="h-4 w-4 text-white" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {/* Crop area — no overflow:hidden so drag handles aren't clipped */}
        <div
          className="rounded-md flex items-center justify-center p-2"
          style={{ backgroundColor: "#0a0a0f" }}
        >
          {src ? (
            <ReactCrop
              crop={crop}
              onChange={(c) => setCrop(c)}
              onComplete={(c) => setCompleted(c)}
              aspect={aspect}
              circularCrop={circular}
              keepSelection
            >
              <img
                src={src}
                alt="To crop"
                onLoad={onImageLoad}
                style={{ maxHeight: "50vh" }}
              />
            </ReactCrop>
          ) : (
            <div className="h-40 flex items-center justify-center text-zinc-500 text-sm">
              No image
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            className="text-zinc-300 hover:text-zinc-100"
          >
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={busy || !completed}
            className="bg-white hover:bg-[#e8e8e8] text-white"
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crop &amp; Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ImageCropperV2
