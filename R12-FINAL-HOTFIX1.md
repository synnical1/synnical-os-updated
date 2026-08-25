# Synnical OS r12 Final - VPS TypeScript Hotfix 1

The first production-safe VPS installer stopped before deployment when `npx tsc --noEmit` found three type errors. Production remained untouched.

Fixes:

- `DmInfo` now carries the real DM partner `pfpUrl` as `otherAvatar` for the pinned-DM desktop widget.
- Battery performance mode explicitly narrows nullable Battery API values before comparing the charge level.
- Desktop persisted order IDs are narrowed when checked against the `Panel`-keyed application registry.

These changes are type-boundary corrections only; they do not alter production data or database schema.
