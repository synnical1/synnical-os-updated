const MIN_ONLINE = 61
const MAX_ONLINE = 784
const SEGMENT_MINUTES = 120

function anchorValue(segment: number): number {
  const raw = Math.sin(segment * 12.9898 + 78.233) * 43_758.5453
  const fraction = raw - Math.floor(raw)
  return MIN_ONLINE + Math.floor(fraction * (MAX_ONLINE - MIN_ONLINE + 1))
}

/**
 * Returns a deliberately simulated count shared by all clients for a given
 * UTC epoch minute. Two-hour deterministic anchors and linear interpolation
 * keep minute-to-minute movement small and make refreshes stable.
 */
export function getSimulatedOnlineCount(epochMinute: number): number {
  const minute = Math.floor(Number.isFinite(epochMinute) ? epochMinute : 0)
  const segment = Math.floor(minute / SEGMENT_MINUTES)
  const progress = (minute - segment * SEGMENT_MINUTES) / SEGMENT_MINUTES
  const start = anchorValue(segment)
  const end = anchorValue(segment + 1)
  return Math.max(MIN_ONLINE, Math.min(MAX_ONLINE, Math.round(start + (end - start) * progress)))
}
