# synnical-r16-playback-session-fix-r4-20260817

- Keeps the SynnFlix provider iframe mounted while watch-party state changes; party pause/resume no longer rewrites or hides the player.
- Uses real player events when creating a party instead of assuming playback is active.
- Adds explicit Sync to host and Reload player controls without exposing implementation details.
- Reconciles stale game-session rows, guarantees one live session per account, heartbeats active sessions, and closes tracked sessions on page exit.
