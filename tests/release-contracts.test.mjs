
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
      /activity: state\?\.activity \|\| null/
    )
  }
)

test(
  "Rich Presence effect cleanup never returns dispatchEvent boolean",
  () => {
    for (
      const file of [
        "src/components/games-panel.tsx",
        "src/components/synnflix-panel.tsx",
      ]
    ) {
      const source = read(file)

      assert.doesNotMatch(
        source,
        /return \(\) => window\.dispatchEvent\(/
      )

      assert.match(
        source,
        /return \(\) => \{ window\.dispatchEvent\(/
      )
    }
  }
)
