# Foundation r7 — privacy, account security and Synnical Lab

This release adds the server-enforced foundations for the privacy/security and experimental-rollout items in the Synnical roadmap. It deliberately ships working infrastructure rather than placeholder controls.

## Privacy

- Account privacy presets: Everyone, Friends, Close Friends and Private.
- Per-category rules for profile, online presence, activity details, connections, birthday, pronouns, game activity, music activity and profile statistics.
- Per-friend overrides with Allow all, Standard, Limited, Hidden and Custom modes.
- Custom per-friend rules can inherit the account default or explicitly show/hide each category.
- “What can they see?” simulation calculates the same effective server-side policy used by profile and presence APIs.
- Profile, directory, friends and Socket.IO presence paths apply privacy before data is returned/broadcast.
- A short-lived server cache bounds repeated privacy lookups during presence fan-out and is invalidated when settings change.

## Account security

- Sessions now retain a user-facing device name, user-agent summary and last-seen timestamp.
- The Devices and Security settings pages use real server-side sessions, including rename and remote sign-out.
- Sensitive actions require password re-entry.
- Emergency account lockdown blocks new chat messages, scheduled messages, direct credit transfers and cosmetic gifts.
- Recovery codes are single-use alternate sign-in credentials. Generating a new set invalidates older unused codes; raw codes are shown once.
- Security events provide a private account timeline and a downloadable JSON security report.
- A security score/checklist is based only on controls Synnical can actually verify.

## Synnical Lab and feature flags

- Feature flags have independent enabled state, deterministic percentage rollout and Lab-only mode.
- Staff can explicitly enroll/remove testers without changing their account role.
- Lab testers can vote Ship it / Needs work, file experiment-specific bug reports and opt out to return to the stable experience.
- An explicit opt-out overrides enrollment/rollout for that user.
- The Lab navigation item is hidden from ordinary users unless they are eligible for an active Lab experiment; administrators can manage experiments.
- Runtime code can query the enabled flag set for the signed-in account, providing the gate future experimental features will consume.

## Deliberately not claimed in r7

These roadmap items need additional signals or infrastructure and are not represented by fake toggles in this release:

- approximate-region session map;
- new-device approval and trusted-device lifecycle;
- impossible-travel and behavioural-anomaly detection;
- staff-tool PIN;
- high-risk restricted login mode;
- marketplace trade freezing, because the marketplace/trading system does not exist yet.

The emergency lockdown does cover the outgoing message and current credit/gift paths that exist today. Later security releases can extend the same policy to future trading and recovery systems.

## r7.1 preflight compatibility correction

The privacy and emergency-lockdown policy modules are intentionally shared by Next server routes and the custom Node/Socket.IO server. r7.1 removes the Next-specific `server-only` sentinel from those two shared modules so the custom-server import preflight can load them under `tsx`. They remain server-side modules by dependency and import architecture. A regression test now guards this boundary. No Prisma schema or feature behavior changed from r7.

## r7.2 TypeScript preflight correction

The account-directory route now explicitly types its redacted user accumulator as `SafeUser[]`. TypeScript otherwise infers an empty unannotated array in this async route as `never[]` during the full production `tsc --noEmit` gate, even though the runtime objects are valid `SafeUser` values. This is a compile-time typing correction only; privacy behavior, Prisma schema and production data semantics are unchanged from r7.1. A regression test guards the typed accumulator.
