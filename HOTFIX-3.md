# synnical-r16-playback-session-fix-r4-20260817

Regression repair release based on `synnical-r15-hotfix2-20260816`.

## Fixed

- Active cloud games stay mounted when another Synnical panel opens. Game-focus chrome hiding is scoped to the visible Games panel, and releasing game input restores normal Synnical navigation without ending the game.
- Game/browser UI no longer exposes raw implementation names, error codes, or provider-oriented troubleshooting text in normal flows.
- SynnFlix no longer rebuilds its player URL on every playback `timeupdate`, which was remounting the iframe and causing playback to restart/stall around a few seconds.
- Watch parties use a user-facing invite-code flow with copy/paste guidance and a persistent **Copy invite** control.
- External profile connections are stored per authenticated Synnical account on the server rather than one browser-global `localStorage` key. Viewing another profile now loads that user's connection data instead of the viewer's. Legacy browser-only links are quarantined from profiles and can be explicitly imported into the signed-in account or discarded from Settings.
- New accounts start at 0 credits. The stale 500-credit signup transaction was removed.
- Deployment performs the requested one-time global credit reset against the staged production database, writes reset audit entries, and records a durable migration marker so later deployments do not reset balances again.
- The normal 1-credit reward for each successfully saved member message remains unchanged.
- Staff add/remove-credit controls are restored for lower-ranked accounts with hierarchy checks, non-negative balance enforcement, transaction history and `CreditAudit` entries.

## Safety

The installer still snapshots the SQLite database, validates the staged schema without `--accept-data-loss`, runs the reset only on the staged database before the atomic swap, verifies all balances are zero and the reset marker exists, and rolls back to the previous app/database if deployment validation fails.

## r2 preflight correction (2026-08-17)

- Restored the capability-gated Bitrate and Session invites status copy in the Games UI.
- The copy is user-facing only: it says whether controls are available without exposing provider/runtime names.
- This fixes the consolidated feature-contract regression that correctly blocked the first r16 package during preflight.
