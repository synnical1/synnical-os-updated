# Synnical

**Recovery 2026-09-15:** start with [README-INSTALL-FIRST.md](README-INSTALL-FIRST.md), [RECOVERY-REPORT.md](RECOVERY-REPORT.md) and [DEPLOY-ORACLE-ARM64.md](DEPLOY-ORACLE-ARM64.md). All 295 repository tests pass; see [VALIDATION-REPORT.md](VALIDATION-REPORT.md). Older release documents below are historical claims, not the results of this recovery.

Synnical is a self-hosted social/community web application built with Next.js, React, TypeScript, Prisma/SQLite, Socket.IO and a custom Node server. This tree is the **consolidated full-source release**: the cumulative hotfix lineage has been merged into normal source files instead of being shipped as another overlay installer.

## Release identity

- Build: `synnical-recovered-20260915-839d810`
- Version: `0.8.1-recovery.20260915`
- Runtime: Node.js 22
- Web: Next.js 16.3 / React 19
- Data: Prisma 6.19 / SQLite
- Realtime: Socket.IO
- Process manager: PM2
- Reverse proxy: Nginx or Caddy

## AI providers

Synnical AI and Synn Bot completions use the shared provider pool:

1. OpenRouter
2. Groq fallback
3. Gemini fallback

OpenAI is **not** part of the completion pool. It remains available for moderation and voice transcription only. Unsupported names in `AI_PROVIDER_ORDER`, including `openai`, are discarded by the runtime.

## Major product areas

The consolidated application contains Chat/DMs, Friends and profiles, roles/moderation, shop/economy, Synn Bot, Games/Stratus cloud sessions, the Scramjet/Wisp browser, SynnFlix, Music, temporary mail, Global Search and the owner-only System Health panel.

The 100 newly consolidated features and their release-gate coverage are documented in [`FEATURE-COVERAGE-100.md`](FEATURE-COVERAGE-100.md).

Foundation r6 added account-persisted social presence/activity controls plus global accessibility and adaptive interface-performance settings. See [`FOUNDATION-R6.md`](FOUNDATION-R6.md).

Foundation r7 adds server-enforced privacy, real account-session/recovery/lockdown controls and the Synnical Lab/feature-flag foundation. See [`FOUNDATION-R7.md`](FOUNDATION-R7.md).

Foundation r8 adds the append-only staff audit trail, a tabbed Moderation workspace, and server-side searchable/paginated member management. See [`FOUNDATION-R8.md`](FOUNDATION-R8.md).

Foundation r9 adds the friendship/duo social layer: friendship XP and levels, unlocked duo titles, shared duo cards, scrapbook memories, collaborative goals, reconnect signals, and honest Synnical-based taste matching. See [`FOUNDATION-R9.md`](FOUNDATION-R9.md).

Mega Expansion r10 adds temporary collaborative Spaces, account-backed SynnFlix progress and stable fullscreen episode transitions, game/media/music social tools, transactional cosmetic marketplace and two-sided trades, savings/shared credit goals, user automations, personas/profile history, spoiler-tagged chat, Creator Studio, Browser workspaces/split view, WebRTC Calls, trusted-device controls, scoped developer API tokens and the shared command-palette/app-registry foundation for the next OS-shell release. See [`MEGA-R10.md`](MEGA-R10.md).

Synnical OS r11.5 is the direct/default desktop experience: Start, taskbar/system tray, Quick Settings, real app windows, snapping, Task View, virtual desktops, notifications/calendar, Synnical Files, dedicated Synnical Settings, per-account desktop/lock wallpapers, first-class YouTube and GeForce NOW apps, a functional touch keyboard and all permitted apps directly on the desktop. r11.5 additionally repairs stale Continue Watching timestamps across local/account stores, keeps resume diagnostics off the video surface, removes permanent desktop icon boxes in favor of adaptive high-contrast icons, and adds standards-compliant first-interaction fullscreen plus an installable fullscreen manifest while retaining the r11.4 chat/badge/wallpaper fixes. See [`OS-R11.md`](OS-R11.md).

## Data and runtime separation

Production user state is intentionally not part of this repository/ZIP:

- `.env` contains deployment secrets and stays on the server.
- The recovered Oracle/SQLite deployment uses `DATABASE_URL=file:/var/lib/synnical/database/synnical.db`; keep the database outside the source tree.
- User uploads stay outside the deploy tree at `/var/lib/synnical/uploads` by default.
- `stratus/sites.json` is private operator configuration and is intentionally not committed. The browser-visible Stratus site identifier is supplied through `NEXT_PUBLIC_STRATUS_API_KEY` at build time.
- `node_modules` and `.next` are build/runtime products and are not shipped in the source ZIP.

## Safe database commands

For a fresh recovered deployment, use:

```bash
npm run db:init
npm run db:generate
```

For later schema updates, back up SQLite first, review Prisma's warnings, then use `npm run db:push` only when the proposed change is understood. The recovery intentionally does **not** use `--accept-data-loss` automatically and does not define a `db:push:unsafe` script.

## Release validation

```bash
npm run check:env
npm run check:proxy
npm run typecheck
npm test
npm run build
npm run test:smoke
```

`npm run release:gate` runs Prisma validation, type checking, the complete repository test suite and the production build. The recovery validation recorded 295 passing repository tests and 21 passing live smoke groups; actual ARM64 deployment and configured external providers still require deployment-time verification.

For production deployment, use [`DEPLOY-ORACLE-ARM64.md`](DEPLOY-ORACLE-ARM64.md). `DEPLOY-FULL.md`, the old installer scripts and older release manifests are historical only and must not be used to deploy this recovery.

r11.2 fixed the OS account-avatar type boundary found by VPS preflight by using the existing `SafeUser.pfpUrl` contract throughout desktop and Settings surfaces. r11.3 keeps that contract and adds service-pack regressions for the new OS/security/media/cloud wiring.
