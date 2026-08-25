# Synnical OS r12 Final — 250 Feature Audit

Build: `synnical-r23-synnical-os-r12-final-20260818`  
Version: `0.8.0`

This audit is intentionally conservative. A visible button or label is not counted as implementation. Browser/provider-limited items are identified instead of being faked. Feature 3 is explicitly marked removed because the user later requested that taskbar hover previews be removed globally.

## Status totals

- **IMPLEMENTED: 179**
- **IMPLEMENTED — SYNNICAL EQUIVALENT: 8**
- **PARTIAL: 44**
- **BROWSER/PROVIDER LIMITED: 3**
- **REMOVED BY USER REQUEST: 1**
- **NOT IMPLEMENTED: 15**

## Item-by-item audit

### 1. Snap Groups so apps snapped together appear as one group on the taskbar.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 2. Snap Layout picker when hovering the maximize button.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 3. Aero-style window previews when hovering taskbar apps.
**Status: REMOVED BY USER REQUEST**
Global taskbar hover thumbnails/previews were intentionally removed in r12 at the user’s later request.

### 4. Taskbar thumbnail controls like play/pause for Music or SynnFlix.
**Status: IMPLEMENTED — SYNNICAL EQUIVALENT**
Real media controls remain in Quick Settings/right-click surfaces because hover thumbnail UI was explicitly removed.

### 5. Taskbar progress bars for uploads/downloads.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 6. Taskbar notification badges for unread chats, calls, etc.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 7. Per-app taskbar jump lists on right-click.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 8. Pin/unpin apps to taskbar.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 9. Reorder pinned taskbar apps with drag-and-drop.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 10. Taskbar auto-hide.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 11. Taskbar alignment option centered or left.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 12. Small/medium/large taskbar sizing.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 13. System tray overflow menu.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 14. Clock seconds toggle.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 15. Multiple clock/timezone support.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 16. Quick calendar agenda when clicking the clock.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 17. Focus / Do Not Disturb mode.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 18. Focus sessions with timer.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 19. Notification priority levels.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 20. Per-app notification settings.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 21. Notification history after dismissing notifications.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 22. Notification grouping by app.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 23. Desktop widgets.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 24. Clock widget.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 25. Calendar widget.
**Status: IMPLEMENTED**
Taskbar/notification/focus foundation is implemented and regression-covered; later user overrides are called out individually.

### 26. Weather widget.
**Status: IMPLEMENTED**
r12 widgets use real Synnical/account/provider data and persist position/size.

### 27. Recently played widget.
**Status: IMPLEMENTED**
r12 widgets use real Synnical/account/provider data and persist position/size.

### 28. Friends online widget.
**Status: IMPLEMENTED**
r12 widgets use real Synnical/account/provider data and persist position/size.

### 29. SynnFlix Continue Watching widget.
**Status: IMPLEMENTED**
r12 widgets use real Synnical/account/provider data and persist position/size.

### 30. Credit balance widget.
**Status: IMPLEMENTED**
r12 widgets use real Synnical/account/provider data and persist position/size.

### 31. Pinned chat widget.
**Status: IMPLEMENTED**
r12 widgets use real Synnical/account/provider data and persist position/size.

### 32. Custom widget positioning.
**Status: IMPLEMENTED**
r12 widgets use real Synnical/account/provider data and persist position/size.

### 33. Widget resize support.
**Status: IMPLEMENTED**
r12 widgets use real Synnical/account/provider data and persist position/size.

### 34. Multiple desktop pages/workspaces.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 35. Different wallpaper per workspace.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 36. Different app layout per workspace.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 37. Workspace names such as Gaming, Social and School.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 38. Workspace switching animation.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 39. Keyboard shortcuts for workspace switching.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 40. Desktop icon grid snapping.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 41. Free-position desktop icons.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 42. Auto-arrange icons.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 43. Sort desktop by name/type/recent use.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 44. Desktop folders.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 45. Drag apps/files into desktop folders.
**Status: PARTIAL**
Desktop folders accept Synnical app shortcuts; there is no generic writable desktop file model to drag arbitrary Files items into.

