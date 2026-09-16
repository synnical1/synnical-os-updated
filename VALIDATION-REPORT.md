# Synnical recovery validation — 2026-09-15 package

Final validation completed on 2026-09-16. **All 295 repository tests pass, with zero failures, skips or cancellations. All 21 live smoke groups pass: 17 server/API groups and four headless browser groups.** Clean installation, Prisma, TypeScript, the production build and the release gate passed. The final application edits were followed by another full test run, production build and integrated browser/server smoke run.

The host was x86_64 Ubuntu 24.04 using Node 22.23.2. This is not an ARM64 execution result. PM2/systemd, Nginx/TLS, real third-party playback/cloud gaming, a configured VM, live TMDB/music/mail, paid AI services, camera/microphone hardware and Keyboard Lock were not exercised. They require the future host, credentials, hardware or interactive provider sessions. Static wiring checks are not end-to-end provider passes.

## Commands actually exercised

| Check | Result | Scope |
| --- | --- | --- |
| Read handoff README-FIRST.md | Complete before modifications | Supplied ZIP opened first; August 21 used only for comparison/reference |
| Exact GitHub checkout | Pass | Base `839d810951898ef51e3df282cdc2d11ce15fb669` |
| `npm ci --include=dev --include=optional` | Pass | Final lockfile, Node 22; clean installation, no old VPS output |
| `npx prisma generate` | Pass | Prisma 6.19.3; also runs in typecheck/build |
| `npx prisma validate` | Pass | SQLite schema including nullable chat nonce unique constraint |
| `npm run db:init` | Pass | New empty SQLite file, db push and generation; no seed |
| `npm run typecheck` | Pass | `tsc --noEmit --pretty false`; original strictness retained |
| `npm test` | **295 passed / 0 failed** | All `.test.mjs`, `.test.cjs`, `.test.ts` files through Node's runner and tsx |
| `npm run release:gate` | Pass | Prisma validation, typecheck, complete tests and production build |
| `npm run build` | Pass | Next.js 16.3.5 compilation, TypeScript, static generation and route discovery |
| `node scripts/smoke-recovery.mjs --browser-module=…` | **21 groups passed** | Production custom server, disposable database/uploads, real headless Chromium 153 |
| `npm run check:env` | Pass | All 58 inventoried JS/TS environment references documented |
| `npm run check:proxy` | Pass | Seven public Scramjet/controller files match installed package bytes |
| `node --check stratus/api.js` | Pass | Custom cloud-game service syntax |
| `bash -n install-full.sh install-main-batch1.sh` | Pass | Syntax only; historical installers not executed |
| `npm audit --json` | 0 reported vulnerabilities | Advisory snapshot during recovery, not a guarantee of no vulnerabilities |
| Native ARM64 dependency inspection | Package availability checked | Lockfile ARM64 variants and Prisma native target; no ARM execution claimed |
| Production deployment | Not performed | Explicitly outside this task |

A direct `prisma db push` against a nonexistent file initially returned an opaque schema-engine error here. Creating an empty SQLite file first resolved it. `db:init` now uses exclusive file creation and never truncates an existing database. The smoke test asserts zero users/messages immediately after schema creation.

The tsx CLI's Unix IPC listener is restricted here (`EPERM`), so tests and the live custom server use the supported `node --import tsx` hook. PM2's tsx launch form and `npm start` were not executed under that restriction. The same production `server.ts` entry point was exercised; verify PM2 startup and reboot on Oracle as documented.

## Baseline and retained tests

Before recovery, August 25 produced **290 tests: 241 passed, 49 failed** (178 JavaScript tests and 112 TypeScript tests). August 21 produced **265 tests: 224 passed, 41 failed** using the recovery Node/tsx/TypeScript tooling. That fallback run shared the installed toolchain; it was a comparison, not a clean fallback installation or evidence that all fallback features worked.

Five additional unit/regression tests cover upload serving, bounded settings, avatar coordinates and account hydration races. Integration coverage is separate from the 295-test count. No test files were deleted, skipped or converted into passing placeholders. TypeScript/build checking remains enabled.

Historical assertions were corrected only where the newer implementation or a verified repair superseded them:

