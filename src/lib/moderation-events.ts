import { EventEmitter } from "node:events"
const shared = globalThis as typeof globalThis & { synnicalModerationEvents?: EventEmitter }
export const moderationEvents = shared.synnicalModerationEvents ||= new EventEmitter()
export function publishModeration(userId: string, action: string) { moderationEvents.emit("change", { userId, action }) }
