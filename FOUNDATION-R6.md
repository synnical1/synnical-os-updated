# Foundation r6 — presence, accessibility and adaptive performance

This release is the first implementation batch from the expanded Synnical feature specification. It deliberately groups shared foundations instead of shipping unrelated surface controls.

## Presence & activity

- Account-persisted social availability: Online, Available to play, Looking to talk, Do not invite to games, Free for 15 minutes and Busy.
- Temporary presence expiry with automatic return to Online.
- Five-minute automatic AFK detection with a user-defined AFK message.
- Optional sharing of current Synnical section, device type, online duration and simple connection quality.
- Detailed sharing is privacy-first and disabled until the account explicitly enables it.
- Presence is user-level across multiple Socket.IO connections instead of treating every browser socket as another person.
- Presence appears consistently in Chat, Friends and profile cards while keeping game activity separate.
- Friends “Online only” now uses actual live presence rather than a profile status string.

## Accessibility

- Reduced animation while explicit cosmetic preview areas remain animated.
- High-contrast and high-legibility reading modes.
- Dyslexia-friendly reading spacing without bundling or redistributing a font.
- Comfortable, compact and minimal interface density.
- Synnical-only interface zoom independent of browser zoom.
- Adjustable reading line spacing and chat message spacing.
- Adjustable keyboard focus-outline thickness.
- Large in-app pointer mode.
- Simplified interface mode that removes decorative background effects while preserving core controls.

## Performance

- Manual Low-End Device Mode reduces costly animation, blur, shadows and cosmetic motion.
- Optional Automatic Performance Scaling reacts to browser-exposed CPU/memory/network constraints and re-evaluates when connection conditions change.
- Browser-level controls Synnical cannot genuinely enforce are intentionally not exposed as fake settings.

## Data safety

- No Prisma schema change is required. Presence configuration uses the existing account-scoped UserPreference storage.
- Existing r3-r5 game, SynnFlix, connection isolation, credit-reset and staff-credit regression protections remain in the release gate.
