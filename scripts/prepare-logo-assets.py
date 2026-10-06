"""Deterministically separate the supplied artwork; no generated/replaced geometry.

Run with Pillow + numpy installed. The minimum RGB component is neutral light;
the remaining blue/cyan energy becomes the accent mask. Black is transparent.
The source hash and crop coordinates are documented in docs/brand-games-upgrade.md.
"""
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1] / "public/brand/synnical"
source = Image.open(root / "synnical-logo-source.png").convert("RGB")

def layers(name, box, width):
    img = source.crop(box)
    img.thumbnail((width, width), Image.Resampling.LANCZOS)
    rgb = np.asarray(img, dtype=np.float32)
    neutral = rgb.min(axis=2)
    colored = rgb - neutral[:, :, None]
    # Cyan is bright and blue is deeper in the original. Preserve that
    # luminance difference instead of flattening all saturated pixels.
    accent = np.clip((colored * np.array([0.2126, 0.7152, 0.0722])).sum(axis=2) / 0.7874, 0, 255)
    # Suppress the nearly-black compression noise outside the actual artwork.
    neutral = np.where(neutral > 4, neutral, 0)
    accent = np.where(accent > 4, accent, 0)
    base = np.full((*neutral.shape, 4), 255, dtype=np.uint8)
    base[:, :, 3] = neutral.astype(np.uint8)
    mask = np.full((*accent.shape, 4), 255, dtype=np.uint8)
    mask[:, :, 3] = accent.astype(np.uint8)
    Image.fromarray(base).save(root / f"synnical-{name}-base.webp", lossless=True)
    Image.fromarray(mask).save(root / f"synnical-{name}-accent-mask.png", optimize=True)
    # A static icon for installed-app manifests, never the browser-tab favicon.
    if name == "mark":
        rgba = np.dstack((rgb.astype(np.uint8), np.maximum(neutral, accent).astype(np.uint8)))
        mark = Image.fromarray(rgba)
        icon = Image.new("RGBA", (192, 192))
        icon.alpha_composite(mark, ((192 - mark.width) // 2, (192 - mark.height) // 2))
        icon.save(root / "synnical-mark.png", optimize=True)

layers("logo", (350, 245, 1065, 915), 768)
layers("mark", (440, 255, 975, 755), 192)
layers("mark-small", (440, 255, 975, 755), 64)
