"use client"

import { useState, useRef, useEffect } from "react"
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from "react-image-crop"
import "react-image-crop/dist/ReactCrop.css"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, Crop as CropIcon } from "lucide-react"

/**
 * `makeAspectCrop` and `centerCrop` both need the media dimensions. Calling
 * them with only the crop + aspect (as before) is a type error and produces a
 * crop box that ignores the image's real size.
 *
 * Percentage units make the result resolution-independent, so passing a 1:1
 * reference box is safe and correct here.
 */
function defaultCrop(aspect: number, width = 100, height = 100): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: aspect >= 1 ? 90 : 50 }, aspect, width, height),
    width,
    height
  )
}

export function ImageCropper({
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
    }
  }, [open, aspect])

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setImgEl(e.currentTarget)
  }

  const produceBlob = async (): Promise<Blob | null> => {
    if (!imgEl || !completed) return null
    const canvas = document.createElement("canvas")
    const scaleX = imgEl.naturalWidth / imgEl.width
    const scaleY = imgEl.naturalHeight / imgEl.height
    canvas.width = completed.width * scaleX
    canvas.height = completed.height * scaleY
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    if (circular) {
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2, 0, 2 * Math.PI)
      ctx.closePath()
      ctx.clip()
    }

    ctx.drawImage(
      imgEl,
      completed.x * scaleX,
      completed.y * scaleY,
      completed.width * scaleX,
      completed.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height
    )

    return new Promise((resolve) => {
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CropIcon className="h-4 w-4 text-white" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-md bg-[#070707] flex items-center justify-center p-2">
          {src && (
            <ReactCrop
              crop={crop}
              onChange={(c) => setCrop(c)}
              onComplete={(c) => setCompleted(c)}
              aspect={aspect}
              circularCrop={circular}
              keepSelection
            >
              <img src={src} alt="To crop" onLoad={onImageLoad} style={{ maxHeight: "50vh" }} />
            </ReactCrop>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !completed} className="bg-white hover:bg-[#e8e8e8] text-white">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crop & Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
