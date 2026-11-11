
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) =>
  fs.readFileSync(path, "utf8")

const pkg =
  JSON.parse(read("package.json"))

test(
  "release gate includes Prisma, TypeScript, tests and build",
  () => {
    assert.equal(
      pkg.scripts.prebuild,
      "prisma generate"
    )

    assert.match(
      pkg.scripts.typecheck || "",
      /prisma generate/
    )

    assert.match(
      pkg.scripts.typecheck || "",
      /tsc --noEmit/
    )

    assert.equal(
      pkg.scripts["pretest:release"],
      "prisma generate"
    )

    const gate =
      pkg.scripts["release:gate"] || ""

    assert.match(gate, /typecheck/)
    assert.match(gate, /prisma validate/)
    assert.match(gate, /test:release/)
    assert.match(gate, /npm run build/)

    assert.match(
      pkg.scripts["release:gate:clean"] || "",
      /npm ci && npm run release:gate/
    )
  }
)

test(
  "Rich Presence ClientUser contract cannot drift",
  () => {
    const source =
      read("src/lib/chat-server.ts")

    assert.match(
      source,
      /interface ClientUser[\s\S]*activity\?: RichPresenceActivity \| null[\s\S]*\n}/
    )

    assert.match(
      source,
      /activity: latestActivityForUser\(u\.userId\)/
    )
  }
)

test(
  "Games Rich Presence effect cleanup never returns dispatchEvent boolean",
  () => {
    const source = read("src/components/games-panel.tsx")
    assert.doesNotMatch(source, /return \(\) => window\.dispatchEvent\(/)
    assert.match(source, /return \(\) => \{ window\.dispatchEvent\(/)
  }
)

test(
  "SynnFlix and Synnime stay closed until an authorised media provider is selected",
  () => {
    const appShell = read("src/components/app-shell.tsx")
    assert.match(appShell, /@\/components\/synnflix-unavailable-panel/)
    assert.doesNotMatch(appShell, /@\/components\/synnflix-panel/)

    const synnime = read("src/components/synnime-panel.tsx")
    assert.match(synnime, /SynnFlixUnavailablePanel appName="Synnime"/)

    const unavailable = read("src/components/synnflix-unavailable-panel.tsx")
    assert.match(unavailable, /properly authorised provider/)

    for (const path of [
      "src/components/synnflix-panel.tsx",
      "src/lib/synnflix-tmdb.ts",
      "src/lib/server/tmdb-credentials.mjs",
      "src/app/api/synnflix/home/route.ts",
      "src/app/api/synnflix/search/route.ts",
      "src/app/api/synnflix/details/route.ts",
      "src/app/api/synnflix/season/route.ts",
    ]) {
      assert.throws(() => read(path), { code: "ENOENT" })
    }
  }
)
