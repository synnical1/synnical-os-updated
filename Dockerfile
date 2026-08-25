# Synnical Dockerfile — Render, Koyeb, Railway, Fly.io
# Multi-stage: Node.js build + Node.js runtime (NO Bun — crashes with Turbopack)

FROM node:20-slim AS builder
WORKDIR /app

# Install system deps for native modules (Prisma, sharp, etc.)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* bun.lock* ./
COPY prisma ./prisma

# Install ALL dependencies (including devDependencies — needed for build)
# Keep legacy peer handling enabled for the bundled proxy dependency graph.
RUN npm install --production=false --legacy-peer-deps

# Copy source
COPY . .

# Environment for build
ENV DATABASE_URL=file:./db/custom.db
ENV NEXT_PUBLIC_SOCKET_URL=/socket.io
ENV NODE_ENV=production

# Create directories
RUN mkdir -p db uploads

# Generate Prisma client + push schema
RUN npx prisma generate
RUN npx prisma db push --accept-data-loss || true

# Build Next.js
RUN npx next build

# ---- Runtime ----
FROM node:20-slim AS runner
WORKDIR /app

# Copy built app from builder
COPY --from=builder /app ./

# Create directories
RUN mkdir -p db uploads

# Environment
ENV DATABASE_URL=file:./db/custom.db
ENV NEXT_PUBLIC_SOCKET_URL=/socket.io
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Expose port
EXPOSE 3000

# Start: tsx is in dependencies (not devDependencies), so it's available
CMD ["npx", "tsx", "server.ts"]
