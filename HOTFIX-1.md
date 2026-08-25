# Synnical r15 Hotfix 1

This hotfix is based on the validated r15 consolidated release and fixes the regressions reported after deployment.

## Fixes

- SynnFlix uses the documented direct Vidking iframe integration. The Synnical wrapper route, iframe sandbox, and global COOP/COEP response headers were removed from the player path.
- Browser no longer adds an extra HTML sandbox around Scramjet frames. Proxy startup now waits until the versioned service worker actually controls the current Synnical page before any `/~/` navigation can start. The proxy runtime version was bumped to force a fresh worker.
- The unused automatic ad-blocker installer was removed. Manual extension installation remains unchanged.
- Cloud game audio unlock is idempotent, so later ICE state transitions cannot show the audio prompt again after it has already been unlocked.
- Holding Escape for two seconds releases captured controls, exits browser fullscreen, and exposes Resume game / Back to games actions.

## Validation

- Consolidated feature/runtime tests: 112/112 passed.
- Cloud provider state-machine tests: 2/2 passed.
- Prisma schema validation and disposable database sync passed.
- Custom server imports passed.
- TypeScript passed.
- Next.js 16.3 production build passed with all 44 static pages generated.
- Inline cloud-player JavaScript passed `node --check`.

The installer stages and validates the release before touching production and preserves the existing production SQLite database and environment.
