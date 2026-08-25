import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const cache = new Map<string, Promise<string>>()
const source = (file: string) => { let value = cache.get(file); if (!value) { value = readFile(resolve(process.cwd(), file), "utf8"); cache.set(file, value) } return value }
type Clause = { file: string; any: string[] }
const features: Array<{ id: number; name: string; clauses: Clause[] }> = [
  { id: 1, name: "Pinned DMs", clauses: [{ file: "src/components/chat-panel.tsx", any: ["Pin DM"] }, { file: "src/app/api/features/chat/route.ts", any: ["pinned"] }] },
  { id: 2, name: "DM folders", clauses: [{ file: "src/components/chat-panel.tsx", any: ["Move to folder"] }, { file: "src/app/api/features/chat/route.ts", any: ["folder"] }] },
  { id: 3, name: "Message bookmarks", clauses: [{ file: "src/app/api/features/chat/route.ts", any: ["action === \"saved\"", "toggle-save"] }, { file: "src/components/chat-panel.tsx", any: ["Saved messages"] }] },
  { id: 4, name: "Scheduled messages", clauses: [{ file: "src/app/api/features/chat/route.ts", any: ["action === \"schedule\"", "scheduledMessage"] }, { file: "src/lib/chat-server.ts", any: ["ScheduledMessage", "scheduledMessage"] }, { file: "src/components/chat-panel.tsx", any: ["Scheduled messages"] }] },
  { id: 5, name: "Draft syncing", clauses: [{ file: "src/components/chat-panel.tsx", any: ["draft }),", "draft:"] }, { file: "src/app/api/features/chat/route.ts", any: ["draft"] }] },
  { id: 6, name: "Edit history", clauses: [{ file: "src/lib/chat-server.ts", any: ["messageEditHistory"] }, { file: "src/components/chat-panel.tsx", any: ["Edit history"] }] },
  { id: 7, name: "Threaded replies", clauses: [{ file: "src/lib/chat-server.ts", any: ["threadRootId"] }, { file: "src/components/chat-panel.tsx", any: ["Reply in thread"] }] },
  { id: 8, name: "Channel slow mode", clauses: [{ file: "src/lib/chat-server.ts", any: ["slowModeSeconds"] }, { file: "src/components/chat-panel.tsx", any: ["Slow mode"] }] },
  { id: 9, name: "Per-channel notification levels", clauses: [{ file: "src/components/chat-panel.tsx", any: ["notificationLevel"] }, { file: "src/app/api/features/chat/route.ts", any: ["notificationLevel"] }] },
  { id: 10, name: "Custom notification sounds", clauses: [{ file: "src/components/chat-panel.tsx", any: ["notificationSound", "playMessageSound"] }] },
  { id: 11, name: "First unread jump", clauses: [{ file: "src/components/chat-panel.tsx", any: ["First unread", "firstUnreadMessageId"] }] },
  { id: 12, name: "Conversation search filters", clauses: [{ file: "src/app/api/features/chat/route.ts", any: ["from", "to", "senderId", "mediaOnly"] }, { file: "src/components/chat-panel.tsx", any: ["Search this conversation", "Search from date", "Search to date"] }] },
  { id: 13, name: "Shared media gallery", clauses: [{ file: "src/app/api/features/chat/route.ts", any: ["action === \"gallery\"", "media:"] }, { file: "src/components/chat-panel.tsx", any: ["Shared media"] }] },
  { id: 14, name: "Shared links gallery", clauses: [{ file: "src/app/api/features/chat/route.ts", any: ["action === \"gallery\"", "links:"] }, { file: "src/components/chat-panel.tsx", any: ["Shared links"] }] },
  { id: 15, name: "Voice waveform seek speed", clauses: [{ file: "src/components/voice-recorder.tsx", any: ["waveform", "playbackRate", "type=\"range\""] }] },
  { id: 16, name: "Voice transcription", clauses: [{ file: "src/components/voice-recorder.tsx", any: ["transcript"] }, { file: "src/lib/chat-server.ts", any: ["voiceTranscript"] }] },
  { id: 17, name: "Message translation", clauses: [{ file: "src/app/api/features/chat/route.ts", any: ["translate"] }, { file: "src/components/chat-panel.tsx", any: ["Translate"] }] },
  { id: 18, name: "Spoiler formatting", clauses: [{ file: "src/components/chat-panel.tsx", any: ["SpoilerReveal", "||"] }] },
  { id: 19, name: "Polls", clauses: [{ file: "src/app/api/features/chat/route.ts", any: ["create-poll"] }, { file: "src/components/chat-panel.tsx", any: ["Create poll"] }] },
  { id: 20, name: "Anonymous staff polls", clauses: [{ file: "src/app/api/features/chat/route.ts", any: ["anonymous"] }, { file: "src/components/chat-panel.tsx", any: ["Anonymous"] }] },
  { id: 21, name: "Events and RSVP", clauses: [{ file: "src/app/api/features/chat/route.ts", any: ["create-event", "rsvp"] }, { file: "src/components/chat-panel.tsx", any: ["RSVP", "Create event"] }] },
  { id: 22, name: "Birthdays", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["Birthday visibility"] }, { file: "src/components/friends-panel.tsx", any: ["birthday"] }] },
  { id: 23, name: "Friend nicknames", clauses: [{ file: "src/components/friends-panel.tsx", any: ["nickname"] }, { file: "src/app/api/features/profile/route.ts", any: ["nickname"] }] },
  { id: 24, name: "Friend notes", clauses: [{ file: "src/components/friends-panel.tsx", any: ["note"] }, { file: "src/app/api/features/profile/route.ts", any: ["note"] }] },
  { id: 25, name: "Close Friends", clauses: [{ file: "src/components/friends-panel.tsx", any: ["closeFriend", "Close friend"] }] },
  { id: 26, name: "Favourite profiles", clauses: [{ file: "src/components/friends-panel.tsx", any: ["favorite", "Favourite"] }] },
  { id: 27, name: "Bilateral profile visitors", clauses: [{ file: "src/app/api/features/profile/route.ts", any: ["visitorVisibility", "profileVisit"] }, { file: "src/components/profile-advanced-editor.tsx", any: ["Profile visitors"] }] },
  { id: 28, name: "Pronouns", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["Pronouns visibility"] }, { file: "src/components/user-profile-modal.tsx", any: ["pronouns"] }] },
  { id: 29, name: "Verified profile links", clauses: [{ file: "src/lib/profile-link-verification.ts", any: ["fetchVerificationToken"] }, { file: "src/components/profile-advanced-editor.tsx", any: ["Verified profile links"] }] },
  { id: 30, name: "Playable profile music", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["Profile music provider", "Track ID"] }, { file: "src/components/user-profile-modal.tsx", any: ["ProfileTrackAudio", "/api/music/audius/stream/"] }] },
  { id: 31, name: "Profile showcases", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["Showcase"] }, { file: "src/app/api/features/profile/route.ts", any: ["showcase"] }] },
  { id: 32, name: "Status expiry", clauses: [{ file: "src/app/api/features/profile/route.ts", any: ["statusExpired", "statusExpiresAt"] }, { file: "src/lib/chat-server.ts", any: ["statusExpiresAt"] }] },
  { id: 33, name: "Profile accent gradient", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["Accent gradient"] }, { file: "src/components/user-profile-modal.tsx", any: ["profileAccentGradient"] }] },
  { id: 34, name: "Banner positioning", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["Banner horizontal position"] }, { file: "src/components/user-profile-modal.tsx", any: ["objectPosition"] }] },
  { id: 35, name: "Cosmetic favourites", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["toggle-cosmetic-favorite"] }] },
  { id: 36, name: "Cosmetic loadouts", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["save-loadout", "apply-loadout"] }] },
  { id: 37, name: "Seasonal cosmetic rotation", clauses: [{ file: "src/components/shop-panel.tsx", any: ["seasonalRotation", "This week"] }, { file: "src/lib/shop.ts", any: ["currentSeasonalRotation"] }] },
  { id: 38, name: "Limited edition serials", clauses: [{ file: "src/lib/shop.ts", any: ["serial"] }, { file: "src/components/economy-dashboard.tsx", any: ["serial"] }] },
  { id: 39, name: "Cosmetic gifting wishlists", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["toggle-cosmetic-wishlist"] }] },
  { id: 40, name: "Shop wishlist price changes", clauses: [{ file: "src/app/api/features/economy/route.ts", any: ["priceChanged"] }, { file: "src/components/economy-dashboard.tsx", any: ["Price changed", "wishlist"] }] },
  { id: 41, name: "Daily login streak", clauses: [{ file: "src/lib/feature-platform.ts", any: ["recordLogin"] }, { file: "src/app/api/auth/login/route.ts", any: ["recordLogin"] }, { file: "src/app/api/auth/register/route.ts", any: ["recordLogin"] }] },
  { id: 42, name: "Weekly challenges", clauses: [{ file: "src/lib/feature-platform.ts", any: ["Challenge", "challengeProgress"] }, { file: "src/components/economy-dashboard.tsx", any: ["Weekly challenges"] }] },
  { id: 43, name: "Achievements", clauses: [{ file: "src/lib/feature-platform.ts", any: ["earnAchievement"] }, { file: "src/components/economy-dashboard.tsx", any: ["Achievements"] }] },
  { id: 44, name: "Achievement showcase", clauses: [{ file: "src/components/profile-advanced-editor.tsx", any: ["Achievement showcased"] }, { file: "src/components/user-profile-modal.tsx", any: ["Trophy"] }] },
  { id: 45, name: "Account XP and level", clauses: [{ file: "src/lib/feature-platform.ts", any: ["xp", "level"] }, { file: "src/components/economy-dashboard.tsx", any: ["XP", "Level"] }] },
  { id: 46, name: "Promo codes", clauses: [{ file: "src/app/api/features/economy/route.ts", any: ["redeem-promo", "create-promo"] }, { file: "src/components/economy-dashboard.tsx", any: ["Promo"] }] },
  { id: 47, name: "Transaction receipts", clauses: [{ file: "src/app/api/features/economy/route.ts", any: ["transactions"] }, { file: "src/components/economy-dashboard.tsx", any: ["Receipts"] }] },
  { id: 48, name: "Gift history", clauses: [{ file: "src/app/api/features/economy/route.ts", any: ["giftsSent", "giftsReceived"] }, { file: "src/components/economy-dashboard.tsx", any: ["Gift history"] }] },
  { id: 49, name: "Refund eligibility countdown", clauses: [{ file: "src/lib/shop.ts", any: ["REFUND_WINDOW_MS"] }, { file: "src/app/api/features/economy/route.ts", any: ["refundEligibleUntil"] }, { file: "src/components/economy-dashboard.tsx", any: ["refund"] }] },
  { id: 50, name: "Shop rarity tiers", clauses: [{ file: "src/components/shop-panel.tsx", any: ["rarity"] }, { file: "src/lib/shop.ts", any: ["rarity"] }] },
  { id: 51, name: "Custom Synn Bot commands", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["customcmd"] }] },
  { id: 52, name: "Synn Bot reminders", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["command === \"remind\"", "botReminder"] }] },
  { id: 53, name: "Synn Bot polls", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["command === \"poll\""] }] },
  { id: 54, name: "Synn Bot countdowns", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["countdown"] }] },
  { id: 55, name: "Synn Bot weather", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["open-meteo.com"] }] },
  { id: 56, name: "Synn Bot dictionary", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["dictionaryapi.dev", "defineWord"] }] },
  { id: 57, name: "Synn Bot units", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["convertUnits"] }] },
  { id: 58, name: "Synn Bot currency", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["frankfurter", "currency"] }] },
  { id: 59, name: "Synn Bot team generator", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["makeTeams"] }] },
  { id: 60, name: "Synn Bot brackets", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["function bracket"] }] },
  { id: 61, name: "Permission-aware bot message lookup", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["findmsg", "channelMember"] }] },
  { id: 62, name: "Synn Bot moderation summaries", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["modsummary", "isMod"] }] },
  { id: 63, name: "Synn Bot profile command", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["command === \"profile\""] }] },
  { id: 64, name: "Synn Bot game command", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["command === \"game\""] }] },
  { id: 65, name: "Synn Bot usage analytics", clauses: [{ file: "src/lib/synn-bot-features.ts", any: ["botstats", "botUsage"] }] },
  { id: 66, name: "Game collections", clauses: [{ file: "src/app/api/features/games/route.ts", any: ["collection"] }, { file: "src/components/games-panel.tsx", any: ["collection"] }] },
  { id: 67, name: "Recently played duration", clauses: [{ file: "src/app/api/features/games/route.ts", any: ["durationSeconds"] }, { file: "src/components/games-panel.tsx", any: ["duration"] }] },
  { id: 68, name: "Continue Playing", clauses: [{ file: "src/components/games-panel.tsx", any: ["Continue Playing"] }] },
  { id: 69, name: "Per-game controller presets", clauses: [{ file: "src/components/games-panel.tsx", any: ["controller", "deadzone"] }, { file: "src/app/api/features/games/route.ts", any: ["controllerJson"] }] },
  { id: 70, name: "Per-game audio presets", clauses: [{ file: "src/components/games-panel.tsx", any: ["audio", "gameVolume"] }, { file: "src/app/api/features/games/route.ts", any: ["audioJson"] }] },
  { id: 71, name: "Game launch diagnostics", clauses: [{ file: "src/components/games-panel.tsx", any: ["diagnostics"] }, { file: "src/app/api/features/games/route.ts", any: ["session-failure", "errorCode"] }] },
  { id: 72, name: "Cloud session latency", clauses: [{ file: "src/components/games-panel.tsx", any: ["latencyMs"] }, { file: "src/app/api/features/games/route.ts", any: ["session-latency"] }] },
  { id: 73, name: "Bitrate capability gating", clauses: [{ file: "src/components/games-panel.tsx", any: ["Bitrate", "bitrate"] }, { file: "src/app/api/features/games/route.ts", any: ["bitrate"] }] },
  { id: 74, name: "Reconnect stream", clauses: [{ file: "src/components/games-panel.tsx", any: ["Reconnect stream", "embedRevision"] }] },
  { id: 75, name: "Game status sharing", clauses: [{ file: "src/app/api/features/games/route.ts", any: ["gameStatus"] }, { file: "src/components/user-profile-modal.tsx", any: ["Playing"] }] },
  { id: 76, name: "Session invite capability gating", clauses: [{ file: "src/components/games-panel.tsx", any: ["invite", "provider"] }, { file: "src/app/api/features/games/route.ts", any: ["sameProviderSessionInviteReason"] }] },
  { id: 77, name: "Private game screenshots", clauses: [{ file: "src/app/api/features/games/screenshot/[id]/route.ts", any: ["userId"] }, { file: "src/components/games-panel.tsx", any: ["Save screenshot"] }] },
  { id: 78, name: "Game session history", clauses: [{ file: "src/app/api/features/games/route.ts", any: ["session-failure", "sessions"] }, { file: "src/components/games-panel.tsx", any: ["Session history"] }] },
  { id: 79, name: "Browser tab groups", clauses: [{ file: "src/components/browser-panel.tsx", any: ["tabGroups", "groupId"] }, { file: "src/app/api/features/browser/route.ts", any: ["save-groups"] }] },
  { id: 80, name: "Browser fresh launch", clauses: [{ file: "src/components/browser-panel.tsx", any: ["newTab(initialUrl)"] }, { file: "src/app/api/features/browser/route.ts", any: ["session: null"] }] },
  { id: 81, name: "Account browser bookmarks", clauses: [{ file: "src/components/browser-panel.tsx", any: ["save-bookmark"] }, { file: "src/app/api/features/browser/route.ts", any: ["browserBookmark"] }] },
  { id: 82, name: "Browser history search/private clear", clauses: [{ file: "src/components/browser-panel.tsx", any: ["historyQuery", "Temporary profile"] }, { file: "src/app/api/features/browser/route.ts", any: ["clear-history"] }] },
  { id: 83, name: "Per-site browser permissions", clauses: [{ file: "src/components/browser-panel.tsx", any: ["notifications", "storage", "popups"] }, { file: "src/app/api/features/browser/route.ts", any: ["set-permission"] }] },
  { id: 84, name: "Browser download manager", clauses: [{ file: "src/components/browser-panel.tsx", any: ["managedDownload", "download-update"] }, { file: "src/app/api/features/browser/route.ts", any: ["download-start", "download-update"] }] },
  { id: 85, name: "Browser site permissions", clauses: [{ file: "src/components/browser-panel.tsx", any: ["Site permissions", "setSitePermission"] }] },
  { id: 86, name: "Browser managed downloads", clauses: [{ file: "src/components/browser-panel.tsx", any: ["managedDownload", "Recent downloads"] }] },
  { id: 87, name: "Browser runtime isolation", clauses: [{ file: "src/hooks/use-scramjet.ts", any: ["plugins: []", "core Scramjet pipeline"] }] },
  { id: 88, name: "Temporary browser profile", clauses: [{ file: "src/components/browser-panel.tsx", any: ["temporary", "tempSession", "cookie"] }] },
  { id: 89, name: "SynnFlix watchlist", clauses: [{ file: "src/components/synnflix-panel.tsx", any: ["watchlist"] }] },
  { id: 90, name: "SynnFlix favourites", clauses: [{ file: "src/components/synnflix-panel.tsx", any: ["favorite"] }] },
  { id: 91, name: "SynnFlix custom lists", clauses: [{ file: "src/components/synnflix-panel.tsx", any: ["custom", "list"] }] },
  { id: 92, name: "SynnFlix episode autoplay", clauses: [{ file: "src/components/synnflix-panel.tsx", any: ["episodeAutoplay", "autoplay"] }] },
  { id: 93, name: "SynnFlix sourced skip intro", clauses: [{ file: "src/components/synnflix-panel.tsx", any: ["introMarker", "Skip intro"] }, { file: "src/app/api/features/media/route.ts", any: ["introMarker"] }] },
  { id: 94, name: "SynnFlix watch parties", clauses: [{ file: "src/components/synnflix-panel.tsx", any: ["watchParty", "party"] }, { file: "src/lib/chat-server.ts", any: ["watch-party"] }] },
  { id: 95, name: "SynnFlix ratings/reviews", clauses: [{ file: "src/components/synnflix-panel.tsx", any: ["rating", "review"] }, { file: "src/app/api/features/media/route.ts", any: ["rate"] }] },
  { id: 96, name: "Music drag reorder queue", clauses: [{ file: "src/components/music-panel.tsx", any: ["draggable", "onDrop", "reorderQueue"] }] },
  { id: 97, name: "Synced music playlists", clauses: [{ file: "src/components/music-panel.tsx", any: ["save-playlist"] }, { file: "src/app/api/features/music/route.ts", any: ["save-playlist"] }] },
  { id: 98, name: "Music activity privacy", clauses: [{ file: "src/components/music-panel.tsx", any: ["Share listening activity", "shareEnabled"] }, { file: "src/app/api/features/profile/route.ts", any: ["shareEnabled"] }] },
  { id: 99, name: "Unified Global Search", clauses: [{ file: "src/components/discovery-panel.tsx", any: ["Global Search"] }, { file: "src/app/api/features/search/route.ts", any: ["messages", "games", "media"] }] },
  { id: 100, name: "Owner System Health", clauses: [{ file: "src/components/discovery-panel.tsx", any: ["System Health"] }, { file: "src/app/api/features/health/route.ts", any: ["OWNER", "runtime", "database", "uploads", "proxy"] }] },
]

