# Synnical OS r12 Final — Implementation Report

Build: `synnical-r23-synnical-os-r12-final-20260818`  
Version: `0.8.0`  
Baseline: corrected Synnical OS r11.7 Batch 1

## Final-batch priorities delivered

### Account/security onboarding
- Removed the forced one-time password-change/security-migration gate.
- New registrations keep the password they chose during signup and are not immediately forced to change it.
- Normal voluntary password changes and forgotten-password recovery remain separate security flows.
- Added optional lock-screen PIN unlock for an already authenticated Synnical session; password unlock remains available and PIN attempts are rate-limited.

### SynnFlix Continue Watching
- Reworked player progress handling around provider-reported movie/season/episode identity.
- Provider auto-advance can update the active episode without Synnical rejecting the event because it differs from the iframe's original episode.
- Progress writes remain monotonic unless an explicit restart/reset is requested.
- Continue Watching receives the repaired progress state and remains account-backed.

### GeForce NOW / Games input ownership
- Immersive Games/GeForce NOW suppresses Synnical global shortcuts while the game owns input.
- Uses browser Keyboard Lock where available and keeps honest fallbacks where Chrome/ChromeOS reserves keys.
- Escape handling no longer deliberately routes through unrelated Synnical shortcuts while playing.

### OS, Chat and Browser responsiveness
- Chat composer input is isolated from the large Chat panel so ordinary keystrokes no longer drive the full panel state path.
- Typing/draft behavior remains throttled/debounced and socket listener cleanup is handler-specific.
- Browser address-bar typing is isolated locally until navigation.
- Inactive expensive Browser frames can suspend and restore on activation; split/current tabs are protected.
- Desktop window drag/resize hot paths avoid unnecessary React/localStorage churn.
- Battery/low-performance state reduces expensive effects and pauses live wallpapers when appropriate.

### Desktop/taskbar/window UX
- Removed taskbar hover thumbnail/preview rectangles globally at the user's later request.
- Removed permanent dark pills behind desktop shortcut labels while preserving readable text contrast.
- Standardized real minimize, maximize, restore and close window controls.
- Dynamic persistent workspaces and workspace-specific layout/wallpaper state are implemented.
- Desktop widgets have real data sources and persisted movable/resizable layout.

### Files / Recycle Bin
- Synnical-owned screenshots now soft-delete into a real Recycle Bin.
- Restore, permanent purge, rename, multi-select, history, pinned locations and ZIP creation for Synnical-owned screenshots are wired.
- Recycle Bin auto-clean and F2 rename behavior are present.
- Older screenshot deletion paths were aligned so they do not bypass the bin unintentionally.

### Personalization, utilities and accessibility
- Safe MP4 live wallpapers, slideshow/shuffle and performance-aware pausing.
- Persistent window opacity/corner/animation presentation settings.
- Editable OS shortcuts, Start folders/search history/aliases, Run and Synnical Task Manager surfaces.
- Browser-permissioned capture/recording, voice typing and touch-keyboard themes.
- Settings export/import, local restore points, startup apps, app repair/cache/remove/restore.
- Quick Settings theme and live presence controls.
- Synnical-owned microphone/camera/screen privacy indicators and local privacy history.
- Accessibility color filters, reduced transparency, UI zoom and native-video caption styling.

### Preserved critical fixes
- Staff AutoMod protection and audited unban path from Batch 1 remain regression-covered.
- Moderation audit-log recursion fix remains covered.
- Settings routing/stale-search fix remains covered.
- Games verification cooldown/no-resend behavior remains in source.
- Profile/account message counts remain derived from authoritative Message rows.
- Extensions/Sapphire runtime/UI/API removal remains intact.

## 250-feature audit

The complete conservative item-by-item audit is in `R12-FINAL-250-FEATURE-AUDIT.md`.

Status totals:
- 179 IMPLEMENTED
- 8 IMPLEMENTED — SYNNICAL EQUIVALENT
- 44 PARTIAL
- 3 BROWSER/PROVIDER LIMITED
- 1 REMOVED BY USER REQUEST
- 15 NOT IMPLEMENTED

A feature is not marked implemented merely because UI exists. Later user overrides supersede older backlog requirements, most notably removal of taskbar hover previews.

## Production-data compatibility

The release does not intentionally delete production users, messages, DMs, roles, friendships, economy data, profiles, uploads, security data or SynnFlix progress. Prisma/schema changes must still be validated against a cloned production SQLite database before production deployment. Destructive Prisma approval must not be used blindly.
