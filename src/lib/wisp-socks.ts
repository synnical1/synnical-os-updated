import net from "node:net"

class AsyncBufferQueue {
  private values: Buffer[] = []
  private waiters: Array<(value: Buffer | null) => void> = []
  private closed = false

  put(value: Buffer) {
    if (this.closed || value.length === 0) return
    const waiter = this.waiters.shift()
    if (waiter) waiter(value)
    else this.values.push(value)
  }

  get(): Promise<Buffer | null> {
    const value = this.values.shift()
    if (value) return Promise.resolve(value)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter(null)
    this.values.length = 0
  }
}

type ParsedSocks = {
  hostname: string
  port: number
  username: string
  password: string
}

export function parseSocks5Url(raw: string): ParsedSocks {
  const parsed = new URL(raw)
  if (parsed.protocol !== "socks5:" && parsed.protocol !== "socks5h:") {
    throw new Error("Netherlands browser route must use a socks5:// or socks5h:// URL")
  }
  const port = Number(parsed.port || 1080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SOCKS5 port")
  return {
    hostname: parsed.hostname,
    port,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  }
}

export function createSocks5TcpSocketClass(proxyUrl: string) {
  const proxy = parseSocks5Url(proxyUrl)

  return class Socks5TCPSocket {
    hostname: string
    port: number
    recv_buffer_size = 128
    socket: net.Socket | null = null
    paused = false
    connected = false
    data_queue = new AsyncBufferQueue()

    constructor(hostname: string, port: number) {
      this.hostname = hostname
      this.port = port
    }

    async connect() {
      const socket = new net.Socket()
      socket.setNoDelay(true)
      this.socket = socket

      let pending = Buffer.alloc(0)
      const readers: Array<{ size: number; resolve: (value: Buffer) => void; reject: (error: Error) => void }> = []
      let handshakeDone = false

      const pump = () => {
        while (readers.length && pending.length >= readers[0].size) {
          const reader = readers.shift()!
          const value = pending.subarray(0, reader.size)
          pending = pending.subarray(reader.size)
          reader.resolve(value)
        }
      }
      const rejectReaders = (error: Error) => {
        for (const reader of readers.splice(0)) reader.reject(error)
      }
      const onData = (chunk: Buffer) => {
        if (handshakeDone) {
          this.data_queue.put(Buffer.from(chunk))
          return
        }
        pending = Buffer.concat([pending, Buffer.from(chunk)])
        pump()
      }
      socket.on("data", onData)
      socket.on("close", () => {
        if (!handshakeDone) rejectReaders(new Error("SOCKS5 proxy closed during handshake"))
        this.data_queue.close()
        this.socket = null
      })
      socket.on("error", (error) => {
        if (!handshakeDone) rejectReaders(error)
      })
      socket.on("end", () => this.data_queue.close())

      const readExact = (size: number): Promise<Buffer> => {
        if (pending.length >= size) {
          const value = pending.subarray(0, size)
          pending = pending.subarray(size)
          return Promise.resolve(value)
        }
        return new Promise((resolve, reject) => readers.push({ size, resolve, reject }))
      }
      const write = (data: Buffer): Promise<void> => new Promise((resolve, reject) => {
        socket.write(data, (error) => error ? reject(error) : resolve())
      })

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { cleanup(); reject(error) }
        const onConnect = () => { cleanup(); resolve() }
        const cleanup = () => {
          socket.off("error", onError)
          socket.off("connect", onConnect)
        }
        socket.once("error", onError)
        socket.once("connect", onConnect)
        socket.connect({ host: proxy.hostname, port: proxy.port })
      })

      const useAuth = Boolean(proxy.username || proxy.password)
      await write(Buffer.from(useAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]))
      const greeting = await readExact(2)
      if (greeting[0] !== 0x05 || greeting[1] === 0xff) throw new Error("SOCKS5 proxy rejected authentication methods")

      if (greeting[1] === 0x02) {
        const user = Buffer.from(proxy.username, "utf8")
        const pass = Buffer.from(proxy.password, "utf8")
        if (user.length > 255 || pass.length > 255) throw new Error("SOCKS5 credentials are too long")
        await write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]))
        const auth = await readExact(2)
        if (auth[0] !== 0x01 || auth[1] !== 0x00) throw new Error("SOCKS5 username/password authentication failed")
      } else if (greeting[1] !== 0x00) {
        throw new Error(`Unsupported SOCKS5 authentication method: ${greeting[1]}`)
      }

      const host = Buffer.from(this.hostname, "utf8")
      if (!host.length || host.length > 255) throw new Error("Destination hostname is invalid for SOCKS5")
      const request = Buffer.alloc(7 + host.length)
      request[0] = 0x05
      request[1] = 0x01
      request[2] = 0x00
      request[3] = 0x03
      request[4] = host.length
      host.copy(request, 5)
      request.writeUInt16BE(this.port, 5 + host.length)
      await write(request)

      const response = await readExact(4)
      if (response[0] !== 0x05 || response[1] !== 0x00) {
        throw new Error(`SOCKS5 CONNECT failed with code ${response[1]}`)
      }
      if (response[3] === 0x01) await readExact(4)
      else if (response[3] === 0x04) await readExact(16)
      else if (response[3] === 0x03) {
        const length = (await readExact(1))[0]
        await readExact(length)
      } else throw new Error("SOCKS5 proxy returned an invalid address type")
      await readExact(2)

      handshakeDone = true
      this.connected = true
      if (pending.length) {
        this.data_queue.put(pending)
        pending = Buffer.alloc(0)
      }
    }

    async recv() {
      return this.data_queue.get()
    }

    async send(data: Buffer | Uint8Array | ArrayBuffer) {
      if (!this.socket) throw new Error("SOCKS5 stream is not connected")
      const buffer = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(data))
          : Buffer.from(data)
      await new Promise<void>((resolve, reject) => {
        this.socket!.write(buffer, (error) => error ? reject(error) : resolve())
      })
    }

    async close() {
      if (!this.socket) return
      const socket = this.socket
      this.socket = null
      this.connected = false
      this.paused = false
      this.data_queue.close()
      socket.end()
    }

    pause() {
      if (!this.socket || this.paused) return
      this.socket.pause()
      this.paused = true
    }

    resume() {
      if (!this.socket || !this.paused) return
      this.socket.resume()
      this.paused = false
    }
  }
}

export function createBlockedUdpSocketClass() {
  return class BlockedUdpSocket {
    hostname: string
    port: number
    constructor(hostname: string, port: number) {
      this.hostname = hostname
      this.port = port
    }
    async connect() { throw new Error("UDP is disabled on the Netherlands privacy route to prevent direct-IP leakage") }
    async recv() { return null }
    async send() { throw new Error("UDP is disabled on the Netherlands privacy route") }
    async close() {}
  }
}
