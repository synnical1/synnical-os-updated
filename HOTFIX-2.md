# Synnical r15 Hotfix 2

This package is identical to Hotfix 1 at application-source level, with one installer correction:

- Hotfix 1 removed the legacy `/api/synnflix/player` wrapper so SynnFlix can embed Vidking directly.
- The transactional installer's post-swap readiness check still expected that deleted wrapper to return HTTP 200.
- That stale check caused a healthy Hotfix 1 deployment to be rolled back when the route correctly returned HTTP 404.
- Hotfix 2 treats HTTP 404 from the legacy wrapper as the expected healthy state and reports `synnflix=direct(legacy-player=404)`.

No Prisma major-version upgrade is included or required. Prisma Client remains pinned to the application's tested 6.19.3 dependency set and is regenerated from the staged schema during both preflight and production schema-sync.
