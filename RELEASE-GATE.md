# Synnical Main-Site Batch 1 Gate

Run this batch's dependency-backed gate before deployment:

    npm run preflight:main-batch

It performs:

1. Prisma schema validation
2. Prisma Client generation
3. full TypeScript checking
4. the focused Main Batch 1 regressions
5. the real Next.js production build

For a fresh deployment, run `npm ci --no-audit --no-fund` first. The checked-in
lockfile includes the `tsx` runtime used by both `npm start` and PM2.

The older `release:gate:*` documentation and tests belong to a separate R12
release branch. They are intentionally not used as the acceptance gate for this
bounded main-site batch.
