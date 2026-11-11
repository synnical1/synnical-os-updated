
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
  "SynnFlix and Synnime use Movy directly without restoring the retired TMDB catalogue",
  () => {
    const appShell = read("src/components/app-shell.tsx")
    assert.match(appShell, /@\/components\/synnflix-unavailable-panel/)
    assert.doesNotMatch(appShell, /@\/components\/synnflix-panel/)

    const movies = read("src/components/synnflix-unavailable-panel.tsx")
    const synnime = read("src/components/synnime-panel.tsx")
    const embed = read("src/components/movy-embed-panel.tsx")
    assert.match(movies, /MovyEmbedPanel mode="movies"/)
    assert.match(synnime, /MovyEmbedPanel mode="anime"/)
    assert.match(embed, /https:\/\/www\.movy\.sx\//)
    assert.match(embed, /https:\/\/www\.movy\.sx\/browse\/anime/)
    assert.match(embed, /useScramjetController/)
    assert.match(embed, /useScramjetFrame/)
    assert.match(embed, /navigate\(src\)/)
    assert.match(embed, /<iframe/)
    assert.doesNotMatch(embed, /src=\{?src\}?/)
    assert.match(embed, /allowFullScreen/)

    const legacyPanel = read("src/components/synnflix-panel.tsx")
    assert.match(legacyPanel, /LEGACY UI ARCHIVE/)
    const globalSearch = read("src/app/api/features/search/route.ts")
    assert.doesNotMatch(globalSearch, /synnflix-tmdb|searchSynnFlix/)

    for (const path of [
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

test(
  "private uploads require an authenticated owner or channel member and disable shared caching",
  () => {
    const route = read("src/app/api/uploads/[...path]/route.ts")
    const serving = read("src/lib/upload-serving.ts")
    assert.match(route, /getCurrentUser\(\)/)
    assert.match(route, /privateWallpaper/)
    assert.match(route, /privateChatMedia/)
    assert.match(route, /expiresAt\.getTime\(\) <= Date\.now\(\)/)
    assert.match(route, /channel: \{ select: \{ memberships:/)
    assert.match(route, /"private, no-store"/)
    assert.match(serving, /cacheControl = "public/)
    assert.match(serving, /"Cache-Control": cacheControl/)
  }
)

test(
  "temporary mail creation and inbox polling have request limits",
  () => {
    const session = read("src/app/api/tempmail/session/route.ts")
    const inbox = read("src/app/api/tempmail/inbox/[token]/route.ts")
    assert.match(session, /consumeRequestLimit\(req, "tempmail-session", 3, 60 \* 60_000\)/)
    assert.match(inbox, /consumeRequestLimit\(_req, "tempmail-inbox", 30, 60_000\)/)
    assert.match(session, /status: 429/)
    assert.match(inbox, /status: 429/)
  }
)
