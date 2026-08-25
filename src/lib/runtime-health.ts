type ProviderObservation = { ok: boolean; status: number | null; model?: string; message?: string; at: number }
type HealthState = {
  socketClients: number
  providers: Record<string, ProviderObservation>
}

declare global {
  // eslint-disable-next-line no-var
  var __synnicalRuntimeHealth: HealthState | undefined
}

function state(): HealthState {
  if (!globalThis.__synnicalRuntimeHealth) globalThis.__synnicalRuntimeHealth = { socketClients: 0, providers: {} }
  return globalThis.__synnicalRuntimeHealth
}

export function setSocketClientCount(count: number) {
  state().socketClients = Math.max(0, Math.floor(Number(count) || 0))
}

export function observeProvider(name: string, observation: Omit<ProviderObservation, "at">) {
  state().providers[name] = { ...observation, at: Date.now() }
}

export function runtimeHealthSnapshot() {
  const current = state()
  return { socketClients: current.socketClients, providers: { ...current.providers } }
}
