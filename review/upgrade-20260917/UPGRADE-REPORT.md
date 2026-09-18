# Synnical recovery upgrade report

## Source and scope

- Source inspected: `recovery/20260915-arm64` at `8eea72a7694dd4cfb77cf59475d35c40bb74f7ea`.
- The fetched `main` and recovery refs pointed to that same commit; no newer approved source ref was found.
- This upgrade intentionally preserves the recovered OS shell and extends its existing APIs, Socket.IO server, Prisma/SQLite data model, and settings system.

## Implemented and verified core work

- Settings inputs use non-credential names and appropriate autocomplete semantics; password changes are isolated in a credential form.
- The shell is OS-only, has persisted light/dark base appearance modes, and resets new/default wallpaper state to the supplied bundled wallpaper.
- Added a single application image viewer with keyboard close/reset, wheel zoom, pan, focus handling, and scroll locking.
- Reworked shared chat realtime state so providers/listeners are singleton-backed. Unread state is persisted, read updates are monotonic, ordinary messages are indicators only, and resolved mentions produce the higher-priority alert path.
- Added first-party, HttpOnly device identity association, server-side device/account ban enforcement for login, APIs, Socket.IO, and Wisp, plus auditable shared moderation services/events.
- Formalized server-authoritative role hierarchy and staff-only User Management actions. Bot moderation commands share the same service and resolve a single exact target before action.
- Added role/account status UI, moderation history detail, SynnVM intentional Coming Soon view, and an Audius-backed Music experience with persistent favorites/history and the supplied live background video.
- Added proxy asset version verification for the installed Scramjet packages.

## Data model changes

The upgrade adds nullable/additive fields only: `Session.deviceHash`, `Message.mentionedUserIds`, and `ChannelPreference.lastReadAt`. The schema upgrade check initializes an existing-schema fixture and proves existing accounts, balances, and sessions survive the update.

## Bundled supplied assets

- `public/brand/wallpapers/thorfinn.webp` — SHA-256 `21f97475ad4c465b5a7f2e2acaa16be1c8d56d1eb2526599c6e0e5474e21870e`
- `public/brand/music/live-background.mp4` — SHA-256 `67508be37473a66f4436234403d8ce9bb1abe1e1df97365d747bd431dcde9f92`

The wallpaper attachment available to the workspace was the Thorfinn/Vinland image above; the separately named `wp15162277-black-and-white-anime-4k-laptop-wallpapers.webp` was not available. No generated or substitute asset was used.

## Validation (Node 22)

| Check | Result |
| --- | --- |
| Prisma schema validation | Passed |
| TypeScript typecheck / Prisma generate | Passed |
| Unit and regression tests | 302 passed, 0 failed |
| Production smoke suite | 22 groups passed (disposable SQLite/uploads only) |
| Additive schema preservation check | Passed |
| Scramjet asset/version check | Passed (7 assets) |
| Production build | Passed |
| Lint | Existing repository backlog remains: 139 errors, 896 warnings |

## Remaining production verification / limitations

- Configure valid server-side Audius credentials if the deployed API plan requires them, then verify real upstream playback.
- Synnime and SynnFlix retain their recovered integration paths. A native Anikura or CineB provider contract was not available in this checkout, so those provider replacements are not represented as complete.
- Scramjet's signed-in Wisp handshake and installed asset matching are covered; external navigation through the final Nginx deployment still needs deployment-environment verification.
- The device control is a privacy-conscious first-party device identifier, not an invasive hardware fingerprint. Clearing site storage creates a new association; account bans remain server-enforced.
- Final Chromium testing should be performed with a real signed-in Chrome profile to verify its password-manager vault behavior, touch pinch gestures, external media providers, and target production reverse proxy.
- No production deployment was performed.
