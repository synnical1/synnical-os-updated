import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"
import ts from "typescript"

test("independent production server bundles share one SQLite pool and queue competing writes", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), "tests/.production-db-"))
  try {
    const source = await readFile("src/lib/db.ts", "utf8")
    const bundled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    await Promise.all(["custom-server.mjs", "next-route.mjs"].map(name => writeFile(path.join(directory, name), bundled)))
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      const server = (await import('./custom-server.mjs')).db;
      const route = (await import('./next-route.mjs')).db;
      try {
        assert.ok(server === route, 'production bundles must share the same Prisma client');
        await server.$executeRawUnsafe('CREATE TABLE PoolProbe (id INTEGER PRIMARY KEY)');
        let started;
        const holdingLock = new Promise(resolve => { started = resolve });
        const transaction = server.$transaction(async tx => {
          await tx.$executeRawUnsafe('INSERT INTO PoolProbe VALUES (1)');
          started();
          await new Promise(resolve => setTimeout(resolve, 25));
          await tx.$queryRawUnsafe('SELECT * FROM PoolProbe');
        });
        await holdingLock;
        await Promise.all([transaction, route.$executeRawUnsafe('INSERT INTO PoolProbe VALUES (2)')]);
        assert.equal((await route.$queryRawUnsafe('SELECT * FROM PoolProbe')).length, 2);
        console.log('production pool concurrency passed');
      } finally { await Promise.all([...new Set([server, route])].map(db => db.$disconnect())); }
    `], { cwd: directory, env: { ...process.env, NODE_ENV: "production", DATABASE_URL: `file:${path.join(directory, "probe.db")}` }, encoding: "utf8", timeout: 20000 })
    assert.match(output, /production pool concurrency passed/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
