import { Socket, createConnection, isIP } from "node:net";
const ALLOWED_DOMAINS = ["roblox.com", "rbxcdn.com", "robloxlabs.com"] as const;
const MAX_PENDING_CHUNKS = 128;

export function isAllowedRobloxProxyTarget(hostname: string, port: number): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (port !== 443 || isIP(host) !== 0) return false;
  return ALLOWED_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

class ByteQueue {
  private values: Buffer[] = [];
  private readers: Array<(value: Buffer | null) => void> = [];
  private closed = false;
  push(value: Buffer): boolean {
    if (this.closed) return false;
    const reader = this.readers.shift();
    if (reader) { reader(value); return true; }
    if (this.values.length >= MAX_PENDING_CHUNKS) { this.close(); return false; }
    this.values.push(value); return true;
  }
  read(): Promise<Buffer | null> {
    const value = this.values.shift();
    if (value) return Promise.resolve(value);
    if (this.closed) return Promise.resolve(null);
    return new Promise(resolve => this.readers.push(resolve));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const reader of this.readers.splice(0)) reader(null);
  }
}

export class RobloxOnlyTCPSocket {
  readonly hostname: string;
  readonly port: number;
  private socket: Socket | null = null;
  private readonly incoming = new ByteQueue();
  constructor(hostname: string, port: number) { this.hostname = hostname; this.port = port; }

  async connect(ipOverride: string | null = null): Promise<void> {
    if (!isAllowedRobloxProxyTarget(this.hostname, this.port)) {
      throw new Error("Roblox relay only permits HTTPS destinations on Roblox domains.");
    }
    const socket = createConnection({ host: ipOverride || this.hostname, port: this.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on("data", (chunk: Buffer) => { if (!this.incoming.push(Buffer.from(chunk))) socket.destroy(); });
    socket.on("end", () => this.incoming.close());
    socket.on("close", () => { this.socket = null; this.incoming.close(); });
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => { socket.destroy(); reject(error); };
      socket.once("error", fail);
      socket.once("connect", () => { socket.off("error", fail); socket.on("error", () => this.incoming.close()); resolve(); });
    });
  }
  async recv(): Promise<Buffer | null> { return this.incoming.read(); }
  async send(data: Uint8Array): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error("Roblox relay socket is closed.");
    await new Promise<void>((resolve, reject) => socket.write(Buffer.from(data), error => error ? reject(error) : resolve()));
  }
  async close(): Promise<void> {
    this.incoming.close();
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) socket.end();
  }
  pause() { this.socket?.pause(); }
  resume() { this.socket?.resume(); }
}
