const MIN_ONLINE = 61
const MAX_ONLINE = 784
const SEGMENT_MINUTES = 120

// Deterministic anchors make every visitor see the same community figure
// during a given minute, while the two-hour interpolation keeps changes small.
function anchorValue(segment: number): number {
  const raw = Math.sin(segment * 12.9898 + 78.233) * 43_758.5453
  const fraction = raw - Math.floor(raw)
  return MIN_ONLINE + Math.round(fraction * (MAX_ONLINE - MIN_ONLINE))
}

export function getSimulatedOnlineCount(epochMinute = Math.floor(Date.now() / 60_000)): number {
  const minute = Number.isFinite(epochMinute) ? Math.trunc(epochMinute) : Math.floor(Date.now() / 60_000)
  const segment = Math.floor(minute / SEGMENT_MINUTES)
  const offset = minute - segment * SEGMENT_MINUTES
  const start = anchorValue(segment)
  const end = anchorValue(segment + 1)
  const progress = offset / SEGMENT_MINUTES
  return Math.round(start + (end - start) * progress)
}
