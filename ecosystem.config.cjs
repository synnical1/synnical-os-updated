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

      // Runtime secrets and host-specific values are loaded from .env by
      // dotenv. PM2 supplies production mode and a loopback-only listen address.
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
      },

      instances: 1, // Socket.IO keeps in-memory room state — do not cluster
      // without adding a Redis adapter first.
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G",
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
