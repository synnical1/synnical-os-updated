# Synnical consolidated 100-feature coverage

Release: `synnical-r15-hotfix1-20260816`

Every numbered item below is represented in `tests/consolidated-100-features.test.ts`, which requires persisted/server behavior and a runtime or user-facing consumer where applicable. Capability-gated items are explicitly marked rather than represented by dead controls.

1. **Pinned DMs** — implemented and covered by the consolidated feature test.
2. **DM folders** — implemented and covered by the consolidated feature test.
3. **Message bookmarks** — implemented and covered by the consolidated feature test.
4. **Scheduled messages** — implemented and covered by the consolidated feature test.
5. **Draft syncing** — implemented and covered by the consolidated feature test.
6. **Edit history** — implemented and covered by the consolidated feature test.
7. **Threaded replies** — implemented and covered by the consolidated feature test.
8. **Channel slow mode** — implemented and covered by the consolidated feature test.
9. **Per-channel notification levels** — implemented and covered by the consolidated feature test.
10. **Custom notification sounds** — implemented and covered by the consolidated feature test.
11. **First unread jump** — implemented and covered by the consolidated feature test.
12. **Conversation search filters** — implemented and covered by the consolidated feature test.
13. **Shared media gallery** — implemented and covered by the consolidated feature test.
14. **Shared links gallery** — implemented and covered by the consolidated feature test.
15. **Voice waveform seek speed** — implemented and covered by the consolidated feature test.
16. **Voice transcription** — implemented and covered by the consolidated feature test.
17. **Message translation** — implemented and covered by the consolidated feature test.
18. **Spoiler formatting** — implemented and covered by the consolidated feature test.
19. **Polls** — implemented and covered by the consolidated feature test.
20. **Anonymous staff polls** — implemented and covered by the consolidated feature test.
21. **Events and RSVP** — implemented and covered by the consolidated feature test.
22. **Birthdays** — implemented and covered by the consolidated feature test.
23. **Friend nicknames** — implemented and covered by the consolidated feature test.
24. **Friend notes** — implemented and covered by the consolidated feature test.
25. **Close Friends** — implemented and covered by the consolidated feature test.
26. **Favourite profiles** — implemented and covered by the consolidated feature test.
27. **Bilateral profile visitors** — implemented and covered by the consolidated feature test.
28. **Pronouns** — implemented and covered by the consolidated feature test.
29. **Verified profile links** — implemented and covered by the consolidated feature test.
30. **Playable profile music** — implemented and covered by the consolidated feature test.
31. **Profile showcases** — implemented and covered by the consolidated feature test.
32. **Status expiry** — implemented and covered by the consolidated feature test.
33. **Profile accent gradient** — implemented and covered by the consolidated feature test.
34. **Banner positioning** — implemented and covered by the consolidated feature test.
35. **Cosmetic favourites** — implemented and covered by the consolidated feature test.
36. **Cosmetic loadouts** — implemented and covered by the consolidated feature test.
37. **Seasonal cosmetic rotation** — implemented and covered by the consolidated feature test.
38. **Limited edition serials** — implemented and covered by the consolidated feature test.
39. **Cosmetic gifting wishlists** — implemented and covered by the consolidated feature test.
40. **Shop wishlist price changes** — implemented and covered by the consolidated feature test.
41. **Daily login streak** — implemented and covered by the consolidated feature test.
42. **Weekly challenges** — implemented and covered by the consolidated feature test.
43. **Achievements** — implemented and covered by the consolidated feature test.
44. **Achievement showcase** — implemented and covered by the consolidated feature test.
45. **Account XP and level** — implemented and covered by the consolidated feature test.
46. **Promo codes** — implemented and covered by the consolidated feature test.
47. **Transaction receipts** — implemented and covered by the consolidated feature test.
48. **Gift history** — implemented and covered by the consolidated feature test.
49. **Refund eligibility countdown** — implemented and covered by the consolidated feature test.
50. **Shop rarity tiers** — implemented and covered by the consolidated feature test.
51. **Custom Synn Bot commands** — implemented and covered by the consolidated feature test.
52. **Synn Bot reminders** — implemented and covered by the consolidated feature test.
53. **Synn Bot polls** — implemented and covered by the consolidated feature test.
54. **Synn Bot countdowns** — implemented and covered by the consolidated feature test.
55. **Synn Bot weather** — implemented and covered by the consolidated feature test.
56. **Synn Bot dictionary** — implemented and covered by the consolidated feature test.
57. **Synn Bot units** — implemented and covered by the consolidated feature test.
58. **Synn Bot currency** — implemented and covered by the consolidated feature test.
59. **Synn Bot team generator** — implemented and covered by the consolidated feature test.
60. **Synn Bot brackets** — implemented and covered by the consolidated feature test.
61. **Permission-aware bot message lookup** — implemented and covered by the consolidated feature test.
62. **Synn Bot moderation summaries** — implemented and covered by the consolidated feature test.
63. **Synn Bot profile command** — implemented and covered by the consolidated feature test.
64. **Synn Bot game command** — implemented and covered by the consolidated feature test.
65. **Synn Bot usage analytics** — implemented and covered by the consolidated feature test.
66. **Game collections** — implemented and covered by the consolidated feature test.
67. **Recently played duration** — implemented and covered by the consolidated feature test.
68. **Continue Playing** — implemented and covered by the consolidated feature test.
69. **Per-game controller presets** — implemented and covered by the consolidated feature test.
70. **Per-game audio presets** — implemented and covered by the consolidated feature test.
71. **Game launch diagnostics** — implemented and covered by the consolidated feature test.
72. **Cloud session latency** — implemented and covered by the consolidated feature test.
73. **Bitrate capability gating** — implemented and covered by the consolidated feature test. **Note:** Capability-gated: Stratus exposes no bitrate control, so Synnical reports it unavailable instead of showing a dead slider.
74. **Reconnect stream** — implemented and covered by the consolidated feature test.
75. **Game status sharing** — implemented and covered by the consolidated feature test.
76. **Session invite capability gating** — implemented and covered by the consolidated feature test. **Note:** Capability-gated: the provider exposes no same-provider-session invite token, so Synnical reports that limitation instead of faking an invite.
77. **Private game screenshots** — implemented and covered by the consolidated feature test.
78. **Game session history** — implemented and covered by the consolidated feature test.
79. **Browser tab groups** — implemented and covered by the consolidated feature test.
80. **Browser session restore** — implemented and covered by the consolidated feature test.
81. **Account browser bookmarks** — implemented and covered by the consolidated feature test.
82. **Browser history search/private clear** — implemented and covered by the consolidated feature test.
83. **Per-site browser permissions** — implemented and covered by the consolidated feature test.
84. **Browser download manager** — implemented and covered by the consolidated feature test.
85. **Extension permission preview** — implemented and covered by the consolidated feature test.
86. **Extension update checker** — implemented and covered by the consolidated feature test.
87. **Extension crash isolation** — implemented and covered by the consolidated feature test.
88. **Temporary browser profile** — implemented and covered by the consolidated feature test.
89. **SynnFlix watchlist** — implemented and covered by the consolidated feature test.
90. **SynnFlix favourites** — implemented and covered by the consolidated feature test.
91. **SynnFlix custom lists** — implemented and covered by the consolidated feature test.
92. **SynnFlix episode autoplay** — implemented and covered by the consolidated feature test.
93. **SynnFlix sourced skip intro** — implemented and covered by the consolidated feature test. **Note:** Only shown when a real IntroMarker timing record exists; Synnical does not guess intro timings.
94. **SynnFlix watch parties** — implemented and covered by the consolidated feature test. **Note:** Uses Vidking progress events plus Synnical Socket.IO. Followers resync by remounting at the host timestamp because Vidking does not document a remote-control API.
95. **SynnFlix ratings/reviews** — implemented and covered by the consolidated feature test.
96. **Music drag reorder queue** — implemented and covered by the consolidated feature test.
97. **Synced music playlists** — implemented and covered by the consolidated feature test.
98. **Music activity privacy** — implemented and covered by the consolidated feature test.
99. **Unified Global Search** — implemented and covered by the consolidated feature test.
100. **Owner System Health** — implemented and covered by the consolidated feature test.
