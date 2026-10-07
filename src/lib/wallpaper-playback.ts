/** Automatic performance hints must never silently disable the wallpaper. */
export function syncWallpaperPlayback(video: Pick<HTMLVideoElement, "play" | "pause">, state: {
  reduceMotion: boolean; hidden: boolean; userPaused: boolean
}) {
  if (state.reduceMotion || state.hidden || state.userPaused) video.pause()
  else void video.play().catch(() => {})
}
