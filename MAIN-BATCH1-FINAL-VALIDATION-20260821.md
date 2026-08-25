# Synnical Main-Site Batch 1 — Final Validation

Date: 2026-08-21 UTC

## Release boundary

This is the single main-site batch agreed on 2026-08-20. It contains the ten
requested bug-fix areas below. It does not retire or rebuild the `synnical-svg`
GitHub/jsDelivr publication links; that remains a separate second batch.

## Included fixes

1. Continue Watching is removed from active SynnFlix and desktop functionality,
   while ordinary local/server playback progress, stable player identity,
   autoplay, and watch parties remain.
2. Neutral desktop boot is restored; configured startup apps still work; newly
   launched apps start maximized with a valid Restore Down rectangle.
3. Windows-like app-open animation honors the existing animation scale,
   no-animation setting, and reduced-motion preference.
4. Profile statistics use `profile.showStats`, respect API privacy, and count
   real non-deleted Message rows independently from friends-list visibility.
5. Profile dialogs keep normal backdrop-click and Escape dismissal.
6. Staff, role, and recognition badges use the requested compact sizing.
7. Global asynchronous errors are diagnostic events instead of whole-shell
   crashes; per-panel ErrorBoundary isolation and readable retry controls remain.
8. Games rejects raw/non-JSON service responses with safe messages, and game
   focus cannot hide Synnical chrome after another panel is opened.
9. Stable SynnFlix playback/progress behavior is preserved, including monotonic
   server progress and protection from premature provider-ended events.
10. Linked connections remain server-backed and scoped to the signed-in account.

## Packaging/runtime hardening completed after the first candidate

- `tsx` is declared in the locked production dependencies.
- `npm start` and PM2 both run the checked-in custom `server.ts`.
- `next build` no longer copies a nonexistent `.next/standalone` directory.
- Prisma Client generation runs before normal builds.
- A focused `preflight:main-batch` command and packaging regression suite are
  included.

## Validation results

- Prisma schema validation: PASS.
- Prisma Client generation 6.19.3: PASS.
- TypeScript semantic check (`tsc --noEmit`): PASS.
- Main Batch 1 regressions: 13/13 PASS.
- Next.js 16.3.0 production build: PASS.
- Static generation: 47/47 pages PASS.
- Custom production server: reached ready state on the isolated test port.
- HTTP smoke checks: `/` = 200 and `/api/auth/me` = 200.
- Clean shutdown: PASS.
- `package.json` and lockfile root dependency ranges: exact match.
- No-mutation installer preflight simulation: PASS; the mock live app and
  SQLite data remained unchanged.
- Transactional install simulation: PASS; `.env`, Stratus configuration,
  every table count, OWNER identity, credit balances, and Message rows were
  preserved.
- Debian `mawk` response-header compatibility: PASS.
- Forced post-swap HTTP failure: automatic rollback PASS; the exact previous
  application and database were restored and the failed candidate retained.

The build retains one pre-existing Turbopack warning about dynamic filesystem
tracing in `src/app/api/features/os/wallpaper/route.ts`. It does not fail the
build and was not expanded into this bounded bug-fix batch.

## Historical-suite classification

Running every historical test file together produced 258 tests: 217 passed and
41 failed. Those failures are assertions for separate R12-final and 2026-08-18
runtime branches (plus their release metadata/contracts), not regressions in the
2026-08-20 Main Batch 1 scope. Pulling those branches into this archive would
violate the agreed one-controlled-batch boundary. The focused acceptance gate
for this archive is therefore `npm run preflight:main-batch`.

## Safety

All validation used disposable local paths. No production source, SQLite data,
uploads, PM2 process, Caddy configuration, Stratus private configuration, or SVG
publication repository was modified.

The final archive includes a batch-specific transactional installer. Its
preflight performs a clean locked install, disposable-database validation,
semantic TypeScript, the 13 focused tests, a production build, and an actual
custom-server HTTP smoke without stopping production. Installation repeats
those gates, preserves `.env`, SQLite rows and OWNER identities, credit
balances, uploads and Stratus configuration, then swaps the app and performs
post-restart HTTP checks with automatic rollback on failure. It contains no
credit reset and no SVG operation.
