import { PrismaClient } from '@prisma/client'
import path from 'path'

const isDev = process.env.NODE_ENV !== 'production'
let dbUrl = process.env.DATABASE_URL || 'file:./db/custom.db'

// Prisma normally resolves a relative SQLite URL against the schema location
// embedded when the client was generated. A deployment build can happen in a
// temporary directory that is removed after release, leaving an otherwise
// healthy production database unreachable. Resolve the conventional relative
// URL against this running app's checked-in prisma directory instead.
if (dbUrl.startsWith('file:') && !path.isAbsolute(dbUrl.slice(5))) {
  dbUrl = `file:${path.resolve(process.cwd(), 'prisma', dbUrl.slice(5))}`
  process.env.DATABASE_URL = dbUrl
}
const isTurso = dbUrl.startsWith('libsql://') || dbUrl.startsWith('https://')

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  if (isTurso) {
    // Turso — lazy load adapter
    // Using eval to bypass TypeScript ESM restrictions
    const adapterModule = eval('require')('@prisma/adapter-libsql')
    const libsqlModule = eval('require')('@libsql/client')
    const libsql = libsqlModule.createClient({
      url: dbUrl,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    })
    const adapter = new adapterModule.PrismaLibSql(libsql)
    return new PrismaClient({ adapter, log: isDev ? ['warn', 'error'] : ['error'] })
  }
  // Local SQLite — no adapter needed, just standard Prisma
  return new PrismaClient({ log: isDev ? ['warn', 'error'] : ['error'] })
}

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

if (isDev) globalForPrisma.prisma = db
