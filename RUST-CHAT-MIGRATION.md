# Synnical Rust migration: chat service tranche 1

This change starts a real Rust service against the existing production SQLite database. It is not a claim that every Synnical subsystem or every chat feature has already been ported.

## What is migrated in this tranche

- Rust owns the chat channel-list read model.
- Rust owns the paginated message-history read model (50 messages, chronological response, ISO-8601 cursor).
- Rust validates the existing `stratus_session` cookie or supported Bearer session token against the live `Session` and `User` tables, checks expiry, and independently requires the live database role to be `OWNER`.
- The Next.js route is a same-origin compatibility adapter. It forwards only the caller's session credentials to the loopback Rust service.
- The existing ChatPanel is restored for the OWNER account only. The taskbar Start-menu account entry becomes **Sign in** for guests and **Profile** for signed-in users.
- All remaining chat REST feature routes and Socket.IO channel access are owner-gated. Channel management is also owner-only.

## Deliberately not represented as migrated yet

The existing TypeScript Socket.IO server still owns realtime delivery, typing, presence, sends, edits, deletes, reactions, calls/watch parties, scheduled messages, Synn Bot workflows, and the rest of the rich feature surface. The existing TypeScript feature route continues to own advanced chat actions such as threads, polls, saved/scheduled messages, search, and channel preferences. The React ChatPanel remains the UI.

Those pieces must be moved behind Rust domain services with compatibility tests before the Node chat implementation can be retired. Keeping the established protocol alive during the transition avoids silently dropping existing functionality.

## Service contract

- Bind: `127.0.0.1:4401` by default. Do not expose the Rust service publicly.
- Health: `GET /health`
- Channels: `GET /v1/chat/channels`
- History: `GET /v1/chat/messages?channelId=<id>&before=<RFC3339 timestamp>`
- Database: the same `DATABASE_URL` used by Prisma. The Rust process is read-only for the migrated endpoints.
- Owner gate: session is resolved from the current database on every request. Browser-supplied role names are never trusted.

## Local development

Install a stable Rust toolchain, set `DATABASE_URL` to the same SQLite database as Synnical, then run:

```bash
cargo fmt --manifest-path rust/synnical-chat/Cargo.toml
cargo test --manifest-path rust/synnical-chat/Cargo.toml
cargo run --manifest-path rust/synnical-chat/Cargo.toml
```

The Next.js adapter uses `SYNNICAL_RUST_CHAT_URL`, defaulting to `http://127.0.0.1:4401`.

## Next migration gates

1. Port message send/edit/delete and rate-limit/idempotency rules.
2. Port moderation, mention parsing, DM/block checks, attachments, reactions, threads and poll transactions.
3. Port the Socket.IO-compatible realtime domain events and verify reconnect/history consistency.
4. Port remaining chat feature APIs and only then remove the TypeScript chat service.
5. Run the complete Synnical release gate plus live owner/non-owner tests before production rollout.