### 46. Desktop folder popup view instead of opening a full window.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 47. Hide/show desktop icons.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 48. Desktop icon size slider.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 49. Per-shortcut custom icons.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 50. Shortcut rename support.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 51. Shortcut properties window.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 52. Create shortcut wizard.
**Status: PARTIAL**
Shortcut creation/customization is app-centric; there is no arbitrary URL/file shortcut wizard with every Windows field.

### 53. Desktop right-click New menu.
**Status: PARTIAL**
Desktop New creates real Synnical desktop folders; arbitrary host-style file creation is intentionally not faked.

### 54. Desktop refresh option.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 55. Personalize shortcut directly from right-click.
**Status: IMPLEMENTED**
r12 workspaces and desktop state are persistent, dynamic, draggable and workspace-aware.

### 56. Live wallpaper support for safe video wallpapers.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 57. Wallpaper slideshow.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 58. Wallpaper shuffle.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 59. Different lock-screen wallpaper.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 60. Wallpaper dimming slider so icons stay readable.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 61. Wallpaper blur slider.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 62. Wallpaper saturation slider.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 63. Automatic light/dark theme based on wallpaper.
**Status: PARTIAL**
Wallpaper-aware readability exists, but automatic light/dark switching is not meaningful while shipped Synnical themes are dark-first.

### 64. Accent color extraction from wallpaper.
**Status: NOT IMPLEMENTED**
Wallpaper accent extraction is not implemented in r12.

### 65. Glass/transparency strength slider.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 66. Window animation speed setting.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 67. Reduce motion accessibility mode.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 68. Window transparency setting.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 69. Rounded-corner amount setting.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 70. Classic square-window theme.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 71. Custom cursor themes.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 72. Cursor size setting.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 73. Custom system sounds.
**Status: PARTIAL**
Synnical has real startup/UI tones, but no arbitrary uploaded system-sound pack manager.

### 74. Startup sound.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 75. Notification sounds per app.
**Status: PARTIAL**
Chat/channel notification sound behavior exists; arbitrary custom sounds are not configurable for every app.

### 76. Volume mixer for Synnical-controlled audio sources.
**Status: PARTIAL**
Global media controls exist, but a reliable cross-origin volume mixer for every embedded source is not browser-feasible.

### 77. Per-app mute controls.
**Status: PARTIAL**
Mute controls exist where Synnical owns the media element/state; cross-origin embedded media cannot always be controlled.

### 78. Global media controls in Quick Settings.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 79. Now Playing panel.
**Status: IMPLEMENTED — SYNNICAL EQUIVALENT**
Now Playing is integrated into Quick Settings/lock screen rather than mounting another heavy always-on app.

### 80. Media artwork on lock screen.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 81. Lock-screen notification previews.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 82. Hide sensitive notification text on lock screen.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 83. Custom lock-screen status widgets.
**Status: PARTIAL**
Lock screen has configurable notification/media/status surfaces, but not an arbitrary plugin/widget framework.

### 84. Lock screen slideshow.
**Status: IMPLEMENTED**
Personalization/media/lock-screen behavior is real and persisted where the browser permits it.

### 85. User switcher if multiple Synnical accounts authenticated on device.
**Status: NOT IMPLEMENTED**
Synnical currently uses one authenticated account per browser session; secure multi-account remembered tiles are not architected.

### 86. Remembered account tiles.
**Status: NOT IMPLEMENTED**
Synnical currently uses one authenticated account per browser session; secure multi-account remembered tiles are not architected.

### 87. Session timeout lock.
**Status: PARTIAL**
Auto-lock after inactivity is real; there is no separate server-enforced session-timeout lock policy.

### 88. Auto-lock after inactivity.
**Status: IMPLEMENTED**
Lock/security/session features use authenticated server state; browser-controlled permissions are called out separately.

### 89. Require password after auto-lock.
**Status: IMPLEMENTED**
Lock/security/session features use authenticated server state; browser-controlled permissions are called out separately.

