/** Keep wallpaper videos playing whenever the Synnical surface is visible. */
export function syncWallpaperPlayback(video: Pick<HTMLVideoElement, "play" | "pause">, state: {
  hidden: boolean
}) {
  if (state.hidden) video.pause()
  else void video.play().catch(() => {})
}
