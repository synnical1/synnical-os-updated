# Mega Expansion r10

Build: `synnical-r21-mega-expansion-r10-1-20260817`

## r10.1 preflight compiler hardening

This build keeps the r10 feature set unchanged while correcting full-project TypeScript/Prisma boundary mismatches found by the isolated VPS preflight. It uses the actual Friendship requester/receiver fields, the existing MusicPlaylistTrack table without inventing a Prisma relation, explicit automation/market/client result types, redaction-safe session typing, and safe browser workspace state ordering.

This release intentionally groups the remaining pre-OS web foundations into one large integration release. New features are backed by authenticated APIs and persisted account data where persistence is required; transactional credit/cosmetic operations use explicit database transactions rather than generic feature storage.

## Social Spaces

- Temporary and persistent hangout, birthday, game, study, late-night, squad, movie-night and music-room spaces.
- Invite codes, membership, ready state, reactions/moods, scoreboards, shared clipboard/whiteboard/drawing state, timers/countdowns, jukebox voting, trivia/polls, team picking, notes/questions/link drops and room recap/archive records.
- Voting identity is derived from the authenticated server session.

## SynnFlix and media

- Stable outer fullscreen shell so episode/player iframe changes do not themselves destroy SynnFlix fullscreen.
- Account-backed movie/episode progress with existing local fallback.
- Media journal records, scene timestamp notes, bingo/prediction/rating foundations and progress comparison data.
- Chat supports explicit SynnFlix spoiler tags with title/season/episode metadata and expiry. Semantic spoiler detection is not fabricated.

## Games and music social

- Game backlog, journals, planning, finish goals, abandoned-game signals, roulette and Synnical-favourite-based group comparisons.
- Music social records for challenges, blind ratings/battles, bracket records, monthly soundtrack, memories, dares, first-listen notes and album checklists.
- Installed-game ownership scanning remains outside the browser product surface until a real native companion exists.

## Marketplace and credit tools

- Credit savings vault, lock dates, personal savings goals, shared credit pots, contributions, cancellation/refunds and monthly statements.
- Cosmetic resale listings, price watches/alerts, transactional purchases, provenance records and transfer cooldowns.
- Two-sided cosmetic/credit trade offers between accepted friends with reservation states, duplicate/ownership/listing/cooldown checks and atomic acceptance.

## Automations

- Account-backed trigger/action rules, enable/disable kill switch, preview, execution history, undo data where an action is reversible and friend-shared templates.
- Server triggers cover time, game launch, matching DM text, friend-online, credit threshold and panel activity.
- Browser-only actions are delivered through a signed-in pending-action queue instead of pretending the server directly controls the browser UI.

## Identity and profile studio

- Multiple personas, active/default persona, audience rules, profile snapshots/history, profile cards, generation/serial presentation, usage-derived Synnical DNA, visitor questions and friend-limited wall entries.
- Public profile responses apply the visible persona server-side for the requesting viewer.

## Messaging

- Priority conversations, snooze, deal-later state, private conversation notes, catch-up markers, participant statistics/top words/first-message date and downloadable conversation export.
- Explicit media spoiler metadata is persisted with the message and rendered hidden until reveal/expiry.

## Creator Studio

- Draft avatar/profile/particle prototype projects with live light/dark testing, transform/particle/keyframe state, version checkpoints/restore, duplication, accepted-friend collaborators, validation warnings and Draft/Beta states.
- Beta is an internal prototype state; this release does not falsely claim automatic Shop publishing.

## Browser workspaces

- Account-backed named browser workspaces, tab/group restoration, School/Gaming templates and real two-tab split-screen browsing.

## Calls

- Authenticated Socket.IO call-room/signalling layer with WebRTC voice/video media, up to six participants, mute/camera, push-to-talk, per-peer volume, screen sharing and low-bandwidth sender constraints.
- A public STUN fallback is built in. Operators can configure `NEXT_PUBLIC_WEBRTC_ICE_SERVERS_JSON` with TURN/ICE servers for restrictive networks.

## Security, developer and OS groundwork

- Password-confirmed temporary/permanent trusted-device state in the existing session security system.
- Scoped developer API tokens are hashed at rest, shown once at creation and currently expose read-only profile/friends/games endpoints.
- Ctrl/Cmd+K command palette and a shared Synnical app registry use the same permission-checked panel launcher path that the future OS shell can consume.

## Retention and deletion

- Account deletion explicitly cleans the new account-owned r10 records.
- Active shared pots owned by a deleted account refund other contributors transactionally before cleanup.
- Historical staff audit snapshots remain independent of deleted account rows.
