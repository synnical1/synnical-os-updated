# Stratus upstream

Synnical's bundled cloud-gaming service is derived from:

- Repository: https://github.com/x8rr/stratus-api
- Upstream branch: `main`
- Verified upstream commit: `30bccaae33025f1874e8802f2923a34da974ab76`

At this integration point, `stratus/cloud.json` is byte-for-byte identical to
upstream `cloud.json`.

`stratus/api.js` is the Synnical same-process adaptation of upstream
`api/api.js`: it is mounted by `server.ts` under `/api/games` instead of
starting a second HTTP server, while preserving the Stratus cloud-session and
signaling flow. Synnical-specific reliability fixes are kept in this adapted
file.

The Stratus Public License is preserved in `stratus/LICENSE-STRATUS.txt`.
