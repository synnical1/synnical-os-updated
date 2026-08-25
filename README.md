# Synnical

Synnical is a self-hosted social/community web application built with Next.js, React, TypeScript, Prisma/SQLite, Socket.IO and a custom Node server. This tree is the **consolidated full-source release**: the cumulative hotfix lineage has been merged into normal source files instead of being shipped as another overlay installer.

## Release identity

- Build: `synnical-r22-synnical-os-r11-5-20260818`
- Version: `0.7.5`
- Runtime: Node.js 20+ (production currently uses Node 22)
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
- SQLite data stays under the deployment's `prisma/db` path.
- User uploads stay outside the deploy tree at `/var/lib/synnical/uploads` by default.
- `stratus/sites.json` is operator configuration and is preserved by the installer. The browser-visible Stratus site key is synchronized into `NEXT_PUBLIC_STRATUS_API_KEY` at build time.
- `node_modules` and `.next` are build/runtime products and are not shipped in the source ZIP.

## Safe database commands

```bash
npm run db:generate
npm run db:push
```

`db:push` is deliberately non-destructive. The explicitly named `db:push:unsafe` exists for development/operator use only and should never be used casually against production.

## Release tests

```bash
npm run test:release
```

This runs the 100-feature coverage/runtime suite and the bounded Stratus free-session state-machine tests.

For the production deployment workflow, use [`DEPLOY-FULL.md`](DEPLOY-FULL.md). Do not copy individual old hotfix files into this release.


r11.2 fixed the OS account-avatar type boundary found by VPS preflight by using the existing `SafeUser.pfpUrl` contract throughout desktop and Settings surfaces. r11.3 keeps that contract and adds service-pack regressions for the new OS/security/media/cloud wiring.
