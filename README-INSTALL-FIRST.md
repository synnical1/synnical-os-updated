# Start here — recovered Synnical source

Use `DEPLOY-ORACLE-ARM64.md` for the new Ubuntu 24.04 ARM64 VPS.
Read `RECOVERY-REPORT.md`, `VALIDATION-REPORT.md` and `.env.example` before installation.

The source starts at GitHub commit `839d810951898ef51e3df282cdc2d11ce15fb669` (2026-08-25), with the documented recovery fixes applied.
No production database, users, uploads, secrets, dependencies or previous build output are included.

All 295 repository tests and the production build pass. Executed server/API and browser checks, plus external-provider and ARM64 limits, are documented in `VALIDATION-REPORT.md`. Do not interpret the older release validation documents as current results.

The recovered application tree was first published at commit `39890b6cb0f3103c6b0c006641a87dc395563a3b`, matching `SYNNICAL-RECOVERED-LATEST-20260915.zip`. Later commits only correct recovery/deployment documentation before the branch is merged.

`install-full.sh`, `install-main-batch1.sh`, `DEPLOY-FULL.md`, `FULL-RELEASE-MANIFEST.md` and `MAIN-BATCH1-SOURCE-MANIFEST.sha256` are historical material. They describe the old VPS and stale release trees. Do not run those installers for this recovery; they can reuse dependencies from the old architecture. The new guide uses a clean lockfile install.