- Continue Playing replaces the removed Game Planner/Session History UI. Newer tests explicitly require the old UI to remain absent; persisted game-history checks remain.
- The actual August 25 default is the static ink PNG, not the removed Sakura gallery or retired MP4 default. Current and removed assets remain checked.
- Media calls now include the active profile and use the explicit profile-aware reset endpoint. `activePlayback` is validated, and replay-reset failures are surfaced.
- Chat's uncontrolled draft uses `defaultValue`. History preserves pending/failed rows and reconciles by sender plus durable nonce. Assertions follow those stronger contracts.
- MIME assertions follow the shared serving helper. Live/unit requests verify authorization, content type, traversal, symlinks and byte ranges.
- Release identity assertions use the recovery identifier. Historical installer checks inspect the actual delegated installer, preserve the one-time-reset utility's own marker checks, and confirm fresh deployment does not execute that maintenance reset.
- Provider verification checks one code request followed by the current 40-attempt poll loop; an obsolete comment assertion was replaced with that executable-flow contract.
- Files checks follow the repaired API action names and UI. Unsupported native-folder operations remain explicitly unavailable. A removed unused desktop-map index and harmless source whitespace no longer cause false failures.
- Safe Mode and presence assertions follow app filtering and per-socket activity selection. Live tests cover multiple device sources, disconnect fallback and privacy-cache invalidation.

Other failures exposed incomplete behavior and were fixed in the implementation: Files recycle/restore/rename/ZIP, optional PIN security, desktop settings import/export and maintenance, editable shortcuts, accessibility, Browser address editing/suspension, moderation, rich presence and media indicators. The obsolete forced password-migration screen was removed because four pre-existing tests required its removal, registration already completed setup, and its legacy endpoints permitted password replacement without current-password confirmation. Optional secure recovery remains.

## Live smoke coverage

The runner creates random temporary credentials, a fresh SQLite database and an isolated upload directory. It starts the production custom server on a temporary port and removes its data afterward. The optional browser harness uses real Playwright/Chromium and blocks off-origin requests, so it cannot establish external-provider availability.

1. Clean schema creates an empty database.
2. Root shell, `/linux-vm` missing-configuration message and anonymous authentication behavior.
3. Registration/login and sanitized account responses.
4. PIN password-confirmed setup/removal, hashed storage, existing-session requirement and account-based rate limits across changing IP headers; PIN cannot replace sign-in.
5. Account settings persistence, account isolation and invalid/oversized write rejection.
6. Concurrent default-profile initialization, maximum 12 profiles and foreign-profile denial.
7. Profile-scoped lists/ratings/progress, monotonic progress, short ad-duration protection and completed replay reset.
8. Private screenshot ownership, validated rename, recycle/restore, active-file purge denial and permanent recycled-file deletion.
9. Image decode/resize/metadata stripping, inherited-avatar preservation and invalid image/symlink/private-directory rejection.
10. HTTP channel authorization, sanitized search/thread/saved responses and inline polls.
11. Socket.IO websocket send, duplicate-nonce idempotency, one stored message and reconnect history identity.
12. Socket.IO polling handshake with upgrade dispatch intact.
13. Multi-device rich presence retains active sources and falls back after disconnect; privacy changes cross Next/custom-server module boundaries.
14. Wisp accepts authenticated same-origin upgrades and rejects anonymous/cross-origin clients.
15. Owner verification and sanitized moderation responses.
16. Moderation staff authorization, duration validation and recorded ban/unban reasons.
17. Concurrent profile deletion always preserves one profile.
18. Browser UI: desktop launches Settings; cursor changes, JSON export, restore points and editable shortcuts work. Recording a shortcut does not execute it.
19. Browser UI: Files rename, ZIP download, recycle and restore use the real APIs.
20. Browser UI: address editing does not navigate; reloading starts with no restored windows.
21. Browser UI: Safe Mode limits apps and Recovery exposes the local reset action.

The browser run also asserts no uncaught application errors. It verifies the recovery reset control without deleting account data. Unit tests additionally exercise HEAD/byte ranges, rejected ranges, unsafe paths/content, bounded settings, all 100 avatar coordinates and delayed hydration across account switches.

## Remaining verification

There are no known failing repository tests at handoff. This is not a guarantee that every route or provider interaction is bug-free. Actual ARM64 installation, PM2/Nginx/TLS/reboot, external Scramjet navigation and playback progress, cloud provider/mail verification, credentialed music/AI/TMDB, WebRTC hardware and the configured VM remain deployment checks. Synn Drive remains the source's experimental preview, and the dormant Turso path has missing adapter dependencies; this recovery targets SQLite.

Repeat the commands on the future ARM64 host. The deployment guide explains the optional browser run. No Oracle hostname, production token, database, user upload, node_modules or .next output is packaged. Raw execution logs remain outside the source archive; this report records the commands, results, test-update rationale and limitations without bundling runtime output.
