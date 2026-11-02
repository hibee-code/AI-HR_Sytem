# Debian slim, not Alpine: ONNX Runtime (local embedding model) needs glibc.
ARG NODE_IMAGE=node:24-bookworm-slim

# ── Stage 1: install all deps & compile ──────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: production-only deps + the embedding model ─────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Bake the open embedding model into the image: no download at runtime, so
# the container needs no internet and can run with a read-only filesystem.
# Must match LOCAL_EMBEDDING_MODEL (rebuild with --build-arg to change it).
ARG EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
RUN node -e " \
  import('@huggingface/transformers').then(async ({ pipeline, env }) => { \
    env.cacheDir = '/app/.models'; \
    await pipeline('feature-extraction', process.argv[1], { dtype: 'q8' }); \
  })" "$EMBEDDING_MODEL"

# ── Stage 3: minimal runtime image ───────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    EMBEDDINGS_CACHE_DIR=/app/.models
WORKDIR /app

# Run as the unprivileged user that ships with the node image.
USER node

COPY --chown=node:node --from=deps    /app/node_modules ./node_modules
COPY --chown=node:node --from=deps    /app/.models      ./.models
COPY --chown=node:node --from=builder /app/dist         ./dist
COPY --chown=node:node package*.json ./

EXPOSE 3000
# No curl/wget in slim images: probe with Node itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://localhost:3000/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main"]
