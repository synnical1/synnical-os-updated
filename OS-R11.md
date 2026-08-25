# Synnical OS r11.5

Build: `synnical-r22-synnical-os-r11-5-20260818`  
Version: `0.7.5`

## Default experience

Synnical OS is the direct/default site experience. The old education-cover key gate is gone. Classic Synnical remains available only as a compatibility/recovery shell, while the desktop, Start launcher and taskbar are the normal navigation model. Core OS preferences are cached locally and synchronized through the signed-in account preference store.

## Desktop shell

- centered taskbar by default, optional left alignment and auto-hide
- Synnical Start button, Search, Task View, Widgets, pinned/running apps and running indicators
- system tray with real browser-exposed network/battery state, Synnical audio level, language, date/time, notification badge and Show Desktop
- Quick Settings for Synnical controls plus capability-honest network/Bluetooth/battery surfaces
- draggable, resizable, minimizable, maximizable singleton app windows
- edge snapping, multi-zone snap layouts, snap groups and Aero Shake behavior
- Alt-Tab switching, three persistent virtual desktops and Task View
- Start pinned apps, alphabetical All Apps, recent/recommended apps, account actions and Synnical power actions
- desktop and app context menus, clipboard history, emoji/symbol picker and on-screen keyboard
- real Synnical notifications, toast routing, calendar flyout and focus filtering
- wallpaper-backed lock screen with server-side password verification
- Mica/acrylic-style Synnical materials, animations, transparency and original interface tones

The shell never invents hardware state. If the browser does not expose a battery, Wi-Fi identity, Bluetooth controls or another device capability, Synnical says so instead of fabricating values.

## Synnical Settings

The desktop Settings app is a dedicated two-pane OS surface with `Find a setting`, live preferences and these categories:

- System
- Bluetooth & devices
- Network & internet
- Personalization
- Apps
- Accounts
- Time & language
- Gaming
- Accessibility
- Privacy & security
- Synnical Update

Existing mature Synnical settings are reused inside those category pages rather than duplicated into a second disconnected preferences system. Taskbar, Start, snapping, visual effects, desktop, lock-screen and OS-start behavior are controlled directly by the OS preference model. `Synnical Update` reports the installed server build and health entry points without inventing a remote update service.

## Synnical Files

`Synnical Files` is an account-backed Explorer-style app. It exposes real Synnical-owned records such as Browser downloads and private game screenshots, with tabs, breadcrumbs, search, sorting, grid/details views, a details pane and context actions. Unsupported filesystem operations stay disabled instead of pretending the browser has arbitrary access to the device filesystem. Screenshot deletion uses the existing authenticated server endpoint.

## Apps, desktop and classic navigation

OS mode has no old left rail and no Tools-folder bottleneck. Every app the signed-in user is authorized to use is a first-class desktop/Start/Search/taskbar application. YouTube and GeForce NOW join the existing Synnical apps, while staff/Lab/developer surfaces remain permission-gated. Classic mode remains a compatibility fallback only. All launch surfaces use the same app registry and authorization path.

## SynnFlix Continue Watching repair

Continue Watching keeps the exact movie/episode identity and account-backed timestamp protected until the provider actually reaches the saved point. Slow/black provider startup gets a visible bounded restore state and delayed retry path rather than silently accepting an early low timestamp. Failed restore attempts keep the saved point intact and expose explicit retry/start-from-beginning actions. Completed server rows suppress stale local cards, metadata-only rating updates cannot reset playback, and the stable fullscreen shell remains intact across episode changes.

## r11.4 live-fix changes

