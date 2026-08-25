# Hotfix 5 — immersive cloud game controls

- Cloud games use JavaScript fullscreen plus Keyboard Lock for an immersive remote-PC style input mode.
- Fullscreen exit is reconciled even when Chromium handles the long-Escape escape hatch itself.
- Holding Escape releases stream input, exits fullscreen and restores Synnical navigation.
- Back to games, Reconnect and Screenshot controls are visible only outside captured fullscreen.
- Resume game explicitly re-enters fullscreen, restores Keyboard Lock and re-captures the stream.
- The stream cannot silently re-capture input after the user has released it; explicit Resume is required.