### 90. Optional PIN unlock after initial secure authentication.
**Status: IMPLEMENTED**
Lock/security/session features use authenticated server state; browser-controlled permissions are called out separately.

### 91. App permissions dashboard.
**Status: PARTIAL**
Privacy/security settings expose Synnical permissions and usage, while the browser remains the authority for hardware grants.

### 92. Camera permission management.
**Status: BROWSER/PROVIDER LIMITED**
Synnical can request and report camera/microphone use, but Chrome/ChromeOS owns grant/revoke permission controls.

### 93. Microphone permission management.
**Status: BROWSER/PROVIDER LIMITED**
Synnical can request and report camera/microphone use, but Chrome/ChromeOS owns grant/revoke permission controls.

### 94. Notification permission management.
**Status: PARTIAL**
Per-app Synnical notification rules are real; browser notification permission itself remains browser-managed.

### 95. Per-app privacy dashboard.
**Status: PARTIAL**
Synnical privacy/security surfaces and media-use history exist, but not a Windows-style per-app hardware ledger for processes outside Synnical.

### 96. Recent account activity screen.
**Status: IMPLEMENTED**
Lock/security/session features use authenticated server state; browser-controlled permissions are called out separately.

### 97. Active sessions screen.
**Status: IMPLEMENTED**
Lock/security/session features use authenticated server state; browser-controlled permissions are called out separately.

### 98. Remote logout other sessions.
**Status: IMPLEMENTED**
Lock/security/session features use authenticated server state; browser-controlled permissions are called out separately.

### 99. Trusted device list.
**Status: IMPLEMENTED**
Lock/security/session features use authenticated server state; browser-controlled permissions are called out separately.

### 100. Security alerts for suspicious/new sign-ins.
**Status: PARTIAL**
Security events record logins/session changes/recovery actions; dedicated push alerts for every suspicious/new sign-in are not fully implemented.

### 101. Windows-style File Explorer navigation pane.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 102. Quick Access / Favorites in Files.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 103. Recent files section.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 104. Pinned folders.
**Status: PARTIAL**
Quick Access/Favorites can pin Synnical virtual locations; there is no unrestricted host-filesystem folder tree.

### 105. File breadcrumbs.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 106. Back/forward navigation history.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 107. Tabbed File Explorer windows.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 108. Split-pane file browsing.
**Status: NOT IMPLEMENTED**
Files does not have a true split-pane explorer; Browser split-screen is unrelated and is not counted.

### 109. File preview pane.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 110. File details pane.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 111. Large/small/list/details file views.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 112. Sort files by name/date/type/size.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 113. File search.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 114. Recently deleted / Recycle Bin.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 115. Restore deleted files.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 116. Recycle Bin auto-clean setting.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 117. File rename keyboard shortcut.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 118. Drag-and-drop file organization.
**Status: PARTIAL**
Drag/multi-select is supported for Synnical-managed items where meaningful, but there is no arbitrary writable host-style folder hierarchy.

### 119. Multi-select files.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 120. ZIP creation/extraction for Synnical-owned files.
**Status: PARTIAL**
ZIP creation for Synnical-owned screenshots is real; generic ZIP extraction into an arbitrary writable file tree is not implemented.

### 121. File properties dialog.
**Status: PARTIAL**
Files has real preview/details metadata, but not a full Windows-style properties dialog for every possible object type.

### 122. File sharing permissions panel.
**Status: PARTIAL**
Synnical-owned links can be copied/shared; granular ACL-style file sharing permissions are not implemented.

### 123. Storage usage visualization.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 124. Storage cleanup recommendations.
**Status: PARTIAL**
Storage summary, duplicate detection and Recycle Bin cleanup are real; a broad automated cleanup recommender is limited.

### 125. Duplicate-file detection.
**Status: IMPLEMENTED**
Files capabilities operate on Synnical-managed files/screenshots instead of pretending to access the host filesystem.

### 126. Start menu folders.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 127. Start menu pinned sections.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 128. Start menu recommendation toggle.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 129. Recently opened apps.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 130. Recently opened files.
**Status: PARTIAL**
Recent Synnical-managed media/files are surfaced in Files; there is no universal generic-file recent list.

