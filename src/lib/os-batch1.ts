export type TaskbarSize = "small" | "medium" | "large"
export type NotificationPriority = "normal" | "priority" | "urgent"

export const TASKBAR_METRICS: Record<TaskbarSize, { height: number; button: number; icon: number }> = {
  small: { height: 40, button: 32, icon: 16 },
  medium: { height: 48, button: 36, icon: 18 },
  large: { height: 58, button: 44, icon: 21 },
}

export function rectanglesTouch(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  tolerance = 3,
): boolean {
  const aRight = a.x + a.width, bRight = b.x + b.width
  const aBottom = a.y + a.height, bBottom = b.y + b.height
  const verticalOverlap = Math.min(aBottom, bBottom) - Math.max(a.y, b.y) > Math.min(a.height, b.height) * 0.45
  const horizontalOverlap = Math.min(aRight, bRight) - Math.max(a.x, b.x) > Math.min(a.width, b.width) * 0.45
  const sideTouch = verticalOverlap && (Math.abs(aRight - b.x) <= tolerance || Math.abs(bRight - a.x) <= tolerance)
  const topTouch = horizontalOverlap && (Math.abs(aBottom - b.y) <= tolerance || Math.abs(bBottom - a.y) <= tolerance)
  return sideTouch || topTouch
}

export function findSnapPeers<T extends { id: string; workspace: number; minimized: boolean; x: number; y: number; width: number; height: number; snapGroup?: string | null }>(
  windows: T[],
  targetId: string,
  workspace: number,
  rect: { x: number; y: number; width: number; height: number },
): T[] {
  return windows.filter((win) => win.id !== targetId && win.workspace === workspace && !win.minimized && rectanglesTouch(win, rect))
}

export function safeTimeZoneLabel(zone: string, date: Date): string | null {
  try {
    return new Intl.DateTimeFormat([], { timeZone: zone, hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(date)
  } catch { return null }
}

export function notificationAllowed(
  focus: "off" | "priority" | "alarms",
  enabled: boolean,
  priority: NotificationPriority,
): boolean {
  if (!enabled) return false
  if (focus === "off") return true
  if (focus === "priority") return priority === "priority" || priority === "urgent"
  return priority === "urgent"
}
