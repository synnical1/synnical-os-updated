# Wallpaper edges and Settings switches

Baseline: deployed main `c1d65a1367257ca50db741f0b05ca550c6366156` (PR #11).

## Confirmed wallpaper cause

The video was positioned at `left: -2%` and requested `width: 104%`.
Tailwind Preflight gives videos `max-width: 100%`, which clamped the width to
the parent while retaining the negative left offset. Its right edge therefore
ended at 98% of the parent: **27.32px uncovered at 1366px**.

The production browser reproduced this before the patch: viewport/parent width
1363, left -27.25, video width 1363, right 1335.75, computed max-width 100%.
This is a CSS sizing conflict, not encoded padding or a Chromium decoder defect.

Decoded frames at 0.1, 7 and 14.1 seconds and the poster were inspected across
the complete bounds. No padded black columns were present in the active WebM
or poster. The historical MP4 was also inspected; it is not the default source.

| Asset | Codec | Display/coded dimensions | SAR / DAR | Duration |
| --- | --- | --- | --- | --- |
| Default WebM | VP9 | 1920 × 1080 | 1:1 / 16:9 | 14.300s |
| Poster | WebP | 1920 × 1080 | square image pixels / 16:9 | static |
| Historical MP4 | H.264 | 3840 × 2160 | no container SAR declared / dimensions 16:9 | 15.040s |

No media assets were re-encoded. Desktop and lock video surfaces now use exact
parent bounds, `max-width: none` and the existing fit mapping (`fill` → cover,
`fit` → contain, `stretch` → fill, `center` → none). Normal fill does not distort
or overscan. Only a deliberately selected blur expands the desktop surface by
three blur radii, to cover its filter kernel; image and video use the same bounds.
Boot already uses exact viewport bounds and cover sizing.

## Confirmed switch causes

The local Toggle's absolute thumb lacked a horizontal anchor. Its static
position plus a checked translation placed the thumb outside the track.
The old shared switch also had asymmetric geometry: 32px border-box track,
16px thumb and 14px travel, leaving different endpoint insets.

Settings now delegates to the existing Radix Switch, including its keyboard,
ARIA and disabled behavior. Both surfaces use one geometry: 40 × 20 track,
1px border, 14px thumb, 2px explicit left/top anchor inside the border,
3px outer inset and 20px travel (`40 - 14 - 2×3`).

The track uses the active accent, and the neutral thumb uses theme contrast
colors. New Settings chrome uses semantic accent/selected variables. A legacy
CSS override that suppressed switch focus rings was removed. Legacy surface
normalization now excludes switches so its important background cannot override
the checked accent (caught by the rendered Blood-theme regression).

## Verification

Focused tests render the actual Radix control, validate ARIA/disabled attributes,
check default fit mappings and inspect poster dimensions/edge pixels.
The existing Chrome smoke test now checks rendered wallpaper bounds and right
edge pixels at 1366×768, 1920×1080, 1440×900 and 1280×720. It exercises both switch
states for Auto fullscreen, chat notifications, Battery Saver, taskbar auto-hide
and legacy notification sound under Blood, Synnical and Forest; fullscreen,
lock and fresh-navigation boot bounds are checked too.

The normal deployment workflow repeats public wallpaper/fullscreen/lock checks
against live production after PM2/runtime verification and retains guest-only
screenshots as an artifact. CI switch/auto-hide checks authenticate only against
the disposable smoke database. Live Settings checks need separate secure browser
sign-in and are explicitly UNVERIFIED when that is unavailable. No production
account is created and no production credentials enter the test runner.

Games/Stratus and TMDB runtime configuration are outside this patch. Their
preflight/security behavior is preserved; missing credentials/malq remain
UNCONFIGURED. No production `.env` or infrastructure is configured here.
