import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? walk(join(dir, item.name)) : [join(dir, item.name)])
const files = ["server.ts", "stratus/api.js", ...walk("src"), ...walk("scripts")].filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file) && !file.endsWith("check-env.mjs"))
const names = new Set()
for (const file of files) {
  const text = readFileSync(file, "utf8")
  for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(match[1])
  for (const line of text.split("\n")) {
    if (/env\(|Env\(|required\(|optional\(|configuredBase\(|keyEnv:|modelEnv:|urlEnv:/.test(line)) {
      for (const match of line.matchAll(/["']([A-Z][A-Z0-9_]+)["']/g)) names.add(match[1])
    }
  }
}
const example = new Set([...readFileSync(".env.example", "utf8").matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]))
const missing = [...names].filter((name) => !example.has(name)).sort()
if (missing.length) { console.error("Missing environment examples:", missing.join(", ")); process.exitCode = 1 }
else console.log(`Environment inventory complete: ${names.size} referenced variables documented.`)
