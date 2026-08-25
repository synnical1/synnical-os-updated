# Foundation r9 — Friendship & Duo Social Layer

Release: `synnical-r20-friendship-social-r9-1-20260817`

## r9.1 preflight correction

The friendship feature set is unchanged. r9.1 only corrects a TypeScript boundary in the game-taste lookup by widening the static catalogue name map to `Map<string, string>` for database game IDs.

## What r9 adds

- User-controlled friendship labels such as `OG`, `duo` or `rival` without changing the existing private nickname/note model.
- A canonical shared FriendshipBond per accepted friend pair.
- Friendship XP and Duo Levels driven by durable direct-message activity.
- XP rate limiting: message statistics count every saved friend DM, while XP can increase at most once per minute per friendship.
- Existing friendships bootstrap from durable DM history rather than starting at zero after the upgrade.
- Shared Duo names and unlocked Duo titles.
- Shared Duo banner selection using either participant's existing profile banner, or the built-in Duo gradient.
- Duo profile card and statistics: message count, friendship date, mutual friends, last interaction and level progress.
- Persisted friendship milestones for message and Duo-level thresholds.
- Shared friendship scrapbook memories with `On this day` surfacing.
- Collaborative friendship goals with progress, completion and optional due dates.
- Reconnect signal after 14 days without a tracked interaction.
- Taste matching based only on data Synnical really owns:
  - Synnical game favourites.
  - SynnFlix watchlists/favourites.
  - Artists present in saved Synnical playlists.

## Privacy and ownership rules

- Every shared friendship API request re-checks that the two accounts are currently accepted friends.
- Private friend nicknames and notes are never returned by the shared Duo endpoint.
- Friendship labels are controlled by the viewing account through the existing FriendMeta record.
- Shared Duo settings can be changed only by one of the two current participants.
- Scrapbook memories and goals are visible to both participants, but destructive deletion is creator-owned.
- Unfriending immediately blocks access to the shared Duo API. Historical bond data is retained privately so a later reconnection can recover the relationship history instead of silently destroying it.

## Honest capability boundary

r9 does **not** claim to compare owned Steam/Epic/Xbox/local game libraries. That requires the future desktop companion/library scanner. The current `Game taste` score is explicitly sourced from Synnical game favourites.

## Schema changes

Additive only:

- `FriendMeta.label`
- `FriendshipBond`
- `FriendshipMemory`
- `FriendshipGoal`
- `FriendshipMilestone`

No existing columns or production tables are removed.
