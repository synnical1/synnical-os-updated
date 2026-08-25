# Validation

Release candidate: `synnical-r22-synnical-os-r11-5-20260818`

## r11.5 packaging-workspace gates

The source-package workspace must pass before the ZIP is handed off:

- source manifest verification
- recognition-badge permission neutrality, Owner/Head Admin assignment boundary and chat/profile propagation
- Continue Watching no-remount-after-load/playback regression plus protected saved-position recovery
- chat quote-to-composer, auto-published inline poll and hot-row performance regressions
- wallpaper #2 default, four-wallpaper gallery, bright-wallpaper icon contrast and taskbar-menu anchoring
- cumulative regression suite, including the exact r11 nullable SynnFlix preflight failure
- r11.2 SafeUser profile-image boundary regression remains active: OS surfaces use the existing `pfpUrl` contract and never a nonexistent `avatar` field
- consolidated 100-feature source/runtime coverage where dependencies are available
- TypeScript/TSX whole-tree parse/transpile checks
- shell syntax, JSON/package-lock validation and JavaScript syntax checks
- custom-server shared-module `server-only` boundary scan
- Synnical OS default/account preference wiring
- Synnical Settings category/branding checks
- Synnical Files authenticated endpoint wiring and capability honesty
- taskbar/Start/Quick Settings/lock/notification/desktop-window regressions
- direct-to-OS regression proving the five-`W` activation gate is absent
- SynnFlix protected-resume and bounded slow/black-player retry wiring
- desktop/lock wallpaper upload, fit modes, theme selection and supplied default wallpaper
- mandatory one-time security setup, change-password and two-factor recovery-proof flow
- presence regression proving real online/offline state cannot be privacy-hidden
- all-permitted-app desktop registry, YouTube/GeForce NOW app wiring and no Tools folder
- touch-keyboard preserved-focus text insertion
- same-mailbox cloud verification resend before bounded fresh-mail fallback
- no virtual-machine feature surface

The final ZIP is extracted into a fresh verification directory and the portable gates are repeated against that extracted archive.

## VPS preflight authority

Full dependency-backed Prisma validation/client generation, disposable database sync, semantic `tsc --noEmit`, custom-server imports, consolidated runtime tests, cloud-flow tests and the Next production build remain mandatory in the isolated VPS preflight before production installation.

A successful package-level check does not authorize deployment by itself. Production is only eligible for installation after:

```text
PREFLIGHT_CUSTOM_SERVER_IMPORT_OK
PREFLIGHT_SHADOW_BUILD_OK
PREFLIGHT_OK: synnical-r22-synnical-os-r11-5-20260818
```

The preflight-only mode does not modify the production source, environment, SQLite database, PM2 process or compiled production build.