- Continue Watching no longer auto-destroys/recreates a provider iframe after the frame has loaded or emitted any player event. A truly unresponsive frame gets at most one bounded automatic retry; a live frame stays interactive and offers explicit retry/keep-current/start-over recovery without overwriting the saved point.
- Chat hot-row callbacks are stable, message-cache writes are debounced, offscreen message rows use browser rendering containment, hover Quote inserts a sendable quoted block into the composer, and creating a poll publishes the persisted poll message directly into the channel with an inline voting card.
- `Notable Person` and `Big Site Owner` are permission-neutral recognition badges rendered beside the normal role badge. Only Owner/Head Admin can manage them, and ordinary tag limits cannot evict them.
- The second original Synnical samurai/cherry-blossom wallpaper is the default. All four original variants are available in Personalization for desktop and lock screen; the old externally watermarked default asset is not shipped.
- Desktop shortcuts use high-contrast dark icon tiles and readable label backplates on bright wallpapers. YouTube and GeForce NOW retain recognizable branded icons.
- Taskbar app context menus anchor immediately above the clicked taskbar item instead of using a generic viewport offset.

## r11.3 service-pack foundation

- Synnical OS now loads directly. The old five-`W` education-cover activation gate is removed.
- The supplied samurai/cherry-blossom image is the default Synnical OS wallpaper. Desktop and lock screen can be customized separately with upload, preview and Fill/Fit/Stretch/Center/Tile modes.
- Themes are directly selectable from Synnical Settings → Personalization.
- Lock is exposed directly from Start and Personalization; the misleading Sleep-as-lock action is removed. The lock screen has account recovery entry and optional real notification previews.
- All accounts must complete one successful security migration after this release: confirm the current password, choose a different new password, configure a hashed recovery question/answer, generate one-time recovery codes, acknowledge the codes, then enter Synnical OS. Completion is persisted and is not repeated.
- Password changes are available in Synnical Settings → Accounts. Lock-screen recovery requires both the configured security answer and one unused recovery code; a security question alone cannot reset an account.
- Real online/offline state can no longer be hidden by a privacy preference. Rich activity/profile detail privacy remains separate.
- The touch keyboard retains the last focused Synnical text target so key presses actually reach controlled inputs; cross-origin embeds remain browser-isolated.
- YouTube is a first-class embedded-video app and GeForce NOW is a first-class Synnical Browser app. Third-party entries use recognizable brand icons and participate in the normal app registry.
- Cloud-game verification waits longer and retries verification on the same mailbox before the existing bounded fresh-mail fallback, reducing avoidable verification-email timeouts without creating an unbounded wait.

## Explicit exclusions

There is no virtual-machine or cloud-computer feature. Synnical also does not use Microsoft branding, logos, wallpapers or copied proprietary assets. Browser capability limits are surfaced honestly.

## Deployment safety

Production SQLite data, uploads, secrets, PM2 state and compiled output are not shipped in this source ZIP. The installer retains isolated preflight, SQLite snapshot, atomic application swap, readiness verification and rollback behavior. `SYNNICAL_PREFLIGHT_ONLY=1` does not modify production.


## r11.2 preflight correction

The desktop lock screen, Start account surface and Synnical Settings account cards use the existing authenticated `SafeUser.pfpUrl` profile-image contract. The failed r11.1 `SafeUser.avatar` references were removed without widening the auth payload.


## r11.5 live-fix changes

- Continue Watching now merges the furthest credible timestamp from the local rail, account progress row, and per-title local progress key so stale lower rows created by older failed-resume builds cannot win merely because they were newer.
- Repaired progress is persisted back into the local Continue Watching rail and stale account rows are healed asynchronously.
- Continue Watching never overwrites a higher local saved point with a lower card value, and resume diagnostics no longer render over the player.
- Vidking iframe load readiness ignores the initial about:blank lifecycle by assigning the provider URL before insertion and validating the loaded origin.
- Desktop shortcuts no longer use permanent black icon boxes. Professional app glyphs/brand icons render standalone with adaptive light/dark contrast and readable labels.
- Auto fullscreen is enabled by default and requests true browser fullscreen on the first trusted pointer/key gesture, the earliest point allowed by browser security. The installable web-app manifest uses fullscreen display mode.
