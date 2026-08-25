# Synnical Final Hotfix 2 — Runtime fixes

Date: 2026-08-18
Package version remains 0.8.0.

## Fixed
- SynnFlix Continue Watching: accept trusted Vidking PLAYER_EVENT messages even when nested player frames are the MessageEvent source; keep origin/media identity validation; treat Vidking `progress` as percent rather than seconds when currentTime is unavailable.
- Desktop widgets: all widgets are opt-in by default. A one-time settings migration disables the accidentally default-on widget set for pre-hotfix settings; after migration, explicit user choices persist normally.
- Desktop widget stability: drag and resize now use explicit pointer gestures, persist only after actual drag/resize completion, clamp to the viewport, and avoid native CSS resize/state fights and pointer-up persistence on normal clicks.

## Local validation
- Historical + final + hotfix regressions: 134/134 pass.
- TypeScript/TSX syntax-transpile sweep: 288 files, 0 errors (declaration files excluded from transpile-only sweep).
- Full dependency-backed tsc/Next build must still be run on the VPS before restart.