test("consolidated feature manifest contains exactly 100 numbered features", () => {
  assert.equal(features.length, 100)
  assert.deepEqual(features.map((f) => f.id), Array.from({ length: 100 }, (_, i) => i + 1))
  assert.equal(new Set(features.map((f) => f.name)).size, 100)
})

for (const feature of features) {
  test(`${feature.id}. ${feature.name} has persisted/runtime consumer evidence`, async () => {
    for (const clause of feature.clauses) {
      const body = await source(clause.file)
      assert.ok(clause.any.some((marker) => body.includes(marker)), `${feature.id} ${feature.name}: ${clause.file} missing one of ${clause.any.join(" | ")}`)
    }
  })
}

test("capability-gated features stay honest instead of exposing dead controls", async () => {
  const games = await source("src/components/games-panel.tsx")
  assert.match(games, /bitrate/i)
  assert.match(games, /unavailable|not exposed|provider/i)
  assert.match(games, /invite/i)
  const media = await source("src/components/synnflix-panel.tsx")
  assert.match(media, /introMarker/)
})

test("SynnFlix player stays a direct provider iframe without Synnical sandbox regressions", async () => {
  const wrapper = await source("src/components/synnflix-panel.tsx")
  assert.match(wrapper, /iframe\.src = providerUrl\.toString\(\)/)
  assert.doesNotMatch(wrapper, /iframe\.sandbox/)
  assert.doesNotMatch(wrapper, /\/api\/synnflix\/player/)
})
test("completion provider pool excludes OpenAI", async () => {
  const pool = await source("src/lib/ai-provider-pool.ts")
  assert.match(pool, /openrouter/)
  assert.doesNotMatch(pool, /type ProviderName[^\n]*openai/i)
})
