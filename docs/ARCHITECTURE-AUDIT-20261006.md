# Synnical architecture map (before changes)

Source: main be5ac3d378a66b75ca3833751aa281863c1f7fa4. Retrieved conversation context, Library historical validation excerpts, README/recovery/deployment/foundation docs and Git lineage before editing.

| Boundary | Implementation | Trust/data contract |
|---|---|---|
| Process | server.ts → Next App Router + bundled Stratus + Socket.IO + Wisp | Node 22; one PM2 fork; Nginx overwrites forwarded IP headers |
| Persistence | Prisma 6.19.3, SQLite; src/lib/db.ts | User/Session/Channel/Message, social, economy, FeatureRecord and media tables; db:init uses db push, no migrations |
| Authentication | auth-server.ts, auth API, use-auth hook | scrypt password hashes; random server sessions; HttpOnly/Lax cookies; optional SVG bearer handoff; server ban/session lookup |
| Permissions | roles.ts, moderation-service.ts, channel-permissions.ts | OWNER > ADMIN (= legacy HEAD_ADMIN) > MOD > MEMBER; DEV/NOTABLE/BETA/GOAT are recognition tags, no staff permissions |
| Realtime | chat-server.ts + chat-realtime.ts + chat-panel.tsx | Session revalidation per packet; room/membership checks; per-user windows; unique message nonce; deferred serial bookkeeping |
| Social/profile | profile APIs, privacy.ts, friendship-social.ts, profile modal/card | SafeUser serialization; account preferences and privacy rules; profile media approval queue |
| Credits/shop | shop.ts, shop-economy.ts, marketplace/economy API | Ledger and inventory uniqueness; transactional purchases; daily eligibility incorrectly checked outside write transaction |
| Desktop/theme | app-shell, desktop-shell, theme-applier, appearance CSS | OS-only launcher; account settings; true black theme; forced dark first paint introduced intentionally in 7062847 |
| Media metadata | synnflix-tmdb.ts + /api/synnflix/{home,search,details,season} | Server credentials; typed normalization; no cache/deduplication, first-page-only search |
| Media playback | dormant synnflix-panel.tsx | Native catalogue exists, but Vidking iframe and untrusted window message progress transport remain; launcher currently unavailable |
| Anime | synnime-panel.tsx, TMDB anime mode in dormant panel | Under Construction; reusable anime catalogue exists but not wired |
| Media account state | /api/features/media, profiles-server, MediaProgress/List/Rating | Account/profile ownership checked; progress clamping accepts coerced/corrupt values; nullable list uniqueness permits duplicate title entries |
| Music | music-panel, music-server, music library API | Audius native player; optional operator bridges; external audio proxy trusts returned URLs and redirects too broadly |
| Browser/proxy | use-scramjet, browser-panel, proxy tickets, server upgrades | Same-origin/session gate; Wisp private/loopback/UDP denied and ports 80/443 only; generated assets checked separately |
| CI/deploy | .github/workflows/deploy.yml | PR verifies; push main verifies then automatically deploys; in-place reset/install/build/schema apply lacks release rollback |

Baseline: npm ci installed 963 packages; npm ls successful; typecheck/lint successful; 339/339 tests; production build successful (Next 16.3.5); 23/23 disposable smoke groups. Initial install/build used host Node 24 (engine warning); Node 22.23.3 acquired for final target-runtime verification. npm audit: 2 critical + 8 high. No production changes. The subsequent extended JSON/client scan confirmed a committed Stratus authorization key; the remediation removes it from the current tree and browser bundle and requires rotation.

Historical requirements reconciled: OLED black intentional a79768c/be5ac3d; dark-only deliberate 7062847, retain pending product direction; HEAD_ADMIN canonicalized to ADMIN in 36ca534; recognition tags intentionally nonprivileged. Older August Library logs are historical evidence, not current health claims.
