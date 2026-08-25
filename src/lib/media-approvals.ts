import "server-only"
import { randomUUID } from "crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises"
import path from "path"

export type PendingMedia = {
  id: string
  userId: string
  username: string
  type: "pfp" | "banner"
  extension: ".webp"
  mime: "image/webp"
  animated: boolean
  automatedCode: string
  createdAt: string
}

const root = () => process.env.MEDIA_APPROVALS_DIR?.trim() || "/var/lib/synnical/media-approvals"
const indexPath = () => path.join(root(), "pending.json")
let operation = Promise.resolve()

async function readIndex(): Promise<PendingMedia[]> {
  try {
    const parsed = JSON.parse(await readFile(indexPath(), "utf8"))
    return Array.isArray(parsed) ? parsed : []
  } catch (error: any) {
    if (error?.code === "ENOENT") return []
    throw error
  }
}

async function writeIndex(items: PendingMedia[]) {
  await mkdir(root(), { recursive: true, mode: 0o700 })
  const temporary = `${indexPath()}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(items, null, 2), { mode: 0o600 })
  await rename(temporary, indexPath())
}

function locked<T>(task: () => Promise<T>): Promise<T> {
  const next = operation.then(task, task)
  operation = next.then(() => undefined, () => undefined)
  return next
}

export async function queueMedia(input: Omit<PendingMedia, "id" | "createdAt" | "extension" | "mime">, buffer: Buffer): Promise<PendingMedia> {
  return locked(async () => {
    const id = randomUUID()
    const item: PendingMedia = { ...input, id, createdAt: new Date().toISOString(), extension: ".webp", mime: "image/webp" }
    await mkdir(root(), { recursive: true, mode: 0o700 })
    await writeFile(path.join(root(), `${id}.webp`), buffer, { mode: 0o600 })
    const items = await readIndex()
    // One pending item per profile field prevents repeated uploads from
    // filling the private queue. A newer submission replaces the older one.
    const replaced = items.findIndex(entry => entry.userId === input.userId && entry.type === input.type)
    if (replaced >= 0) {
      const [old] = items.splice(replaced, 1)
      await unlink(path.join(root(), `${old.id}.webp`)).catch(() => {})
    }
    if (items.length >= 500) {
      await unlink(path.join(root(), `${id}.webp`)).catch(() => {})
      throw new Error("The media approval queue is full. Try again after staff reviews pending uploads.")
    }
    items.push(item)
    await writeIndex(items)
    return item
  })
}

export async function listPendingMedia(): Promise<PendingMedia[]> {
  return (await readIndex()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function readPendingMedia(id: string): Promise<{ item: PendingMedia; buffer: Buffer } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const item = (await readIndex()).find(entry => entry.id === id)
  if (!item) return null
  return { item, buffer: await readFile(path.join(root(), `${id}.webp`)) }
}

export async function removePendingMedia(id: string): Promise<PendingMedia | null> {
  return locked(async () => {
    const items = await readIndex()
    const index = items.findIndex(item => item.id === id)
    if (index < 0) return null
    const [item] = items.splice(index, 1)
    await writeIndex(items)
    await unlink(path.join(root(), `${id}.webp`)).catch(() => {})
    return item
  })
}

/** Resolve exactly once while holding the queue lock. */
export async function resolvePendingMedia<T>(id: string, handler: (pending: { item: PendingMedia; buffer: Buffer }) => Promise<T>): Promise<T | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  return locked(async () => {
    const items = await readIndex()
    const index = items.findIndex(item => item.id === id)
    if (index < 0) return null
    const item = items[index]
    const buffer = await readFile(path.join(root(), `${id}.webp`))
    const result = await handler({ item, buffer })
    items.splice(index, 1)
    await writeIndex(items)
    await unlink(path.join(root(), `${id}.webp`)).catch(() => {})
    return result
  })
}
