type ProviderObservation = { ok: boolean; status: number | null; model?: string; message?: string; at: number }
type HealthState = {
  socketClients: number
  onlineUsers: number
  providers: Record<string, ProviderObservation>
}

declare global {
  var __synnicalRuntimeHealth: HealthState | undefined
}

function state(): HealthState {
  if (!globalThis.__synnicalRuntimeHealth) {
    globalThis.__synnicalRuntimeHealth = { socketClients: 0, onlineUsers: 0, providers: {} }
  } else if (!Number.isFinite(globalThis.__synnicalRuntimeHealth.onlineUsers)) {
    // Keep hot-reloaded development servers compatible with the previous state shape.
    globalThis.__synnicalRuntimeHealth.onlineUsers = 0
  }
  return globalThis.__synnicalRuntimeHealth
}

export function setSocketClientCount(count: number) {
  state().socketClients = Math.max(0, Math.floor(Number(count) || 0))
}

export function countUniqueOnlineUsers(users: Iterable<{ userId?: unknown }>): number {
  const userIds = new Set<string>()
  for (const user of users) {
    if (typeof user?.userId === "string" && user.userId.trim()) userIds.add(user.userId)
  }
  return userIds.size
}

export function setOnlineUserCount(count: number) {
  state().onlineUsers = Math.max(0, Math.floor(Number(count) || 0))
}

export function observeProvider(name: string, observation: Omit<ProviderObservation, "at">) {
  state().providers[name] = { ...observation, at: Date.now() }
}

export function runtimeHealthSnapshot() {
  const current = state()
  return {
    socketClients: current.socketClients,
    onlineUsers: current.onlineUsers,
    providers: { ...current.providers },
  }
}
