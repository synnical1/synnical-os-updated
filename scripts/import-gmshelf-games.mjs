#!/usr/bin/env node
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const ROOT = process.cwd()
const configPath = path.join(ROOT, "config", "local-games-approved.json")
const gamesDir = path.resolve(process.env.GAMES_DIR || "/var/lib/synnical/games")
const dryRun = process.argv.includes("--dry-run")

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${result.status}`)
}

function assertSafeRelative(value, label) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.split(/[\\/]+/).some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe ${label}: ${String(value)}`)
  }
  return value
}

function repoUrl(repo) {
  if (!/^gmshelf\/(truffled|seraph|ugs|ckv)$/.test(repo)) throw new Error(`Repository is not approved: ${repo}`)
  return `https://github.com/${repo}.git`
}

const config = JSON.parse(await readFile(configPath, "utf8"))
const approvals = Object.entries(config.approved || {})
if (!approvals.length) {
  console.log("No approved local games. Nothing to import.")
  process.exit(0)
}

if (dryRun) {
  console.log(`Approved local games: ${approvals.length}`)
  for (const [key, item] of approvals) console.log(`- ${key}: ${item.title} (${item.license})`)
  console.log("Dry run only. No files changed.")
  process.exit(0)
}

await mkdir(gamesDir, { recursive: true })
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "synnical-games-"))
const stagingRoot = path.join(gamesDir, ".staging-" + Date.now())
await mkdir(stagingRoot, { recursive: true })
const catalog = []

try {
  const grouped = new Map()
  for (const [approvalKey, item] of approvals) {
    const repo = approvalKey.split(":")[0]
    if (!config.repos?.[repo]) throw new Error(`Approval references unknown repo: ${repo}`)
    const list = grouped.get(repo) || []
    list.push({ approvalKey, item })
    grouped.set(repo, list)
  }

  for (const [repo, items] of grouped) {
    const spec = config.repos[repo]
    const checkout = path.join(tempRoot, repo.replace("/", "-"))
    await mkdir(checkout, { recursive: true })
    run("git", ["init", "-q"], checkout)
    run("git", ["remote", "add", "origin", repoUrl(repo)], checkout)
    run("git", ["config", "core.sparseCheckout", "true"], checkout)
    const sparseFile = path.join(checkout, ".git", "info", "sparse-checkout")
    const sparsePaths = [...new Set(items.flatMap(({ item }) => [item.sourcePath, item.licensePath]))]
      .map((value) => assertSafeRelative(value, "source path"))
    await writeFile(sparseFile, sparsePaths.map((value) => `/${value}\n`).join(""))
    run("git", ["fetch", "--depth=1", "origin", spec.ref], checkout)
    run("git", ["checkout", "--detach", "-q", "FETCH_HEAD"], checkout)

    for (const { approvalKey, item } of items) {
      const slug = String(item.slug || "").toLowerCase()
      if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(slug)) throw new Error(`Unsafe slug for ${approvalKey}`)
      const sourcePath = assertSafeRelative(item.sourcePath, "source path")
      const licensePath = assertSafeRelative(item.licensePath, "license path")
      const source = path.join(checkout, sourcePath)
      const licence = path.join(checkout, licensePath)
      if (!existsSync(source) || !existsSync(licence)) throw new Error(`Approved source or licence missing for ${approvalKey}`)

      const target = path.join(stagingRoot, slug)
      await cp(source, target, { recursive: true, force: false, errorOnExist: true })
      await cp(licence, path.join(target, "SYNNICAL-UPSTREAM-LICENSE.txt"), { force: false, errorOnExist: true })
      await writeFile(path.join(target, "SYNNICAL-SOURCE.json"), JSON.stringify({
        sourceRepo: repo,
        sourceRef: spec.ref,
        sourcePath,
        licence: item.license,
        licencePath: licensePath,
        importedAt: new Date().toISOString(),
      }, null, 2) + "\n")

      const entry = path.join(target, "index.html")
      if (!existsSync(entry)) throw new Error(`Approved game ${approvalKey} has no index.html`)
      catalog.push({
        slug,
        title: String(item.title || slug).slice(0, 120),
        cover: typeof item.cover === "string" ? item.cover : null,
        sourceRepo: repo,
        sourceRef: spec.ref,
        license: item.license,
        tags: ["Local"],
      })
    }
  }

  for (const game of catalog) {
    const finalPath = path.join(gamesDir, game.slug)
    const stagedPath = path.join(stagingRoot, game.slug)
    await rm(finalPath, { recursive: true, force: true })
    await rename(stagedPath, finalPath)
  }
  await writeFile(path.join(gamesDir, "catalog.json"), JSON.stringify({
    schema: 1,
    generatedAt: new Date().toISOString(),
    games: catalog,
  }, null, 2) + "\n")
  console.log(`Imported ${catalog.length} explicitly licensed local game${catalog.length === 1 ? "" : "s"} into ${gamesDir}`)
} finally {
  await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
}