### 131. All Apps alphabet navigation.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 132. Search from Start.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 133. Search apps, people, chats, settings and files simultaneously.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 134. Search filters.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 135. Natural-language Synnical search such as "open my chat with Sam."
**Status: PARTIAL**
Natural-language-like app launching/aliases are real, but full entity resolution such as “open my chat with Sam” is not a general parser yet.

### 136. Search history toggle.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 137. App aliases so typing "films" can launch SynnFlix.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 138. Run dialog, Win + R style.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 139. Synnical command launcher with commands such as chat, movies and settings.
**Status: IMPLEMENTED**
Start/search/Run capabilities operate on real Synnical apps/data and persisted OS state.

### 140. Power-user menu, Win + X style.
**Status: IMPLEMENTED — SYNNICAL EQUIVALENT**
Synnical exposes a power-user menu with Run, Task Manager, Capture and Settings; it does not claim ownership of the native Win+X shell.

### 141. Synnical Task Manager showing Synnical windows/apps, not fake OS processes.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 142. Task Manager performance panel showing real browser/Synnical metrics we can access.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 143. Force-close frozen Synnical windows.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 144. App resource usage estimates.
**Status: PARTIAL**
Task Manager reports browser/Synnical metrics and startup-impact estimates; browsers do not expose trustworthy per-window CPU/RAM attribution.

### 145. Network/API diagnostics.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 146. Socket.IO connection status diagnostics.
**Status: PARTIAL**
Connection state/health is exposed, but there is no exhaustive per-Socket.IO-listener diagnostic inspector.

### 147. Latency graph for Synnical services.
**Status: NOT IMPLEMENTED**
Realtime RTT exists, but a persisted latency-history graph is not implemented.

### 148. Realtime ping indicator.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 149. Service health page.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 150. Synnical Event Viewer for user-readable errors/crashes.
**Status: PARTIAL**
User-facing failures, health state and recovery surfaces exist, but there is no full persistent Event Viewer for every client exception.

### 151. App crash recovery.
**Status: PARTIAL**
Error boundaries, app repair and shell recovery exist; crash recovery is not guaranteed for every possible embedded/provider failure.

### 152. Restore previously open windows after reload.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 153. Restore exact window positions.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 154. Restore snapped layouts.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 155. Remember window size per app.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 156. Remember last folder/page per app.
**Status: PARTIAL**
Major app/window/Files/Browser state is restored, but every app does not guarantee restoration of every nested subpage.

### 157. Minimize all windows shortcut.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 158. Show desktop button at far-right of taskbar.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 159. Shake a window to minimize others like Aero Shake.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 160. Drag window to screen edge to snap.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 161. Drag to top to maximize.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 162. Snap resize linked windows together.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 163. Keyboard window snapping.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 164. Always-on-top toggle for selected windows.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 165. Picture-in-picture SynnFlix window where browser support allows.
**Status: BROWSER/PROVIDER LIMITED**
The player allows picture-in-picture, but Vidking/cross-origin/browser support determines whether PiP can actually be invoked.

### 166. Mini Music player.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 167. Compact Chat window.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 168. Floating call controls.
**Status: PARTIAL**
Calls has persistent controls in its app surface; it is not a universal always-on floating overlay across every Synnical app.

### 169. Fullscreen app launcher shortcut.
**Status: PARTIAL**
Custom global shortcuts and Run exist; no dedicated separate fullscreen-launcher shortcut surface is implemented.

### 170. App-specific fullscreen preference.
**Status: PARTIAL**
Games/GeForce NOW and relevant media/browser surfaces have immersive behavior; there is not a distinct fullscreen preference for every app.

### 171. Alt+Tab with live previews.
**Status: PARTIAL**
Alt+Tab switches real windows; taskbar hover/live thumbnail previews were removed by user request, so pixel-live preview rendering is intentionally limited.

### 172. Alt+Tab filter between current workspace/all workspaces.
**Status: PARTIAL**
Workspace-aware switching exists, but there is no dedicated current-workspace/all-workspaces Alt+Tab filter setting.

