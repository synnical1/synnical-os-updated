import "dotenv/config"
import { mkdir, open, lstat } from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

// Creates no accounts or sample data. Existing SQLite files are never truncated.
// Explicitly creating the file also avoids Prisma 6's opaque missing-file error.
const url = process.env.DATABASE_URL?.trim()
if (!url?.startsWith("file:") || url.includes("?") || url.includes("\0")) {
  throw new Error("db:init requires a SQLite file: DATABASE_URL without query parameters")
}
const filename = path.resolve("prisma", url.slice(5))
await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
try {
  const file = await open(filename, "wx", 0o600)
  await file.close()
} catch (error) {
  if (error.code !== "EEXIST") throw error
  const stat = await lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Database must be a regular file")
}
const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], {
  stdio: "inherit", env: { ...process.env, DATABASE_URL: `file:${filename}` },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
