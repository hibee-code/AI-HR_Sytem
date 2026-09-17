# ── Stage 1: install all deps & compile ──────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: production-only deps ────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 3: minimal runtime image ───────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as the unprivileged user that ships with the node image.
USER node

COPY --chown=node:node --from=deps    /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist         ./dist
COPY --chown=node:node package*.json ./

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3000/health/live || exit 1

CMD ["node", "dist/main"]
