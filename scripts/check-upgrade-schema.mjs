// Verifies the existing project's non-destructive db:init/db-push upgrade path.
// Only disposable files are used; never reads the deployment DATABASE_URL.
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
const root = await mkdtemp(path.join(tmpdir(), 'synnical-upgrade-'))
const url = `file:${path.join(root, 'upgrade.db')}`
const env = { ...process.env, DATABASE_URL: url }
const db = new PrismaClient({ datasources: { db: { url } } })
try {
  const baseline = execFileSync('git', ['show', '8eea72a7694dd4cfb77cf59475d35c40bb74f7ea:prisma/schema.prisma'], { encoding: 'utf8' })
  await writeFile(path.join(root, 'baseline.prisma'), baseline)
  await writeFile(path.join(root, 'upgrade.db'), '')
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', path.join(root, 'baseline.prisma')], { env, stdio: 'pipe' })
  const user = await db.user.create({ data: { username: 'upgrade-preservation-fixture', displayName: 'Fixture', passwordHash: 'test-only', coins: 123 }, select: { id: true } })
  await db.$executeRaw`INSERT INTO Session (id, token, userId, expiresAt) VALUES ('upgrade-session', 'test-only-token', ${user.id}, ${new Date(Date.now()+86400000)})`
  await db.$disconnect()
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env, stdio: 'pipe' })
  assert.equal((await db.user.findUnique({ where: { id: user.id } })).coins, 123)
  assert.equal((await db.session.findUnique({ where: { id: 'upgrade-session' } })).deviceHash, null)
  for (const [table, column] of [['Session', 'deviceHash'], ['Message', 'mentionedUserIds'], ['ChannelPreference', 'lastReadAt']]) {
    const fields = await db.$queryRawUnsafe(`PRAGMA table_info("${table}")`)
    assert.ok(fields.some(field => field.name === column))
  }
  console.log('PASS additive schema upgrade preserves accounts, balances and existing sessions (3 new columns)')
} finally { await db.$disconnect(); await rm(root, { recursive: true, force: true }) }
