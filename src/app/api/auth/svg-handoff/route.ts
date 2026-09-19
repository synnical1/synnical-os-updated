import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-server"

export const dynamic = "force-dynamic"

const HANDOFF_TYPE = "synnical-svg-session"

function page(token: string | null) {
  const payload = token
    ? JSON.stringify({ type: HANDOFF_TYPE, token })
    : "null"

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Synnical session</title>
  <style>
    html,body{height:100%;margin:0;background:#090d16;color:#f6f7fb;font:14px system-ui,sans-serif}
    body{display:grid;place-items:center}
    main{max-width:360px;padding:24px;text-align:center}
    p{color:#a9b1c3;line-height:1.5}
    a{color:#fff}
  </style>
</head>
<body>
  <main>
    <strong id="title">${token ? "Connecting Synnical…" : "Synnical sign-in required"}</strong>
    <p id="message">${token
      ? "This window will close automatically."
      : "Open Synnical normally, sign in, then return to the SVG and try again."}</p>
    ${token ? "" : '<p><a href="/" target="_blank" rel="noopener">Open Synnical</a></p>'}
  </main>
  <script>
    (() => {
      const payload = ${payload};
      if (!payload || !window.opener) return;
      try {
        window.opener.postMessage(payload, window.location.origin);
        window.close();
      } catch {}
    })();
  </script>
</body>
</html>`
}

export async function GET() {
  const session = await getCurrentSession()
  return new NextResponse(page(session?.token || null), {
    status: session ? 200 : 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private, max-age=0",
      "Pragma": "no-cache",
      "Cross-Origin-Opener-Policy": "unsafe-none",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  })
}
