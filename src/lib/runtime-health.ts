type ProviderObservation = { ok: boolean; status: number | null; model?: string; message?: string; at: number }
type HealthState = {
  socketClients: number
  onlineMembers: number
  providers: Record<string, ProviderObservation>
}

declare global {
  var __synnicalRuntimeHealth: HealthState | undefined
}

function state(): HealthState {
  if (!globalThis.__synnicalRuntimeHealth) globalThis.__synnicalRuntimeHealth = { socketClients: 0, onlineMembers: 0, providers: {} }
  const current = globalThis.__synnicalRuntimeHealth
  if (typeof current.onlineMembers !== "number") current.onlineMembers = 0
  return current
}

export function setSocketClientCount(count: number) {
  state().socketClients = Math.max(0, Math.floor(Number(count) || 0))
}

export function setOnlineMemberCount(count: number) {
  state().onlineMembers = Math.max(0, Math.floor(Number(count) || 0))
}

export function countUniqueOnlineMembers(users: Iterable<{ userId: string }>): number {
  const ids = new Set<string>()
  for (const user of users) {
    const userId = user.userId.trim()
    if (userId) ids.add(userId)
  }
  return ids.size
}

export function observeProvider(name: string, observation: Omit<ProviderObservation, "at">) {
  state().providers[name] = { ...observation, at: Date.now() }
}

export function runtimeHealthSnapshot() {
  const current = state()
  return { socketClients: current.socketClients, onlineMembers: current.onlineMembers, providers: { ...current.providers } }
}