### 173. Task View with full desktop preview.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 174. Drag windows between workspaces in Task View.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 175. Keyboard shortcut editor.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 176. Custom global shortcuts.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 177. Clipboard history for text copied inside Synnical.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 178. Pinned clipboard entries.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 179. Emoji picker, Win + . style.
**Status: IMPLEMENTED**
Window/task-manager/diagnostic/input features operate on real Synnical windows and browser-visible metrics.

### 180. GIF picker integrated into the same panel.
**Status: PARTIAL**
Chat retains GIF/media picking, while the OS emoji panel links to emoji/symbol input rather than duplicating a full GIF search engine.

### 181. Symbols picker.
**Status: PARTIAL**
Symbol entry is available through the touch keyboard/symbol surfaces, but the OS emoji flyout is not a fully categorized symbol browser.

### 182. Searchable Unicode/special-character picker.
**Status: NOT IMPLEMENTED**
A dedicated searchable Unicode/special-character catalog is not implemented.

### 183. Screenshot tool for the Synnical workspace.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 184. Rectangular capture mode.
**Status: PARTIAL**
Browser capture can choose screen/window/tab; an in-app rectangular crop selector is not implemented.

### 185. Window capture mode.
**Status: IMPLEMENTED — SYNNICAL EQUIVALENT**
Window capture is provided through the browser’s permissioned screen/window/tab picker, which is the honest web equivalent.

### 186. Annotate screenshot before sending.
**Status: NOT IMPLEMENTED**
The final capture flow does not include an annotation canvas.

### 187. Send screenshot directly into Chat.
**Status: PARTIAL**
Capture can copy the screenshot and open Chat; it does not silently bypass normal attachment/clipboard permissions to send on the user’s behalf.

### 188. Screen recording for Synnical/app content where browser APIs permit it.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 189. Voice typing using browser speech capabilities where available.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 190. On-screen keyboard themes.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 191. Touch-friendly taskbar mode.
**Status: PARTIAL**
Large taskbar sizing, touch keyboard and touch-safe controls exist; there is no separate automatic touch-taskbar mode switch.

### 192. Tablet-sized spacing option.
**Status: PARTIAL**
Taskbar sizing and interface scaling provide tablet-friendly spacing, but there is no dedicated tablet-spacing preset.

### 193. High contrast themes.
**Status: IMPLEMENTED — SYNNICAL EQUIVALENT**
High-contrast rendering is implemented through Synnical accessibility/color-filter controls rather than pretending to change the host OS theme.

### 194. Text scaling independent of browser zoom.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 195. Color filter accessibility presets.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 196. Keyboard navigation outlines.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 197. Screen-reader optimized navigation landmarks.
**Status: IMPLEMENTED — SYNNICAL EQUIVALENT**
Semantic nav/main/button/label structure and keyboard focus behavior support screen readers; Synnical does not fake a “screen reader enabled” switch.

### 198. Caption preferences.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 199. Reduced transparency option.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 200. Magnifier-style zoom for Synnical workspace.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 201. Night Light-style visual filter inside Synnical.
**Status: IMPLEMENTED**
Capture/input/accessibility features use real browser APIs and runtime CSS where available.

### 202. Scheduled dark mode.
**Status: NOT IMPLEMENTED**
A scheduled light/dark switch is not implemented; current Synnical themes are dark-first.

### 203. Theme schedule by time of day.
**Status: NOT IMPLEMENTED**
Time-of-day theme scheduling is not implemented in r12.

### 204. Battery-aware visual effects reduction when browser exposes battery state.
**Status: IMPLEMENTED**
Battery-aware effect reduction uses the browser Battery API when available and falls back safely when it is not exposed.

### 205. Data Saver mode.
**Status: PARTIAL**
Low-end/adaptive behavior honors browser Save-Data/network hints; there is no separate full Data Saver subsystem that can throttle arbitrary providers.

