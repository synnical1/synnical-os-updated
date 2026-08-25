# Synnical runtime bug batch — 2026-08-18

Implemented together after production smoke testing:

- SynnFlix Continue Watching now flushes on visibility loss/pagehide/close with keepalive persistence, survives ad/redirect focus changes, and can reopen a stale completed row only from verified active replay progress. Ads and redirects are not blocked.
- Inline poll cards no longer hit the `channelId required` gate before resolving their message-linked poll.
- Chat uses an optimistic local row while the server moderation/persistence pipeline completes and reconciles the real row when it arrives. Ordinary typing avoids redundant React state setters.
- Staff-only guided `/mute`, `/warn`, `/ban`, `/unban` commands are available in Chat, with user lookup, reason, mute duration parsing, existing server hierarchy enforcement, infractions, identity-ban behavior, and audit logs. Unban now records the supplied reason.
- Rich Presence now flows over existing authenticated presence sockets and privacy filtering for active SynnFlix watching, Synnical Games sessions, and Synnical Music playback. It appears in Chat's people rail and profile cards.

No Prisma schema change is required by this batch.

## Final hardening before packaging

- Continue Watching now treats an `ended` event as completion only when playback is actually at >=92% of a credible duration. Early `ended` events caused by provider/ad frame teardown are persisted as interrupted playback instead of deleting the resume entry.
- Progress also flushes on window blur, visibility hide, pagehide, and explicit close. Ads and redirects are not blocked or modified.
- Rich Presence is source-aware (`games`, `synnflix`, `music`) inside a tab and socket-aware across multiple Synnical tabs, so one mounted/idle app or tab cannot erase another active app’s presence.
- Optimistic Chat sends carry a client nonce echoed by the socket server, so identical back-to-back messages reconcile against the correct pending row and send failures remove only the matching optimistic message when possible.
- Guided moderation focuses the username field first, then duration for `/mute`, then reason; Enter can submit once the required fields are valid.
- The runtime regression file is included in `npm run test:release`.
