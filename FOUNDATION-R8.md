# Foundation r8 — Moderation & Staff Operations

Release: `synnical-r19-moderation-audit-r8-20260817`

## Central append-only audit trail

r8 introduces a snapshot-based `AuditLog` table and a read-only staff API. Audit rows deliberately have no foreign-key relation to actor or target accounts, so historical evidence survives later account deletion or role changes.

New staff actions are recorded at their actual mutation source, including:

- warnings and automatic warning-threshold punishments;
- direct mutes and unmutes;
- staff bans and account deletion;
- staff credit additions/removals with before/after balances;
- role changes, owner verification and custom-tag changes;
- report resolve/dismiss actions;
- profile-media approval/decline decisions;
- staff deletion of another user's message;
- Synnical Lab feature-flag changes and tester enrollment/removal;
- staff-created announcement channels;
- removal of an infraction record, while preserving the audit evidence that it happened.

The Moderation audit UI supports server-side search, category/action filters, before/after details and paginated retrieval. No POST/PATCH/DELETE audit-log endpoint exists for normal staff.

Historical records that predate r8 are not fabricated into the new table because their original actor-role/value snapshots cannot be reconstructed faithfully. Existing legacy infraction/report/credit records remain available in their existing systems.

## Scalable member management

`/api/roles/users` is now a server-side searchable and paginated staff directory instead of a fixed first-200-user dump. It supports username, display-name, account-ID and role search plus real role/mute/staff/member filters.

Both Moderation and Settings → User Management consume that paginated API. The warning picker in Reports & Actions also queries the server instead of filtering only a locally loaded subset.

## Moderation workspace

The main Moderation panel is now tabbed:

1. **Members** — searchable/paginated account directory and staff account/credit controls.
2. **Reports & Actions** — the previously unmounted reports/infractions workflow, including warning issuance and report review.
3. **Media** — pending profile-media approvals.
4. **Audit Logs** — central immutable staff-action history.

This avoids requiring staff to scroll through unrelated panels or hundreds/thousands of accounts to reach the user they need.
