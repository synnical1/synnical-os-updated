# Synnical OS r12 Final — Known Limitations

Build: `synnical-r23-synnical-os-r12-final-20260818`

The 250-feature audit intentionally does not claim complete implementation of every aspirational backlog item.

## Browser/platform limits

- A browser app cannot guarantee interception of ChromeOS/browser-reserved shortcuts. GeForce NOW/Synnical game mode suppresses Synnical-owned shortcuts and uses Keyboard Lock where available, but reserved system/browser combinations remain outside Synnical's authority.
- Synnical can expose only browser-permissioned hardware/capture state. It cannot inspect arbitrary native Chromebook applications or native OS processes.
- File Explorer operates on Synnical-managed files; it does not claim unrestricted host-filesystem access.
- Synnical Task Manager reports Synnical/browser-visible activity rather than fake native operating-system processes.

## Audit leftovers

See `R12-FINAL-250-FEATURE-AUDIT.md` for every PARTIAL, BROWSER/PROVIDER LIMITED and NOT IMPLEMENTED item. Current totals are 44 partial, 3 browser/provider-limited and 15 not implemented. One original backlog feature, taskbar hover previews, is intentionally removed by later user request.

## Validation environment limit

This artifact workspace has no project `node_modules`, so the following dependency-backed checks could not honestly be executed here for r12:

- `npm ci`
- project-local `npx tsc --noEmit`
- `npx prisma generate`
- `npx prisma validate`
- Prisma compatibility/db-push check against a cloned production database
- the complete `npm run test:release` command as written
- real Next.js production build
- dependency-backed cloud-flow test (`express` is unavailable in this artifact workspace)

Those checks must be run in the isolated VPS preflight before production deployment. The package must not be treated as VPS-build-validated until they pass there.