### 206. Low-performance mode for Chromebooks/older PCs.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 207. Disable wallpaper animation automatically on weak devices.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 208. Reduce chat rendering quality/peripheral effects under load.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 209. Startup Apps settings controlling which Synnical apps reopen after login.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 210. Startup impact indicator.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 211. Default Apps settings for media/file types inside Synnical.
**Status: NOT IMPLEMENTED**
There is no generic default-app/file-association router because Synnical does not expose a generic writable file-type model.

### 212. App repair/reset button.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 213. Clear individual app cache.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 214. App storage usage page.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 215. Uninstall/remove optional Synnical apps from launcher without deleting account data.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 216. Optional app store/library for first-party Synnical modules.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 217. App update history.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 218. What's New after an update.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 219. System restore-like Synnical settings snapshots, not whole-server/VM nonsense.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 220. Export user settings.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 221. Import settings backup.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 222. Cloud-sync desktop layout.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 223. Cloud-sync wallpaper preferences.
**Status: IMPLEMENTED**
Performance/startup/app-management/settings-backup features have real runtime consumers.

### 224. Cloud-sync Start/taskbar pins.
**Status: PARTIAL**
Desktop/start settings sync through OS preferences; taskbar pin state is not yet fully cloud-synced across every device.

### 225. Cloud-sync accessibility preferences.
**Status: PARTIAL**
Accessibility controls are persistent, but several are intentionally device-local and not all are cloud-synced.

### 226. Device-specific settings exceptions.
**Status: NOT IMPLEMENTED**
There is no explicit per-device exception layer over every OS setting.

### 227. Continue where I left off across devices.
**Status: PARTIAL**
Account-backed OS preferences and SynnFlix progress continue across devices; exact live window/session state remains device-local.

### 228. Send a Synnical file/link to another signed-in device.
**Status: NOT IMPLEMENTED**
This cross-device feature requires additional trusted-device/session transport infrastructure and is not implemented in r12.

### 229. Shared clipboard between the user's Synnical sessions where privacy settings allow.
**Status: NOT IMPLEMENTED**
This cross-device feature requires additional trusted-device/session transport infrastructure and is not implemented in r12.

### 230. Nearby-style sharing between Synnical users without pretending we have direct hardware access.
**Status: PARTIAL**
Synnical links/content can be shared between users, but there is no nearby-device discovery/transport layer.

### 231. Phone-style notification forwarding inside Synnical accounts.
**Status: NOT IMPLEMENTED**
This cross-device feature requires additional trusted-device/session transport infrastructure and is not implemented in r12.

### 232. QR login for trusted-device pairing.
**Status: NOT IMPLEMENTED**
This cross-device feature requires additional trusted-device/session transport infrastructure and is not implemented in r12.

### 233. Device naming such as "Sam's Chromebook."
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 234. Device last-active indicator.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 235. Quick Settings edit mode.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 236. Drag Quick Settings toggles around.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 237. Brightness-like Synnical UI brightness control, not fake monitor brightness.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 238. Theme toggle in Quick Settings.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 239. Focus mode toggle.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 240. Notification toggle.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 241. Microphone/camera status indicators when Synnical is using them.
**Status: IMPLEMENTED — SYNNICAL EQUIVALENT**
Tray indicators show mic/camera/screen capture owned by Synnical; they do not claim visibility into unrelated native Chromebook apps.

### 242. Privacy indicator history.
**Status: IMPLEMENTED — SYNNICAL EQUIVALENT**
A short local privacy history records Synnical-owned capture activity only.

### 243. Live Synnical connection status in system tray.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 244. Unread communications tray indicator.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 245. Profile presence control from Quick Settings.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 246. Switch account/status directly from Start.
**Status: PARTIAL**
Presence/status can be changed quickly, but secure multi-account switching is not implemented because Synnical uses one authenticated account per browser session.

### 247. Lock, sign out and restart-shell controls.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 248. Restart Synnical shell without logging out.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 249. Safe Mode for Synnical loading only core apps/settings if UI is broken.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.

### 250. Recovery screen for resetting corrupted local preferences without deleting server data.
**Status: IMPLEMENTED**
Device/Quick Settings/tray/recovery features are wired to real session, presence, media-use and OS state.
