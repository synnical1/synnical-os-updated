// PM2 process definition for Synnical.
//
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup
//
// Secrets are NOT stored here. Put them in /var/www/synnical/.env (see
// .env.example) — server.ts loads it at boot, and PM2 inherits nothing
// sensitive from this file.

module.exports = {
  apps: [
    {
      name: "synnical",
      script: "node_modules/.bin/tsx",
      args: "server.ts",
      cwd: "/var/www/synnical",

      // Non-secret defaults. Anything defined in .env wins over these,
      // so you can override per-machine without editing this file.
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
        NEXT_PUBLIC_SOCKET_URL: "/socket.io",

        // Keep uploads OUTSIDE the deploy directory so a re-deploy (or a
        // `git clean`) can never wipe user avatars and voice notes.
        UPLOAD_DIR: "/var/lib/synnical/uploads",
      },

      instances: 1, // Socket.IO keeps in-memory room state — do not cluster
      // without adding a Redis adapter first.
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      min_uptime: "20s",
      max_restarts: 10,
      restart_delay: 2000,
      kill_timeout: 8000,

      error_file: "/var/log/synnical/error.log",
      out_file: "/var/log/synnical/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
}
