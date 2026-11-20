# Synnical Roblox app

The Roblox desktop app launches Webblox's Roblox WebClientApp in a dedicated top-level page on `roblox.synnical.co.uk`. The desktop panel is a launcher; the player cannot be embedded in an ordinary iframe because it requires cross-origin isolation.

## Origin and transport

- Player assets live in `public/roblox-player/` and are served from the dedicated subdomain.
- The player page receives COOP `same-origin`, COEP `require-corp` and CORP `same-origin` headers.
- Its Wisp endpoint is `wss://roblox.synnical.co.uk/wisp/`. The per-connection TCP transport permits only HTTPS port 443 and hosts under `roblox.com`, `rbxcdn.com` and `robloxlabs.com`.
- Game traffic uses the browser's direct WebTransport connection to `*.qdmux.roblox.com`; it does not pass through Synnical Games or the Wisp relay.
- Roblox session storage remains on the dedicated subdomain. Synnical's session cookie must remain host-only.

## Engine assets

Run `node scripts/fetch-webblox.mjs --if-missing` to provision the pinned Epoxy browser transport and current production WebClientApp. Current Roblox builds use the prefix-compressed `WebClient.fsindex.txt` index; the fetcher also supports legacy `WebClient.metadata.json` builds. Large engine assets are ignored by Git and downloaded on first deployment. Run `npm run roblox:engine:update` to deliberately refresh the client.

## Deployment

Create an A record for `roblox.synnical.co.uk` pointing at the Synnical VPS. Add the hostname to Nginx's `server_name` and obtain a TLS certificate covering the root domain, www host and Roblox subdomain. See `DEPLOY-ORACLE-ARM64.md`.

## Account safety

The modified client may carry account-warning or compatibility risks. Roblox sign-in happens only on the isolated player origin. Users must never paste their `.ROBLOSECURITY` value into Synnical chat, settings or support messages.
