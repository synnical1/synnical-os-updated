/** Shared client/server media limits. Keep UI preflight aligned with the API. */
export const GIF_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export const GIF_UPLOAD_MAX_LABEL = "GIFs must be 10 MB or smaller."

export function isGifUpload(file: Pick<File, "type" | "name">): boolean {
  return file.type.toLowerCase() === "image/gif" || /\.gif$/i.test(file.name || "")
}

export function gifUploadError(file: Pick<File, "type" | "name" | "size">): string | null {
  return isGifUpload(file) && file.size > GIF_UPLOAD_MAX_BYTES ? GIF_UPLOAD_MAX_LABEL : null
}
