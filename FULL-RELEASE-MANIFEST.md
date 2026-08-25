# Full release contents and consolidation policy

This package is a complete cumulative source release, not a patch overlay.

## Included

- Complete `src/` application source and custom `server.ts`.
- Prisma schema and non-destructive deployment tooling.
- Public Scramjet/controller/game/brand assets and cloud-game runtime configuration example.
- Package manifests/lockfile, PM2 configuration, reverse-proxy examples and build configuration.
- Consolidated 100-feature/runtime tests plus cumulative 2026-08-17 regression tests.
- Transactional `install-full.sh` with isolated preflight, SQLite backup/staging, atomic app swap, rollback and live readiness checks.
- Current deployment/validation docs and cumulative foundation notes through r9.
- `MEGA-R10.md` documenting the r10 social/media/economy/automation/creator/browser/calls/security/developer expansion.
- `OS-R11.md` documenting the r11.5 direct/default Synnical OS desktop, Settings/Files, wallpapers/themes, security migration/recovery, first-class apps, touch keyboard, taskbar/Start/Quick Settings and hardened SynnFlix resume repair.

## Deliberately excluded

- `node_modules/` and `.next/` build outputs.
- `.env` and production secrets.
- Production SQLite/WAL/SHM files.
- User uploads/private media.
- `.git/`, backup copies and local build artifacts.
- Live `stratus/sites.json`; the installer preserves the operator's production configuration.
- Obsolete patch installers and superseded generated settings catalogs.

The behavioural effects of previous releases are merged into the normal source tree. Historical release ZIPs are not runtime dependencies.
