# August 21 → August 25 source comparison

Latest comparison point: `839d810951898ef51e3df282cdc2d11ce15fb669`. All paths below are relative to the source root. The comparison uses file contents from the fallback archive against tracked GitHub files, not the stale manifests.

Added: **18**; removed: **6**; changed: **67**; unchanged: **350**.

## Added

- `public/brand/wallpapers/synnical-default-wallpaper.mp4`
- `public/brand/wallpapers/synnical-static-ink-wallpaper.png`
- `public/synnflix/profile-atlas-v1.webp`
- `src/app/api/chat/image/upload/route.ts`
- `src/app/api/features/media/profiles/route.ts`
- `src/app/api/features/media/profiles/upload/route.ts`
- `src/app/api/features/settings/route.ts`
- `src/app/linux-vm/page.tsx`
- `src/components/linux-vm-panel.tsx`
- `src/components/synn-drive-panel.tsx`
- `src/components/synnime-panel.tsx`
- `src/lib/ad-shield.ts`
- `src/lib/synnflix-profiles-server.ts`
- `src/lib/synnflix-profiles.ts`
- `tests/regressions-20260821-account-profiles.test.mjs`
- `tests/regressions-20260821-avatars-ad-shield.test.mjs`
- `tests/regressions-20260821-experience-batch.test.mjs`
- `tests/regressions-20260821-scramjet-wiring.test.mjs`

## Removed

- `public/brand/wallpapers/sakura-samurai-1.png`
- `public/brand/wallpapers/sakura-samurai-2.png`
- `public/brand/wallpapers/sakura-samurai-3.png`
- `public/brand/wallpapers/sakura-samurai-4.png`
- `src/app/api/uploads/[...path]/route.ts`
- `src/components/games-social-panel.tsx`

## Changed

- `.gitignore`
- `Caddyfile`
- `MAIN-BATCH1-SOURCE-MANIFEST.sha256`
- `next.config.js`
- `package-lock.json`
- `package.json`
- `prisma/schema.prisma`
- `public/sw.js`
- `server.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/features/automations/route.ts`
- `src/app/api/features/browser/route.ts`
- `src/app/api/features/chat/route.ts`
- `src/app/api/features/media/route.ts`
- `src/app/api/features/music/route.ts`
- `src/app/api/features/os/route.ts`
- `src/app/api/features/os/wallpaper/route.ts`
- `src/app/api/synnflix/home/route.ts`
- `src/app/api/synnflix/search/route.ts`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/components/ad-injector.tsx`
- `src/components/app-shell.tsx`
- `src/components/automation-bridge.tsx`
- `src/components/automations-panel.tsx`
- `src/components/browser-panel.tsx`
- `src/components/chat-panel.tsx`
- `src/components/desktop-shell.tsx`
- `src/components/games-panel.tsx`
- `src/components/music-panel.tsx`
- `src/components/presence-bridge.tsx`
- `src/components/role-ui.tsx`
- `src/components/security-setup-screen.tsx`
- `src/components/settings-extra-sections.tsx`
- `src/components/settings-panel.tsx`
- `src/components/synnflix-panel.tsx`
- `src/components/synnical-settings-app.tsx`
- `src/components/user-profile-modal.tsx`
- `src/hooks/use-auth.tsx`
- `src/hooks/use-scramjet.ts`
- `src/lib/api.ts`
- `src/lib/app-registry.ts`
- `src/lib/auth-server.ts`
- `src/lib/chat-server.ts`
- `src/lib/content-moderation.ts`
- `src/lib/db.ts`
- `src/lib/feature-api.ts`
- `src/lib/identity-ban.ts`
- `src/lib/os-settings.ts`
- `src/lib/presence.ts`
- `src/lib/proxy-runtime.ts`
- `src/lib/recognition-tags.ts`
- `src/lib/settings-runtime.ts`
- `src/lib/synn-bot-ai.ts`
- `src/lib/synn-bot-features.ts`
- `src/lib/synn-bot.ts`
- `src/lib/synnflix-tmdb.ts`
- `stratus/api.js`
- `tests/cloud-free-flow.test.cjs`
- `tests/consolidated-100-features.test.ts`
- `tests/consolidated-runtime.test.ts`
- `tests/regressions-20260818-r12-final.test.mjs`
- `tests/regressions-20260818-runtime-batch.test.mjs`
- `tests/regressions-20260820-main-batch.test.mjs`
- `tests/regressions-20260821-main-batch-packaging.test.mjs`
