/** Legacy website providers are retired. Kept as a deny-only compatibility boundary. */
export const mediaProviders = {} as const
export type MediaProviderId = string
export type MediaProviderStatus = { id: string; label: string; available: false; embeddable: false; reason: "retired" }
export function isMediaProviderId(_value: string): boolean { return false }
export function providerUrl(_id: string, _path = "/"): null { return null }
export function mediaProviderStatus(id: string, _response?: unknown): MediaProviderStatus { return { id, label: "Retired provider", available: false, embeddable: false, reason: "retired" } }
