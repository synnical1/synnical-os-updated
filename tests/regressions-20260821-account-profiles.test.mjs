import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => readFileSync(path.join(root, file), "utf8")

test("account settings hydrate on login and persist safe runtime preferences", () => {
  const auth = read("src/hooks/use-auth.tsx")
  const runtime = read("src/lib/settings-runtime.ts")
  const route = read("src/app/api/features/settings/route.ts")
  assert.match(auth, /startAccountSettingsSync\(user\.id\)/)
  assert.match(auth, /hydrateOsSettings\(\)/)
  assert.match(runtime, /SETTINGS_OWNER_KEY/)
  assert.match(runtime, /queueAccountSetting\(key, value\)/)
  assert.match(route, /runtime\.settings\.v1/)
  assert.match(route, /MAX_SERIALIZED_BYTES/)
})

test("SynnFlix profiles expose 100 avatars, uploads and a who-is-watching gate", () => {
  const profiles = read("src/lib/synnflix-profiles.ts")
  const panel = read("src/components/synnflix-panel.tsx")
  const upload = read("src/app/api/features/media/profiles/upload/route.ts")
  assert.match(profiles, /Array\.from\(\{ length: 100 \}/)
  assert.match(profiles, /profile-atlas-v1\.webp/)
  assert.match(profiles, /padStart\(3, "0"\)/)
  assert.match(panel, /Who&apos;s watching\?/)
  assert.match(panel, /Choose from 100 avatars/)
  assert.match(panel, /Upload your image/)
  assert.match(upload, /resize\(512, 512/)
  assert.match(upload, /\.webp\(/)
})

test("SynnFlix history, lists and ratings are isolated by profile", () => {
  const schema = read("prisma/schema.prisma")
  const route = read("src/app/api/features/media/route.ts")
  assert.match(schema, /@@unique\(\[userId, profileId, kind, name\]\)/)
  assert.match(schema, /@@unique\(\[userId, profileId, mediaType, mediaId\]\)/)
  assert.match(schema, /@@unique\(\[userId, profileId, mediaType, mediaId, season, episode\]\)/)
  assert.match(route, /resolveMediaProfile/)
  assert.match(route, /where: \{ userId: me\.id, profileId \}/)
  assert.match(route, /scopeKey: `\$\{profileId\}:\$\{mediaType\}:\$\{mediaId\}`/)
})
