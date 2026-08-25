// Type declarations for Scramjet service worker globals.
// These are only used in SW context files — the main app doesn't need them.

interface FetchEvent extends Event {
  request: Request
  clientId: string
  resultingClientId: string
  respondWith(response: Promise<Response> | Response): void
}

interface ServiceWorkerGlobalScope extends WorkerGlobalScope {
  clients: Clients
  registration: ServiceWorkerRegistration
  skipWaiting(): Promise<void>
  addEventListener(type: "fetch", listener: (ev: FetchEvent) => void): void
  addEventListener(type: "install" | "activate", listener: (ev: ExtendableEvent) => void): void
  addEventListener(type: "message", listener: (ev: ExtendableMessageEvent) => void): void
}

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<any>): void
}

interface ExtendableMessageEvent extends MessageEvent {
  source: Client | ServiceWorker | MessagePort | null
}
